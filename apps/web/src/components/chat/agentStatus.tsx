// FILE: agentStatus.tsx
// Purpose: Single source for agent-status styling (the running/done/failed/… palette) and the
//          shared "orchestration census" bits (status-count chips + completion meter). Consumed by
//          both the transcript subagent cards and the composer-pinned background-agent fleet card,
//          so the two surfaces can never drift on colour, label, or layout.
// Layer: Chat presentation component

import { cn } from "~/lib/utils";
import {
  normalizeSubagentStatusKind,
  type SubagentStatusKind,
} from "../../lib/subagentPresentation";
import type { OrchestrationSummary } from "./orchestrationSummary.logic";

// Status palette shared by the per-agent pill and census chips. Only the three
// semantic hues carry meaning: info marks a live/in-progress agent, green is health,
// red is failure; cancelled and queued/idle stay quiet monochrome.
export const STATUS_KIND_CLASSES: Record<SubagentStatusKind, string> = {
  running: "border-info/30 bg-info/10 text-info",
  completed: "border-success/30 bg-success/10 text-success",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  stopped: "border-border bg-hover text-muted-foreground",
  queued: "border-border bg-hover text-muted-foreground",
  idle: "border-border bg-background text-muted-foreground",
};

export const STATUS_KIND_LABEL: Record<SubagentStatusKind, string> = {
  running: "running",
  completed: "done",
  failed: "failed",
  stopped: "stopped",
  queued: "queued",
  idle: "idle",
};

// Order the census chips by liveness so the eye lands on what is in flight first.
export const SUMMARY_CHIP_ORDER = [
  "running",
  "queued",
  "completed",
  "failed",
  "stopped",
] as const satisfies ReadonlyArray<SubagentStatusKind>;

export function subagentStatusClasses(
  statusLabel: string | undefined,
  rawStatus: string | undefined,
  isActive: boolean | undefined,
): string {
  return STATUS_KIND_CLASSES[
    normalizeSubagentStatusKind(statusLabel ?? rawStatus, isActive) ?? "idle"
  ];
}

/** Status-colored count chips ("2 running", "3 done", …) for the non-zero kinds. */
export function OrchestrationCensusChips({
  summary,
  className,
}: {
  summary: OrchestrationSummary;
  className?: string;
}) {
  const chips = SUMMARY_CHIP_ORDER.map((kind) => ({ kind, count: summary[kind] })).filter(
    (chip) => chip.count > 0,
  );
  if (chips.length === 0) {
    return null;
  }
  return (
    <div className={cn("flex shrink-0 flex-wrap items-center justify-end gap-1", className)}>
      {chips.map((chip) => (
        <span
          key={chip.kind}
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-xs font-medium tabular-nums",
            STATUS_KIND_CLASSES[chip.kind],
          )}
        >
          {chip.count} {STATUS_KIND_LABEL[chip.kind]}
        </span>
      ))}
    </div>
  );
}

/** Slim success completion meter (completed / total). */
export function OrchestrationCensusMeter({ ratio }: { ratio: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-muted-foreground/12">
      <div
        className="h-full rounded-full bg-success/55 transition-[width] duration-220 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </div>
  );
}
