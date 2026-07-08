// FILE: orchestrationSummary.logic.ts
// Purpose: Derive a roll-up over a fan-out of subagents (counts by status + completion)
//          so the inline orchestration card can show the whole fleet at a glance even when
//          only a few subagent cards are rendered.
// Layer: Chat presentation logic (pure, tested)
// Exports: deriveOrchestrationSummary, OrchestrationSummary

import type { WorkLogSubagent } from "../../session-logic";
import {
  normalizeSubagentStatusKind,
  type SubagentStatusKind,
} from "../../lib/subagentPresentation";

export interface OrchestrationSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
  stopped: number;
  queued: number;
  idle: number;
  /** completed / total in the range 0..1; 0 when there are no agents. */
  completedRatio: number;
  /** True while at least one agent is still running. */
  isLive: boolean;
}

// Mirrors the normalization used by subagentStatusClasses so the roll-up counts and the
// per-card status pills can never disagree: prefer an explicit status label, fall back to the
// raw provider status, and let an active flag force "running".
export function subagentStatusKind(subagent: WorkLogSubagent): SubagentStatusKind {
  return (
    normalizeSubagentStatusKind(
      subagent.statusLabel ?? subagent.rawStatus,
      subagent.isActive ?? false,
    ) ?? "idle"
  );
}

// Census over any list of status kinds — shared by the collab subagent cards (WorkLogSubagent)
// and the composer background-agent fleet (task.* agents) so both roll up identically.
export function summarizeAgentStatuses(
  kinds: ReadonlyArray<SubagentStatusKind>,
): OrchestrationSummary {
  const counts = { running: 0, completed: 0, failed: 0, stopped: 0, queued: 0, idle: 0 };
  for (const kind of kinds) {
    counts[kind] += 1;
  }
  const total = kinds.length;
  return {
    total,
    ...counts,
    completedRatio: total > 0 ? counts.completed / total : 0,
    isLive: counts.running > 0,
  };
}

export function deriveOrchestrationSummary(
  subagents: ReadonlyArray<WorkLogSubagent>,
): OrchestrationSummary {
  return summarizeAgentStatuses(subagents.map(subagentStatusKind));
}
