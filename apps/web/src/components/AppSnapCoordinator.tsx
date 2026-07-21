// FILE: AppSnapCoordinator.tsx
// Purpose: Delivers desktop AppSnaps into TeaCode composers with durable acknowledgement.

import type { DesktopAppSnapCapture, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import {
  type AppSnapThreadAffinity,
  didAppSnapHydrationInputsChange,
  hasHydratedAppSnapCapture,
  hasPersistedAppSnapCapture,
  persistedAppSnapCaptureBlobKeys,
  resolveAppSnapTarget,
} from "../appSnap.logic";
import { useAppSettings } from "../appSettings";
import {
  type ComposerImageAttachment,
  isComposerImageBlobReferenced,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "../composerDraftStore";
import { requestComposerFocus } from "../composerFocusRequestStore";
import { useFocusedChatContext } from "../focusedChatContext";
import { useHandleNewChat } from "../hooks/useHandleNewChat";
import { persistAppSnapIcon, readAppSnapIcon } from "../lib/appSnapIconStore";
import {
  deleteComposerImageBlob,
  deleteOrphanedComposerImageBlobs,
  persistComposerImageBlob,
  readComposerImageBlob,
} from "../lib/composerImageBlobStore";
import { playAppSnapSound } from "../lib/appSnapSound";
import type { ComposerAppSnapSource } from "../lib/composerImageSource";
import {
  buildComposerImageAttachmentsFromFiles,
  effectiveComposerAttachmentCount,
} from "../lib/composerSend";
import { useStore } from "../store";
import { toastManager } from "./ui/toast";

const MAX_DEDUPED_CAPTURE_IDS = 128;

interface PersistedAppSnapHydrationTarget {
  attachments: ReadonlyArray<PersistedComposerImageAttachment>;
  images: ReadonlyArray<ComposerImageAttachment>;
  hasAttachment: (attachmentId: string) => boolean;
  addImage: (image: ComposerImageAttachment) => void;
  removeAttachment: (attachmentId: string) => Promise<unknown>;
}

function captureTimestamp(capture: DesktopAppSnapCapture): number {
  const parsed = Date.parse(capture.capturedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isThreadAvailable(threadId: ThreadId): boolean {
  return (
    useStore.getState().threads.some((thread) => thread.id === threadId) ||
    Boolean(useComposerDraftStore.getState().draftThreadsByThreadId[threadId])
  );
}

function rememberCaptureId(captureIds: Set<string>, captureId: string): boolean {
  if (captureIds.has(captureId)) return false;
  captureIds.add(captureId);
  while (captureIds.size > MAX_DEDUPED_CAPTURE_IDS) {
    const oldest = captureIds.values().next().value as string | undefined;
    if (!oldest) break;
    captureIds.delete(oldest);
  }
  return true;
}

async function sourceWithCachedIcon(source: ComposerAppSnapSource): Promise<ComposerAppSnapSource> {
  const bundleIdentifier = source.bundleIdentifier?.trim() || null;
  if (!bundleIdentifier) return source;
  if (source.appIconDataUrl) {
    await persistAppSnapIcon(bundleIdentifier, source.appIconDataUrl).catch((error) => {
      console.warn("[appsnap] Could not cache the source app icon", error);
    });
    return source;
  }
  const appIconDataUrl = await readAppSnapIcon(bundleIdentifier).catch((error) => {
    console.warn("[appsnap] Could not restore the source app icon", error);
    return null;
  });
  return appIconDataUrl ? { ...source, appIconDataUrl } : source;
}

export function AppSnapCoordinator() {
  const navigate = useNavigate();
  const { handleNewChat } = useHandleNewChat();
  const { focusedThreadId } = useFocusedChatContext();
  const { settings } = useAppSettings();
  const focusedThreadRef = useRef<ThreadId | null>(focusedThreadId);
  const lastInteractionRef = useRef<AppSnapThreadAffinity | null>(null);
  const lastAppSnapRef = useRef<AppSnapThreadAffinity | null>(null);
  const captureQueueRef = useRef<Promise<void>>(Promise.resolve());
  const seenCaptureIdsRef = useRef(new Set<string>());
  const blobHydrationInFlightRef = useRef(new Set<string>());
  const hydratePersistedAppSnapsRef = useRef<(captureId?: string) => Promise<void>>(async () => {});
  const attachCaptureRef = useRef<
    ((capture: DesktopAppSnapCapture) => Promise<"persisted" | "unverified">) | null
  >(null);
  const playSoundRef = useRef(settings.appSnapPlaySound);
  const enableAppSnapRef = useRef(settings.enableAppSnap);
  playSoundRef.current = settings.appSnapPlaySound;
  enableAppSnapRef.current = settings.enableAppSnap;
  focusedThreadRef.current = focusedThreadId;

  useEffect(() => {
    let disposed = false;

    const hydratePersistedAppSnaps = async (captureId?: string) => {
      const drafts = useComposerDraftStore.getState().draftsByThreadId;
      for (const [rawThreadId, draft] of Object.entries(drafts)) {
        const threadId = rawThreadId as ThreadId;
        const targets: PersistedAppSnapHydrationTarget[] = [
          {
            attachments: draft.persistedAttachments,
            images: draft.images,
            hasAttachment: (attachmentId) =>
              useComposerDraftStore
                .getState()
                .draftsByThreadId[threadId]?.persistedAttachments.some(
                  (attachment) => attachment.id === attachmentId,
                ) ?? false,
            addImage: (image) => useComposerDraftStore.getState().addImage(threadId, image),
            removeAttachment: (attachmentId) => {
              const latest =
                useComposerDraftStore.getState().draftsByThreadId[threadId]?.persistedAttachments ??
                [];
              return useComposerDraftStore.getState().syncPersistedAttachments(
                threadId,
                latest.filter((attachment) => attachment.id !== attachmentId),
              );
            },
          },
        ];
        if (draft.promptHistorySavedDraft) {
          targets.push({
            attachments: draft.promptHistorySavedDraft.persistedAttachments,
            images: draft.promptHistorySavedDraft.images,
            hasAttachment: (attachmentId) =>
              useComposerDraftStore
                .getState()
                .draftsByThreadId[threadId]?.promptHistorySavedDraft?.persistedAttachments.some(
                  (attachment) => attachment.id === attachmentId,
                ) ?? false,
            addImage: (image) =>
              useComposerDraftStore.getState().addPromptHistorySavedDraftImage(threadId, image),
            removeAttachment: (attachmentId) => {
              const latest =
                useComposerDraftStore.getState().draftsByThreadId[threadId]?.promptHistorySavedDraft
                  ?.persistedAttachments ?? [];
              return useComposerDraftStore
                .getState()
                .syncPromptHistorySavedDraftPersistedAttachments(
                  threadId,
                  latest.filter((attachment) => attachment.id !== attachmentId),
                );
            },
          });
        }

        for (const target of targets) {
          const existingIds = new Set(target.images.map((image) => image.id));
          for (const attachment of target.attachments) {
            if (
              !attachment.blobKey ||
              attachment.source?.kind !== "appsnap" ||
              (captureId !== undefined && attachment.source.captureId !== captureId) ||
              existingIds.has(attachment.id) ||
              blobHydrationInFlightRef.current.has(attachment.blobKey)
            ) {
              continue;
            }
            blobHydrationInFlightRef.current.add(attachment.blobKey);
            try {
              const [file, source] = await Promise.all([
                readComposerImageBlob(attachment.blobKey),
                sourceWithCachedIcon(attachment.source),
              ]);
              if (!file) {
                await target.removeAttachment(attachment.id);
                continue;
              }
              if (disposed || !target.hasAttachment(attachment.id)) continue;
              target.addImage({
                type: "image",
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                previewUrl: URL.createObjectURL(file),
                file,
                source,
              });
              existingIds.add(attachment.id);
            } catch (error) {
              console.warn("[appsnap] Could not restore a persisted capture", error);
            } finally {
              blobHydrationInFlightRef.current.delete(attachment.blobKey);
            }
          }
        }
      }
    };

    let hydrationQueue = Promise.resolve();
    const enqueueHydration = (captureId?: string) => {
      const hydration = hydrationQueue.then(() => hydratePersistedAppSnaps(captureId));
      hydrationQueue = hydration.catch(() => undefined);
      return hydration;
    };
    hydratePersistedAppSnapsRef.current = enqueueHydration;
    void enqueueHydration().then(() => {
      if (disposed) return;
      void deleteOrphanedComposerImageBlobs({
        isReferenced: (blobKey) =>
          blobHydrationInFlightRef.current.has(blobKey) ||
          isComposerImageBlobReferenced(useComposerDraftStore.getState().draftsByThreadId, blobKey),
      }).catch((error) => console.warn("[appsnap] Could not sweep stale image blobs", error));
    });
    const unsubscribe = useComposerDraftStore.subscribe((state, previous) => {
      if (didAppSnapHydrationInputsChange(state.draftsByThreadId, previous.draftsByThreadId)) {
        void enqueueHydration();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
      hydratePersistedAppSnapsRef.current = async () => {};
    };
  }, []);

  useEffect(() => {
    if (focusedThreadId) {
      lastInteractionRef.current = { threadId: focusedThreadId, atMs: Date.now() };
    }
  }, [focusedThreadId]);

  useEffect(() => {
    const recordInteraction = () => {
      const threadId = focusedThreadRef.current;
      if (threadId) lastInteractionRef.current = { threadId, atMs: Date.now() };
    };
    window.addEventListener("keydown", recordInteraction, { capture: true });
    window.addEventListener("pointerdown", recordInteraction, { capture: true });
    return () => {
      window.removeEventListener("keydown", recordInteraction, { capture: true });
      window.removeEventListener("pointerdown", recordInteraction, { capture: true });
    };
  }, []);

  useEffect(() => {
    const bridge = window.desktopBridge?.appSnap;
    if (!bridge) return;
    void bridge.setEnabled(settings.enableAppSnap).catch((error) => {
      console.warn("[appsnap] Could not update the native listener", error);
    });
  }, [settings.enableAppSnap]);

  const routeToThread = useCallback(
    async (threadId: ThreadId) => {
      if (focusedThreadRef.current !== threadId) {
        await navigate({ to: "/$threadId", params: { threadId } });
      }
      requestComposerFocus(threadId);
    },
    [navigate],
  );

  const resolveDestination = useCallback(
    async (capture: DesktopAppSnapCapture): Promise<ThreadId> => {
      const target = resolveAppSnapTarget({
        captureAtMs: captureTimestamp(capture),
        lastInteraction: lastInteractionRef.current,
        lastAppSnap: lastAppSnapRef.current,
        isThreadAvailable,
      });
      if (target) {
        await routeToThread(target);
        return target;
      }
      const result = await handleNewChat({ fresh: true });
      if (!result.ok) throw new Error(result.error);
      requestComposerFocus(result.threadId);
      return result.threadId;
    },
    [handleNewChat, routeToThread],
  );

  const attachCapture = useCallback(
    async (capture: DesktopAppSnapCapture): Promise<"persisted" | "unverified"> => {
      const threadId = await resolveDestination(capture);
      const captureAtMs = captureTimestamp(capture);
      const bytes = new Uint8Array(capture.bytes);
      if (bytes.byteLength === 0) throw new Error("The captured AppSnap is empty.");
      const file = new File([bytes], capture.name, {
        type: capture.mimeType,
        lastModified: captureAtMs,
      });
      const built = buildComposerImageAttachmentsFromFiles({
        files: [file],
        existingAttachmentCount: effectiveComposerAttachmentCount(
          useComposerDraftStore.getState().draftsByThreadId[threadId],
        ),
      });
      const baseImage = built.images[0];
      if (!baseImage) throw new Error(built.error ?? "TeaCode could not attach the AppSnap.");

      const source = await sourceWithCachedIcon({
        kind: "appsnap",
        captureId: capture.id,
        capturedAt: capture.capturedAt,
        appName: capture.sourceAppName,
        bundleIdentifier: capture.sourceBundleIdentifier,
        appIconDataUrl: capture.sourceAppIconDataUrl,
        windowTitle: capture.sourceWindowTitle,
      });
      const image = { ...baseImage, id: capture.id, source };
      let blobKey: string | null = null;
      let imageAdded = false;
      try {
        blobKey = await persistComposerImageBlob({
          threadId,
          imageId: image.id,
          file: image.file,
        });
        const draftStore = useComposerDraftStore.getState();
        draftStore.setPromptHistorySavedDraft(threadId, null);
        draftStore.addImage(threadId, image);
        imageAdded = true;
        const current =
          useComposerDraftStore.getState().draftsByThreadId[threadId]?.persistedAttachments ?? [];
        const persistence = await draftStore.syncPersistedAttachments(threadId, [
          ...current.filter((attachment) => attachment.id !== image.id),
          {
            id: image.id,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            blobKey,
            source,
          },
        ]);
        if (persistence === "rejected") {
          draftStore.removeAppSnapCapture(capture.id);
          await deleteComposerImageBlob(blobKey).catch(() => undefined);
          throw new Error("The capture was saved, but its draft metadata was rejected.");
        }
        lastAppSnapRef.current = { threadId, atMs: captureAtMs };
        requestComposerFocus(threadId);
        toastManager.add({
          type: persistence === "persisted" ? "success" : "warning",
          title:
            persistence === "persisted" ? "AppSnap attached" : "AppSnap attached with a warning",
          description:
            persistence === "persisted"
              ? capture.sourceAppName
                ? `Captured ${capture.sourceWindowTitle || capture.sourceAppName}.`
                : "The captured window is ready in the composer."
              : "TeaCode kept the desktop copy because draft storage could not be verified.",
          data: { allowCrossThreadVisibility: true, threadId },
        });
        return persistence;
      } catch (error) {
        if (!imageAdded) {
          URL.revokeObjectURL(image.previewUrl);
          if (blobKey) await deleteComposerImageBlob(blobKey).catch(() => undefined);
        }
        throw error;
      }
    },
    [resolveDestination],
  );
  attachCaptureRef.current = attachCapture;

  useEffect(() => {
    const bridge = window.desktopBridge?.appSnap;
    if (!bridge) return;
    let disposed = false;

    const enqueueCapture = (capture: DesktopAppSnapCapture, live: boolean) => {
      if (disposed || !rememberCaptureId(seenCaptureIdsRef.current, capture.id)) return;
      captureQueueRef.current = captureQueueRef.current
        .then(async () => {
          const drafts = Object.values(useComposerDraftStore.getState().draftsByThreadId);
          if (hasPersistedAppSnapCapture(drafts, capture.id)) {
            const blobKeys = persistedAppSnapCaptureBlobKeys(drafts, capture.id);
            const blobs = await Promise.all(
              blobKeys.map((blobKey) => readComposerImageBlob(blobKey).catch(() => null)),
            );
            if (blobs.some((blob) => blob !== null)) {
              await hydratePersistedAppSnapsRef.current(capture.id);
              if (
                hasHydratedAppSnapCapture(
                  Object.values(useComposerDraftStore.getState().draftsByThreadId),
                  capture.id,
                )
              ) {
                await bridge.acknowledgeCapture(capture.id).catch((error) => {
                  console.warn("[appsnap] Could not acknowledge a restored capture", error);
                });
                return;
              }
            }
          }

          useComposerDraftStore.getState().removeAppSnapCapture(capture.id);
          try {
            const attach = attachCaptureRef.current;
            if (!attach) throw new Error("The AppSnap composer is not ready yet.");
            const persistence = await attach(capture);
            if (persistence !== "persisted") return;
            let acknowledged = false;
            await bridge
              .acknowledgeCapture(capture.id)
              .then(() => {
                acknowledged = true;
              })
              .catch((error) => console.warn("[appsnap] Could not acknowledge capture", error));
            if (acknowledged && live && playSoundRef.current) void playAppSnapSound();
          } catch (error) {
            toastManager.add({
              type: "error",
              title: "AppSnap could not be attached",
              description: error instanceof Error ? error.message : "The capture remains pending.",
              data: { allowCrossThreadVisibility: true },
              actionProps: {
                children: "Retry",
                onClick: () => {
                  seenCaptureIdsRef.current.delete(capture.id);
                  enqueueCapture(capture, false);
                },
              },
            });
          }
        })
        .catch((error) => console.warn("[appsnap] Capture queue failed", error));
    };

    const unsubscribeCapture = bridge.onCaptured((capture) => enqueueCapture(capture, true));
    const unsubscribeError = bridge.onError((error) => {
      toastManager.add({
        type: error.code === "capture_in_progress" ? "warning" : "error",
        title: "AppSnap",
        description: error.message,
        ...(error.code === "helper-stopped"
          ? {
              actionProps: {
                children: "Restart",
                onClick: () => {
                  void bridge.setEnabled(enableAppSnapRef.current).catch((restartError) => {
                    console.warn("[appsnap] Could not restart the native listener", restartError);
                  });
                },
              },
            }
          : {}),
        data: { allowCrossThreadVisibility: true },
      });
    });
    void bridge
      .listPendingCaptures()
      .then((captures) => {
        for (const capture of captures) enqueueCapture(capture, false);
      })
      .catch((error) => console.warn("[appsnap] Could not restore pending captures", error));
    return () => {
      disposed = true;
      unsubscribeCapture();
      unsubscribeError();
    };
  }, []);

  return null;
}
