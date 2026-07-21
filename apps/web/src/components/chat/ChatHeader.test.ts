// FILE: ChatHeader.test.ts
// Purpose: Covers chat header presentation helpers that choose thread identity chrome.
// Layer: Component unit tests
// Depends on: ChatHeader pure helpers and Vitest assertions.

import { describe, expect, it } from "vitest";

import { resolveChatHeaderThreadIconKind } from "./ChatHeader";

describe("resolveChatHeaderThreadIconKind", () => {
  it("keeps provider branding for named threads", () => {
    expect(resolveChatHeaderThreadIconKind("Fix auth flow")).toBe("provider");
  });

  it("hides provider branding for untouched new chat threads", () => {
    expect(resolveChatHeaderThreadIconKind("New thread")).toBe("none");
  });
});
