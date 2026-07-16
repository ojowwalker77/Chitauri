// FILE: desktopWsBridge.test.ts
// Purpose: Verifies desktop WebSocket URL resolution from the CHITAURI_DESKTOP_WS_URL env name.

import { describe, expect, it } from "vitest";

import { normalizeDesktopWsUrl, resolveDesktopWsUrlFromEnv } from "./desktopWsBridge";

describe("desktopWsBridge", () => {
  it("normalizes non-empty WebSocket URL strings", () => {
    expect(normalizeDesktopWsUrl(" ws://127.0.0.1:1234/?token=test ")).toBe(
      "ws://127.0.0.1:1234/?token=test",
    );
  });

  it("rejects empty or non-string values", () => {
    expect(normalizeDesktopWsUrl("   ")).toBeNull();
    expect(normalizeDesktopWsUrl(null)).toBeNull();
  });

  it("reads CHITAURI_DESKTOP_WS_URL", () => {
    expect(
      resolveDesktopWsUrlFromEnv({
        CHITAURI_DESKTOP_WS_URL: "ws://127.0.0.1:6000/?token=chitauri",
      } as NodeJS.ProcessEnv),
    ).toBe("ws://127.0.0.1:6000/?token=chitauri");
  });

  it("returns null when CHITAURI_DESKTOP_WS_URL is missing or empty", () => {
    expect(resolveDesktopWsUrlFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      resolveDesktopWsUrlFromEnv({ CHITAURI_DESKTOP_WS_URL: "   " } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});
