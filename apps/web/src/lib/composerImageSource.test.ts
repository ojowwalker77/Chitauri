import { describe, expect, it } from "vitest";

import {
  isComposerAppSnapCaptureSource,
  normalizeAppSnapIconDataUrl,
  normalizeComposerImageSource,
  toPersistedComposerImageSource,
} from "./composerImageSource";

describe("composer image provenance", () => {
  it("normalizes legacy appshot sources to TeaCode AppSnap", () => {
    expect(
      normalizeComposerImageSource({
        kind: "appshot",
        captureId: "capture-1",
        capturedAt: "2026-07-17T00:00:00.000Z",
        appName: "Safari",
        windowTitle: "Window",
      }),
    ).toMatchObject({ kind: "appsnap", captureId: "capture-1", appName: "Safari" });
  });

  it("keeps app icons out of localStorage metadata", () => {
    const persisted = toPersistedComposerImageSource({
      kind: "appsnap",
      captureId: "capture-1",
      capturedAt: "2026-07-17T00:00:00.000Z",
      appName: "Safari",
      appIconDataUrl: "data:image/png;base64,aWNvbg==",
      windowTitle: "Window",
    });
    expect(persisted).not.toHaveProperty("appIconDataUrl");
  });

  it("rejects malformed or oversized icon payloads", () => {
    expect(normalizeAppSnapIconDataUrl("data:text/plain;base64,aWNvbg==")).toBeNull();
    expect(normalizeAppSnapIconDataUrl(`data:image/png;base64,${"a".repeat(256_001)}`)).toBeNull();
  });

  it("matches a normalized capture source by id", () => {
    expect(
      isComposerAppSnapCaptureSource(
        {
          kind: "appsnap",
          captureId: "capture-1",
          capturedAt: "2026-07-17T00:00:00.000Z",
          appName: null,
          windowTitle: null,
        },
        "capture-1",
      ),
    ).toBe(true);
    expect(isComposerAppSnapCaptureSource(null, "capture-1")).toBe(false);
  });
});
