// FILE: desktopWsBridge.test.ts
// Purpose: Verifies canonical and legacy desktop WebSocket URL environment resolution.

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

  it("prefers TEACODE_DESKTOP_WS_URL", () => {
    expect(
      resolveDesktopWsUrlFromEnv({
        TEACODE_DESKTOP_WS_URL: "ws://127.0.0.1:6000/?token=teacode",
        CHITAURI_DESKTOP_WS_URL: "ws://127.0.0.1:6000/?token=chitauri",
      } as NodeJS.ProcessEnv),
    ).toBe("ws://127.0.0.1:6000/?token=teacode");
  });

  it("accepts CHITAURI_DESKTOP_WS_URL during migration", () => {
    expect(
      resolveDesktopWsUrlFromEnv({
        CHITAURI_DESKTOP_WS_URL: "ws://127.0.0.1:6000/?token=chitauri",
      } as NodeJS.ProcessEnv),
    ).toBe("ws://127.0.0.1:6000/?token=chitauri");
  });

  it("returns null when both environment values are missing or empty", () => {
    expect(resolveDesktopWsUrlFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      resolveDesktopWsUrlFromEnv({
        TEACODE_DESKTOP_WS_URL: "   ",
        CHITAURI_DESKTOP_WS_URL: "   ",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});
