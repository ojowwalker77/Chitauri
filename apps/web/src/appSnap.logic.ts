// FILE: appSnap.logic.ts
// Purpose: Pure AppSnap routing, deduplication, and acknowledgement predicates.

import type { ThreadId } from "@t3tools/contracts";
import type {
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
} from "./composerDraftStore";
import { isComposerAppSnapCaptureSource } from "./lib/composerImageSource";

export const APPSNAP_RECENT_TARGET_WINDOW_MS = 60_000;

export interface AppSnapThreadAffinity {
  threadId: ThreadId;
  atMs: number;
}

export function resolveAppSnapTarget(input: {
  captureAtMs: number;
  lastInteraction: AppSnapThreadAffinity | null;
  lastAppSnap: AppSnapThreadAffinity | null;
  isThreadAvailable: (threadId: ThreadId) => boolean;
}): ThreadId | null {
  const isRecentAndAvailable = (entry: AppSnapThreadAffinity | null) =>
    entry !== null &&
    input.captureAtMs >= entry.atMs &&
    input.captureAtMs - entry.atMs <= APPSNAP_RECENT_TARGET_WINDOW_MS &&
    input.isThreadAvailable(entry.threadId);

  const interactionValid = isRecentAndAvailable(input.lastInteraction);
  const appSnapValid = isRecentAndAvailable(input.lastAppSnap);
  if (
    interactionValid &&
    (!appSnapValid || input.lastInteraction!.atMs > input.lastAppSnap!.atMs)
  ) {
    return input.lastInteraction!.threadId;
  }
  if (appSnapValid) return input.lastAppSnap!.threadId;
  if (interactionValid) return input.lastInteraction!.threadId;
  return null;
}

export function persistedAppSnapCapture(input: {
  captureId: string;
  persistedAttachments: ReadonlyArray<PersistedComposerImageAttachment>;
  images: ReadonlyArray<ComposerImageAttachment>;
}): { attachment: PersistedComposerImageAttachment; image: ComposerImageAttachment } | null {
  const attachment = input.persistedAttachments.find(
    (entry) => entry.source?.captureId === input.captureId && Boolean(entry.blobKey),
  );
  const image = input.images.find((entry) => entry.source?.captureId === input.captureId);
  return attachment && image ? { attachment, image } : null;
}

interface AppSnapSourceCarrier {
  blobKey?: unknown;
  source?: unknown;
}

interface AppSnapCaptureDraft {
  images?: ReadonlyArray<AppSnapSourceCarrier>;
  persistedAttachments: ReadonlyArray<AppSnapSourceCarrier>;
  promptHistorySavedDraft?: {
    images?: ReadonlyArray<AppSnapSourceCarrier>;
    persistedAttachments: ReadonlyArray<AppSnapSourceCarrier>;
  } | null;
}

interface AppSnapHydrationDraft {
  images: ReadonlyArray<unknown>;
  persistedAttachments: ReadonlyArray<unknown>;
  promptHistorySavedDraft?: {
    images: ReadonlyArray<unknown>;
    persistedAttachments: ReadonlyArray<unknown>;
  } | null;
}

export function didAppSnapHydrationInputsChange(
  current: Readonly<Record<string, AppSnapHydrationDraft | undefined>>,
  previous: Readonly<Record<string, AppSnapHydrationDraft | undefined>>,
): boolean {
  const threadIds = new Set([...Object.keys(current), ...Object.keys(previous)]);
  for (const threadId of threadIds) {
    const currentDraft = current[threadId];
    const previousDraft = previous[threadId];
    if (!currentDraft || !previousDraft) return true;
    if (
      currentDraft.images !== previousDraft.images ||
      currentDraft.persistedAttachments !== previousDraft.persistedAttachments
    ) {
      return true;
    }
    const currentSaved = currentDraft.promptHistorySavedDraft;
    const previousSaved = previousDraft.promptHistorySavedDraft;
    if (Boolean(currentSaved) !== Boolean(previousSaved)) return true;
    if (
      currentSaved &&
      previousSaved &&
      (currentSaved.images !== previousSaved.images ||
        currentSaved.persistedAttachments !== previousSaved.persistedAttachments)
    ) {
      return true;
    }
  }
  return false;
}

function entriesContainCapture(
  entries: ReadonlyArray<AppSnapSourceCarrier>,
  captureId: string,
): boolean {
  return entries.some((entry) => isComposerAppSnapCaptureSource(entry.source, captureId));
}

export function hasPersistedAppSnapCapture(
  drafts: Iterable<AppSnapCaptureDraft | undefined>,
  captureId: string,
): boolean {
  if (captureId.length === 0) return false;
  for (const draft of drafts) {
    if (!draft) continue;
    if (
      entriesContainCapture(draft.persistedAttachments, captureId) ||
      entriesContainCapture(draft.promptHistorySavedDraft?.persistedAttachments ?? [], captureId)
    ) {
      return true;
    }
  }
  return false;
}

export function hasHydratedAppSnapCapture(
  drafts: Iterable<AppSnapCaptureDraft | undefined>,
  captureId: string,
): boolean {
  if (captureId.length === 0) return false;
  for (const draft of drafts) {
    if (!draft) continue;
    if (
      entriesContainCapture(draft.images ?? [], captureId) ||
      entriesContainCapture(draft.promptHistorySavedDraft?.images ?? [], captureId)
    ) {
      return true;
    }
  }
  return false;
}

export function persistedAppSnapCaptureBlobKeys(
  drafts: Iterable<AppSnapCaptureDraft | undefined>,
  captureId: string,
): string[] {
  if (captureId.length === 0) return [];
  const keys = new Set<string>();
  for (const draft of drafts) {
    if (!draft) continue;
    const attachments = [
      ...draft.persistedAttachments,
      ...(draft.promptHistorySavedDraft?.persistedAttachments ?? []),
    ];
    for (const attachment of attachments) {
      if (!isComposerAppSnapCaptureSource(attachment.source, captureId)) continue;
      if (typeof attachment.blobKey === "string" && attachment.blobKey.length > 0) {
        keys.add(attachment.blobKey);
      }
    }
  }
  return [...keys];
}

export function createLatestAppSnapRequestGuard(): {
  begin: () => number;
  isCurrent: (request: number) => boolean;
} {
  let latest = 0;
  return {
    begin: () => {
      latest += 1;
      return latest;
    },
    isCurrent: (request) => request === latest,
  };
}
