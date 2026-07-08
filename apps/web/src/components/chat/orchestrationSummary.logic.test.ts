import { describe, expect, it } from "vitest";

import type { WorkLogSubagent } from "../../session-logic";
import { deriveOrchestrationSummary, subagentStatusKind } from "./orchestrationSummary.logic";

function subagent(partial: Partial<WorkLogSubagent>): WorkLogSubagent {
  return { threadId: partial.threadId ?? "subagent:parent:child", ...partial };
}

describe("subagentStatusKind", () => {
  it("lets an active flag force running regardless of the raw status", () => {
    expect(subagentStatusKind(subagent({ rawStatus: "completed", isActive: true }))).toBe(
      "running",
    );
  });

  it("prefers the explicit status label over the raw status", () => {
    expect(subagentStatusKind(subagent({ statusLabel: "Done", rawStatus: "running" }))).toBe(
      "completed",
    );
  });

  it("falls back to idle for unknown/missing statuses", () => {
    expect(subagentStatusKind(subagent({}))).toBe("idle");
    expect(subagentStatusKind(subagent({ rawStatus: "unknown" }))).toBe("idle");
  });
});

describe("deriveOrchestrationSummary", () => {
  it("returns an all-zero, non-live summary for an empty fleet", () => {
    expect(deriveOrchestrationSummary([])).toEqual({
      total: 0,
      running: 0,
      completed: 0,
      failed: 0,
      stopped: 0,
      queued: 0,
      idle: 0,
      completedRatio: 0,
      isLive: false,
    });
  });

  it("tallies each status kind and marks the run live while an agent is running", () => {
    const summary = deriveOrchestrationSummary([
      subagent({ threadId: "a", isActive: true }),
      subagent({ threadId: "b", rawStatus: "completed" }),
      subagent({ threadId: "c", rawStatus: "completed" }),
      subagent({ threadId: "d", rawStatus: "failed" }),
      subagent({ threadId: "e", rawStatus: "queued" }),
      subagent({ threadId: "f", rawStatus: "stopped" }),
    ]);

    expect(summary.total).toBe(6);
    expect(summary.running).toBe(1);
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.queued).toBe(1);
    expect(summary.stopped).toBe(1);
    expect(summary.isLive).toBe(true);
    expect(summary.completedRatio).toBeCloseTo(2 / 6);
  });

  it("is not live once every agent has settled", () => {
    const summary = deriveOrchestrationSummary([
      subagent({ threadId: "a", rawStatus: "completed" }),
      subagent({ threadId: "b", rawStatus: "failed" }),
    ]);

    expect(summary.isLive).toBe(false);
    expect(summary.completedRatio).toBeCloseTo(0.5);
  });
});
