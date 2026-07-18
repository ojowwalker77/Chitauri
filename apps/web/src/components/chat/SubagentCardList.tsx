// FILE: SubagentCardList.tsx
// Purpose: Shared rendering for a fan-out of subagents — the roll-up "orchestration" header
//          plus the per-subagent cards. Extracted from MessagesTimeline so the transcript and
//          any other surface render the exact same cards (no duplicated markup or status palette).
// Layer: Chat presentation component
// Exports: SubagentCardList, subagentStatusClasses

import type { ThreadId } from "@t3tools/contracts";
import { ThreadId as ThreadIdCtor } from "@t3tools/contracts";
import { memo } from "react";

import { BotIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  formatSubagentModelLabel,
  humanizeSubagentStatus,
  resolveSubagentPresentation,
} from "../../lib/subagentPresentation";
import type { WorkLogSubagent } from "../../session-logic";
import {
  OrchestrationCensusChips,
  OrchestrationCensusMeter,
  subagentStatusClasses,
} from "./agentStatus";
import { deriveOrchestrationSummary } from "./orchestrationSummary.logic";

// Re-exported for existing importers (the transcript pulls the pill palette from here).
export { subagentStatusClasses };

// How many subagent cards render inline before the rest collapse into a "+N more" affordance.
// The roll-up header still counts the whole fleet, so a capped list never hides the totals.
const MAX_VISIBLE_SUBAGENTS = 3;

export function subagentPrimaryLabel(
  subagent: WorkLogSubagent,
): ReturnType<typeof resolveSubagentPresentation> {
  return resolveSubagentPresentation({
    nickname: subagent.nickname,
    role: subagent.role,
    title: subagent.title,
    fallbackId: subagent.threadId,
  });
}

function subagentSecondaryLabel(subagent: WorkLogSubagent, primaryLabel: string): string | null {
  const parts = [subagent.title, formatSubagentModelLabel(subagent.model)]
    .filter((value): value is string => Boolean(value))
    .filter((value) => value !== primaryLabel);
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" • ");
}

// The roll-up header: a one-line census of the fan-out (N agents + status chips) with a slim
// completion meter. Shown only for a genuine fleet (>= 2 agents); a lone subagent needs no census.
function OrchestrationSummaryHeader(props: {
  subagents: ReadonlyArray<WorkLogSubagent>;
  rowFontSizePx: number;
}) {
  const summary = deriveOrchestrationSummary(props.subagents);
  return (
    <div className="flex flex-col gap-1.5 pb-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <BotIcon className="size-3 shrink-0 text-muted-foreground/45" />
        <span
          className="shrink-0 font-semibold text-foreground/82"
          style={{ fontSize: `${props.rowFontSizePx}px` }}
        >
          {summary.total} agents
        </span>
        {summary.isLive ? (
          <span className="size-1 shrink-0 animate-pulse rounded-full bg-info" />
        ) : null}
        <span className="min-w-1 flex-1" />
        <OrchestrationCensusChips summary={summary} />
      </div>
      <OrchestrationCensusMeter ratio={summary.completedRatio} />
    </div>
  );
}

interface SubagentCardListProps {
  subagents: ReadonlyArray<WorkLogSubagent>;
  compact: boolean;
  rowFontSizePx: number;
  /** Stable prefix (e.g. the work entry id) so card keys stay stable across renders. */
  keyPrefix: string;
  onOpenThread?: (threadId: ThreadId) => void;
}

export const SubagentCardList = memo(function SubagentCardList({
  subagents,
  compact,
  rowFontSizePx,
  keyPrefix,
  onOpenThread,
}: SubagentCardListProps) {
  if (subagents.length === 0) {
    return null;
  }

  const visibleSubagents = subagents.slice(0, MAX_VISIBLE_SUBAGENTS);
  const hiddenSubagentCount = Math.max(0, subagents.length - visibleSubagents.length);
  const canOpenThread = Boolean(onOpenThread);
  const showSummary = subagents.length >= 2;

  return (
    <div
      className={cn(
        "space-y-[5px] rounded-[10px] border border-panel-border bg-panel",
        compact ? "px-2.5 py-2" : "px-3 py-[9px]",
      )}
    >
      {showSummary ? (
        <OrchestrationSummaryHeader subagents={subagents} rowFontSizePx={rowFontSizePx} />
      ) : null}
      {visibleSubagents.map((subagent) => {
        const presentation = subagentPrimaryLabel(subagent);
        const primaryLabel = presentation.primaryLabel;
        const secondaryLabel = subagentSecondaryLabel(subagent, primaryLabel);
        const displayStatusLabel =
          subagent.statusLabel ?? humanizeSubagentStatus(subagent.rawStatus, subagent.isActive);
        return (
          <div
            key={`${keyPrefix}:${subagent.threadId}`}
            className="flex items-start gap-2.5 rounded-xl border border-border/28 bg-background/82 px-[11px] py-2"
          >
            <span
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                subagent.isActive ? "animate-pulse bg-info" : "bg-muted-foreground/22",
              )}
            />
            <div className="min-w-0 flex-1">
              <div
                className="truncate font-semibold leading-[18px] text-foreground/90"
                style={{ fontSize: `${rowFontSizePx}px` }}
                title={presentation.fullLabel}
              >
                <span style={{ color: presentation.accentColor }}>
                  {presentation.nickname ?? primaryLabel}
                </span>
                {presentation.role ? (
                  <span className="ml-1 text-[11px] font-medium text-muted-foreground/48">
                    ({presentation.role})
                  </span>
                ) : null}
              </div>
              {secondaryLabel ? (
                <div
                  className="truncate pt-0.5 leading-4 text-muted-foreground/56"
                  style={{ fontSize: `${Math.max(11, rowFontSizePx - 1)}px` }}
                  title={secondaryLabel}
                >
                  {secondaryLabel}
                </div>
              ) : null}
              {subagent.latestUpdate ? (
                <div
                  className="flex items-baseline gap-1.5 pt-1 text-muted-foreground/42"
                  style={{ fontSize: `${Math.max(11, rowFontSizePx - 2)}px` }}
                  title={subagent.latestUpdate}
                >
                  <span className="shrink-0 text-muted-foreground/30">Latest</span>
                  <span className="truncate">{subagent.latestUpdate}</span>
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {displayStatusLabel ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-[0.08em]",
                    subagentStatusClasses(
                      displayStatusLabel,
                      subagent.rawStatus,
                      subagent.isActive,
                    ),
                  )}
                >
                  {displayStatusLabel}
                </span>
              ) : null}
              <button
                type="button"
                className={cn(
                  "shrink-0 rounded-full border border-border/45 px-2.5 py-1 text-[11px] font-medium text-muted-foreground/62 transition-colors",
                  canOpenThread
                    ? "hover:border-foreground/15 hover:text-foreground/84"
                    : "cursor-default opacity-50",
                )}
                disabled={!canOpenThread}
                onClick={() =>
                  onOpenThread?.(
                    ThreadIdCtor.makeUnsafe(subagent.resolvedThreadId ?? subagent.threadId),
                  )
                }
              >
                Open thread
              </button>
            </div>
          </div>
        );
      })}
      {hiddenSubagentCount > 0 ? (
        <div className="pl-4 text-[11px] text-muted-foreground/46">+{hiddenSubagentCount} more</div>
      ) : null}
    </div>
  );
});

export type { SubagentCardListProps };
