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

// Status palette shared by the per-agent pill and the census chips: running=sky, completed=emerald,
// failed=rose, stopped=amber, queued=violet, idle=muted. Identical strings the transcript used.
export const STATUS_KIND_CLASSES: Record<SubagentStatusKind, string> = {
  running: "border-sky-500/18 bg-sky-500/8 text-sky-200/90",
  completed: "border-emerald-500/18 bg-emerald-500/8 text-emerald-200/90",
  failed: "border-rose-500/18 bg-rose-500/8 text-rose-200/90",
  stopped: "border-amber-500/18 bg-amber-500/8 text-amber-200/90",
  queued: "border-violet-500/18 bg-violet-500/8 text-violet-200/90",
  idle: "border-border/45 bg-background/85 text-muted-foreground/68",
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
            "rounded-full border px-1.5 py-0.5 text-[9px] font-medium tabular-nums tracking-[0.04em]",
            STATUS_KIND_CLASSES[chip.kind],
          )}
        >
          {chip.count} {STATUS_KIND_LABEL[chip.kind]}
        </span>
      ))}
    </div>
  );
}

/** Slim emerald completion meter (completed / total). */
export function OrchestrationCensusMeter({ ratio }: { ratio: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-muted-foreground/12">
      <div
        className="h-full rounded-full bg-emerald-400/55 transition-[width] duration-220 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </div>
  );
}
