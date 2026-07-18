import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  APPSNAP_RECENT_TARGET_WINDOW_MS,
  createLatestAppSnapRequestGuard,
  didAppSnapHydrationInputsChange,
  hasHydratedAppSnapCapture,
  hasPersistedAppSnapCapture,
  persistedAppSnapCapture,
  persistedAppSnapCaptureBlobKeys,
  resolveAppSnapTarget,
} from "./appSnap.logic";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const available = (threadId: ThreadId) => threadId === THREAD_A || threadId === THREAD_B;

describe("resolveAppSnapTarget", () => {
  it("uses recent interaction and then consecutive AppSnap affinity", () => {
    expect(
      resolveAppSnapTarget({
        captureAtMs: 100_000,
        lastInteraction: { threadId: THREAD_A, atMs: 50_000 },
        lastAppSnap: null,
        isThreadAvailable: available,
      }),
    ).toBe(THREAD_A);
    expect(
      resolveAppSnapTarget({
        captureAtMs: 100_000,
        lastInteraction: null,
        lastAppSnap: { threadId: THREAD_B, atMs: 90_000 },
        isThreadAvailable: available,
      }),
    ).toBe(THREAD_B);
  });

  it("starts fresh after 60 seconds or when the thread disappeared", () => {
    expect(
      resolveAppSnapTarget({
        captureAtMs: 100_000,
        lastInteraction: {
          threadId: THREAD_A,
          atMs: 100_000 - APPSNAP_RECENT_TARGET_WINDOW_MS - 1,
        },
        lastAppSnap: null,
        isThreadAvailable: available,
      }),
    ).toBeNull();
    expect(
      resolveAppSnapTarget({
        captureAtMs: 100_000,
        lastInteraction: { threadId: THREAD_A, atMs: 99_000 },
        lastAppSnap: null,
        isThreadAvailable: () => false,
      }),
    ).toBeNull();
  });

  it("chooses the most recent valid affinity", () => {
    expect(
      resolveAppSnapTarget({
        captureAtMs: 100_000,
        lastInteraction: { threadId: THREAD_B, atMs: 99_800 },
        lastAppSnap: { threadId: THREAD_A, atMs: 99_500 },
        isThreadAvailable: available,
      }),
    ).toBe(THREAD_B);
  });
});

describe("persistedAppSnapCapture", () => {
  it("requires both durable blob metadata and a hydrated image", () => {
    const source = {
      kind: "appsnap" as const,
      captureId: "capture-1",
      capturedAt: "2026-07-17T00:00:00.000Z",
      appName: "Safari",
      windowTitle: "TeaCode",
    };
    const attachment = {
      id: "image-1",
      name: "capture.png",
      mimeType: "image/png",
      sizeBytes: 8,
      blobKey: "thread:image-1",
      source,
    };
    const image = {
      type: "image" as const,
      ...attachment,
      previewUrl: "blob:capture",
      file: new File([], "capture.png", { type: "image/png" }),
    };

    expect(
      persistedAppSnapCapture({
        captureId: "capture-1",
        persistedAttachments: [attachment],
        images: [image],
      }),
    ).toEqual({ attachment, image });
    expect(
      persistedAppSnapCapture({
        captureId: "capture-1",
        persistedAttachments: [
          {
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            source: attachment.source,
          },
        ],
        images: [image],
      }),
    ).toBeNull();
  });
});

describe("AppSnap capture restoration", () => {
  const source = {
    kind: "appsnap" as const,
    captureId: "capture-restored",
    capturedAt: "2026-07-17T00:00:00.000Z",
    appName: "Safari",
    windowTitle: "TeaCode",
  };

  it("detects durable and hydrated captures across live and prompt-history drafts", () => {
    const drafts = [
      {
        images: [],
        persistedAttachments: [],
        promptHistorySavedDraft: {
          images: [{ source }],
          persistedAttachments: [{ source, blobKey: "thread:restored" }],
        },
      },
    ];
    expect(hasPersistedAppSnapCapture(drafts, source.captureId)).toBe(true);
    expect(hasHydratedAppSnapCapture(drafts, source.captureId)).toBe(true);
    expect(persistedAppSnapCaptureBlobKeys(drafts, source.captureId)).toEqual(["thread:restored"]);
    expect(hasPersistedAppSnapCapture(drafts, "capture-other")).toBe(false);
  });

  it("only retriggers hydration when attachment references change", () => {
    const images: unknown[] = [];
    const attachments: unknown[] = [];
    const previous = {
      [THREAD_A]: { images, persistedAttachments: attachments, promptHistorySavedDraft: null },
    };
    expect(
      didAppSnapHydrationInputsChange(
        {
          [THREAD_A]: { images, persistedAttachments: attachments, promptHistorySavedDraft: null },
        },
        previous,
      ),
    ).toBe(false);
    expect(
      didAppSnapHydrationInputsChange(
        {
          [THREAD_A]: { images: [{}], persistedAttachments: attachments },
        },
        previous,
      ),
    ).toBe(true);
  });
});

describe("createLatestAppSnapRequestGuard", () => {
  it("invalidates older asynchronous settings requests", () => {
    const guard = createLatestAppSnapRequestGuard();
    const older = guard.begin();
    const newer = guard.begin();
    expect(guard.isCurrent(older)).toBe(false);
    expect(guard.isCurrent(newer)).toBe(true);
  });
});
