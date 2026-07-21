import { describe, expect, it } from "vitest";

import { appendPastedTextsToPrompt } from "../lib/composerPastedText";
import {
  estimateChangedFilesSummaryHeight,
  estimateTimelineMessageHeight,
  estimateTimelineWorkGroupHeight,
} from "./timelineHeight";

describe("estimateTimelineMessageHeight", () => {
  it("uses assistant sizing rules for assistant messages", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "assistant",
        text: "a".repeat(144),
      }),
    ).toBe(125.85);
  });

  it("uses assistant sizing rules for system messages", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "system",
        text: "a".repeat(144),
      }),
    ).toBe(125.85);
  });

  it("adds one attachment row for one or two user attachments", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "hello",
        attachments: [{ id: "1", type: "image" }],
      }),
    ).toBe(183.75);

    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "hello",
        attachments: [
          { id: "1", type: "image" },
          { id: "2", type: "image" },
        ],
      }),
    ).toBe(183.75);
  });

  it("keeps up to four user image attachments on one row", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "hello",
        attachments: [
          { id: "1", type: "image" },
          { id: "2", type: "image" },
          { id: "3", type: "image" },
        ],
      }),
    ).toBe(183.75);

    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "hello",
        attachments: [
          { id: "1", type: "image" },
          { id: "2", type: "image" },
          { id: "3", type: "image" },
          { id: "4", type: "image" },
        ],
      }),
    ).toBe(183.75);
  });

  it("adds a second attachment row for five user image attachments", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "hello",
        attachments: [
          { id: "1", type: "image" },
          { id: "2", type: "image" },
          { id: "3", type: "image" },
          { id: "4", type: "image" },
          { id: "5", type: "image" },
        ],
      }),
    ).toBe(251.75);
  });

  it("caps long user message estimates to the collapsed preview", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "a".repeat(56 * 120),
      }),
    ).toBe(367.25);
  });

  it("counts explicit newlines for user message estimates", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "first\nsecond\nthird",
      }),
    ).toBe(165.25);
  });

  it("adds pasted text card chrome without counting the hidden block as message text", () => {
    const prompt = appendPastedTextsToPrompt("", [
      {
        text: "first pasted line\nsecond pasted line",
      },
    ]);

    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: prompt,
      }),
    ).toBeGreaterThan(
      estimateTimelineMessageHeight({
        role: "user",
        text: "",
      }),
    );
  });

  it("uses narrower width to increase user line wrapping", () => {
    const message = {
      role: "user" as const,
      text: "a".repeat(52),
    };

    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 320 })).toBe(142.5);
    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 768 })).toBe(119.75);
  });

  it("does not clamp user wrapping too aggressively on very narrow layouts", () => {
    const message = {
      role: "user" as const,
      text: "a".repeat(20),
    };

    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 100 })).toBe(165.25);
    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 320 })).toBe(119.75);
  });

  it("uses narrower width to increase assistant line wrapping", () => {
    const message = {
      role: "assistant" as const,
      text: "a".repeat(200),
    };

    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 320 })).toBe(197.625);
    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 768 })).toBe(125.85);
  });

  it("adds diff summary chrome to assistant message estimates", () => {
    expect(
      estimateTimelineMessageHeight(
        {
          role: "assistant",
          text: "done",
          diffSummaryFiles: [{ path: "src/index.ts", additions: 3, deletions: 1 }],
        },
        { timelineWidthPx: 768 },
      ),
    ).toBe(213.925);
  });

  it("accounts for inline code spans that wrap wider than plain text", () => {
    expect(
      estimateTimelineMessageHeight(
        {
          role: "assistant",
          text: "`0123456789012345678901234567890123456789`",
        },
        { timelineWidthPx: 120 },
      ),
    ).toBeGreaterThan(
      estimateTimelineMessageHeight(
        {
          role: "assistant",
          text: "0123456789012345678901234567890123456789",
        },
        { timelineWidthPx: 120 },
      ),
    );
  });
});

describe("estimateChangedFilesSummaryHeight", () => {
  it("estimates the flat changed-files list and collapsed overflow toggle", () => {
    const files = [
      { path: "apps/web/src/index.ts", additions: 1, deletions: 0 },
      { path: "apps/web/src/components/Button.tsx", additions: 2, deletions: 1 },
      { path: "apps/server/src/index.ts", additions: 4, deletions: 0 },
      { path: "packages/shared/src/path.ts", additions: 0, deletions: 2 },
      { path: "README.md", additions: 1, deletions: 1 },
      { path: "CHANGELOG.md", additions: 3, deletions: 0 },
    ];

    expect(estimateChangedFilesSummaryHeight(files, false)).toBe(290);
    expect(estimateChangedFilesSummaryHeight(files, true)).toBe(292);
  });
});

describe("estimateTimelineWorkGroupHeight", () => {
  it("caps collapsed work groups to the visible tail entries", () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      tone: "tool" as const,
      detail: `detail-${index}`,
    }));

    expect(
      estimateTimelineWorkGroupHeight(entries, {
        expanded: false,
        maxVisibleEntries: 6,
      }),
    ).toBe(234);
    expect(
      estimateTimelineWorkGroupHeight(entries, {
        expanded: true,
        maxVisibleEntries: 6,
      }),
    ).toBe(298);
  });

  it("adds room for changed-file chips in work log rows", () => {
    expect(
      estimateTimelineWorkGroupHeight(
        [
          {
            tone: "tool",
            detail: "Updated files",
            changedFiles: ["src/a.ts", "src/b.ts"],
          },
        ],
        {
          expanded: true,
          maxVisibleEntries: 6,
        },
      ),
    ).toBe(78);
  });
});
