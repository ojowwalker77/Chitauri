// FILE: MessagesTimeline.ledger.browser.tsx
// Purpose: Browser regression for the compact Claude-style trail used by live tool activity.
// Layer: Vitest browser tests

import "../../index.css";

import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { deriveTimelineEntries } from "../../session-logic";
import { MessagesTimeline } from "./MessagesTimeline";

type TimelineEntries = ReturnType<typeof deriveTimelineEntries>;

const timelineEntries: TimelineEntries = [
  {
    id: "entry-search",
    kind: "work",
    createdAt: "2026-07-16T12:00:01.000Z",
    entry: {
      id: "work-search",
      createdAt: "2026-07-16T12:00:01.000Z",
      label: "Searched for transcript rendering",
      tone: "tool",
      itemType: "command_execution",
      command: "rg -n MessagesTimeline apps/web/src",
    },
  },
  {
    id: "entry-edit",
    kind: "work",
    createdAt: "2026-07-16T12:00:02.000Z",
    entry: {
      id: "work-edit",
      createdAt: "2026-07-16T12:00:02.000Z",
      label: "Edited MessagesTimeline.tsx",
      tone: "tool",
      requestKind: "file-change",
      changedFiles: ["apps/web/src/components/chat/MessagesTimeline.tsx"],
    },
  },
  {
    id: "entry-status",
    kind: "work",
    createdAt: "2026-07-16T12:00:03.000Z",
    entry: {
      id: "work-status",
      createdAt: "2026-07-16T12:00:03.000Z",
      label: "Tasks updated",
      tone: "info",
    },
  },
];

describe("MessagesTimeline activity trail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders live work as one quiet chronological trail", async () => {
    const screen = await render(
      <div style={{ height: 420 }}>
        <MessagesTimeline
          hasMessages
          isWorking
          activeTurnInProgress
          activeTurnStartedAt="2026-07-16T12:00:00.000Z"
          timelineEntries={timelineEntries}
          turnDiffSummaryByAssistantMessageId={new Map()}
          nowIso="2026-07-16T12:00:05.000Z"
          expandedWorkGroups={{}}
          onToggleWorkGroup={() => {}}
          onOpenTurnDiff={() => {}}
          revertTurnCountByUserMessageId={new Map()}
          onRevertUserMessage={() => {}}
          isRevertingCheckpoint={false}
          onImageExpand={() => {}}
          markdownCwd={undefined}
          resolvedTheme="dark"
          timestampFormat="locale"
          workspaceRoot={undefined}
        />
      </div>,
    );

    try {
      await expect.poll(() => document.querySelectorAll('[data-work-trail="true"]').length).toBe(1);

      expect(document.body.textContent ?? "").toContain("Working · 5s");
      expect(document.body.textContent ?? "").toContain("3 calls · 1 file");
      expect(document.querySelector("[data-ledger-section]")).toBeNull();
      expect(document.querySelector('[data-work-trail-sequence="1"]')).not.toBeNull();
      expect(document.querySelector('[data-work-trail-sequence="3"]')).not.toBeNull();
      expect(document.querySelector('[data-timeline-row-kind="working-header"]')).toBeNull();
    } finally {
      await screen.unmount();
    }
  });
});
