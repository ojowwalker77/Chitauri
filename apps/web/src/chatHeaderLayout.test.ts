// FILE: chatHeaderLayout.test.ts
// Purpose: Keeps chat header control normalization covered for every configurable control.
// Layer: Web settings tests
// Depends on: chatHeaderLayout control labels and ordering helpers.

import { describe, expect, it } from "vitest";

import {
  CHAT_HEADER_CONTROL_LABELS,
  compareChatHeaderControlsByOrder,
  DEFAULT_CHAT_HEADER_CONTROL_ORDER,
  isChatHeaderControlId,
  normalizeChatHeaderControlOrder,
  normalizeHiddenChatHeaderControls,
  sameChatHeaderControlOrder,
  type ChatHeaderControlId,
} from "./chatHeaderLayout";

const ALL_CHAT_HEADER_CONTROL_IDS = Object.keys(
  CHAT_HEADER_CONTROL_LABELS,
) as ChatHeaderControlId[];

describe("chatHeaderLayout", () => {
  it("includes every labelled control in the default order", () => {
    expect(DEFAULT_CHAT_HEADER_CONTROL_ORDER).toHaveLength(ALL_CHAT_HEADER_CONTROL_IDS.length);
    expect(new Set(DEFAULT_CHAT_HEADER_CONTROL_ORDER)).toEqual(
      new Set(ALL_CHAT_HEADER_CONTROL_IDS),
    );
  });

  it("rejects unknown control ids", () => {
    expect(isChatHeaderControlId("diff")).toBe(true);
    expect(isChatHeaderControlId("bogus")).toBe(false);
  });

  it("dedupes and drops unknown ids from the hidden set", () => {
    expect(normalizeHiddenChatHeaderControls(["bogus", "diff", "diff", "usage"])).toEqual([
      "diff",
      "usage",
    ]);
  });

  it("dedupes and drops unknown ids from a persisted order", () => {
    expect(normalizeChatHeaderControlOrder(["diff", "bogus", "diff", "usage"]).slice(0, 2)).toEqual(
      ["diff", "usage"],
    );
  });

  it("appends controls missing from a stale persisted order", () => {
    const stale = normalizeChatHeaderControlOrder(["diff", "usage"]);
    expect(stale.slice(0, 2)).toEqual(["diff", "usage"]);
    expect(new Set(stale)).toEqual(new Set(ALL_CHAT_HEADER_CONTROL_IDS));
    expect(stale).toHaveLength(ALL_CHAT_HEADER_CONTROL_IDS.length);
  });

  it("keeps the default order stable through normalization", () => {
    expect(
      sameChatHeaderControlOrder(
        normalizeChatHeaderControlOrder([...DEFAULT_CHAT_HEADER_CONTROL_ORDER]),
        DEFAULT_CHAT_HEADER_CONTROL_ORDER,
      ),
    ).toBe(true);
    expect(sameChatHeaderControlOrder(["diff"], ["usage"])).toBe(false);
  });

  it("sorts by the configured order and pushes unlisted controls last", () => {
    const order: ChatHeaderControlId[] = ["diff", "usage"];
    expect(compareChatHeaderControlsByOrder(order, "diff", "usage")).toBeLessThan(0);
    expect(compareChatHeaderControlsByOrder(order, "usage", "handoff")).toBeLessThan(0);
    expect(
      DEFAULT_CHAT_HEADER_CONTROL_ORDER.toSorted((left, right) =>
        compareChatHeaderControlsByOrder(order, left, right),
      ),
    ).toEqual([
      "diff",
      "usage",
      "handoff",
      "projectScripts",
      "environment",
      "openIn",
      "gitActions",
    ]);
  });
});
