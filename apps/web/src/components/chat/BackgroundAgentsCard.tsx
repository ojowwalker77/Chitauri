// FILE: BackgroundAgentsCard.tsx
// Purpose: A compact, live list of the current turn's provider-agnostic RUNNING subagent states,
//          pinned above the composer. Deliberately minimal: one line per running agent
//          (title · current tool · tokens), no completed rows, no meter.
// Layer: Chat composer UI
// Exports: BackgroundAgentsCard

import type { ProviderKind } from "@t3tools/contracts";
import type { UnifiedSubagentState } from "@t3tools/shared/subagentActivity";
import { pluralize } from "@t3tools/shared/text";
import { memo } from "react";
import { PiArrowsInSimple, PiArrowsOutSimple } from "react-icons/pi";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { LoaderIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { AgentElapsedTimer } from "./AgentElapsedTimer";
import { AgentProviderIcon } from "./AgentProviderIcon";
import {
  ComposerStackedPanelHeaderRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
} from "./composerStackedPanelStyles";

interface BackgroundAgentsCardProps {
  /** Running agents only — completed/failed ones are filtered out by the caller. */
  agents: ReadonlyArray<UnifiedSubagentState>;
  /**
   * The session's provider — unified agents carry no display-provider field, so every row shows
   * the provider running the turn (a status dot is the fallback when it is unknown).
   */
  provider: ProviderKind | null;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
}

export const BackgroundAgentsCard = memo(function BackgroundAgentsCard({
  agents,
  provider,
  compact,
  onCompactChange,
}: BackgroundAgentsCardProps) {
  return (
    <>
      <ComposerStackedPanelHeaderRow>
        <ComposerStackedPanelRowMain>
          <LoaderIcon className={cn(COMPOSER_STACKED_PANEL_ICON_CLASS_NAME, "animate-spin")} />
          <ComposerStackedPanelRowLabel tone="meta">
            {agents.length} {pluralize(agents.length, "agent")} running
          </ComposerStackedPanelRowLabel>
        </ComposerStackedPanelRowMain>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME}
          onClick={() => onCompactChange(!compact)}
          aria-label={compact ? "Expand agents" : "Collapse agents"}
          title={compact ? "Expand agents" : "Collapse agents"}
        >
          {compact ? (
            <PiArrowsOutSimple className="size-3" />
          ) : (
            <PiArrowsInSimple className="size-3" />
          )}
        </Button>
      </ComposerStackedPanelHeaderRow>

      {compact ? null : (
        <ol className={cn("space-y-0", COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME)}>
          {agents.map((agent) => (
            <li key={agent.taskId} className="flex items-center gap-2 py-1">
              <AgentProviderIcon
                spawnCommand={agent.spawnCommand}
                sessionProvider={provider}
                className="size-3.5 shrink-0"
                fallback={<span className="size-1.5 shrink-0 rounded-full bg-sky-400/80" />}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground/85">
                {agent.title ?? "Agent"}
              </span>
              <AgentElapsedTimer startedAt={agent.startedAt} />
              {agent.currentTool ? (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
                  {agent.currentTool}
                </span>
              ) : null}
              {agent.totalTokens != null ? (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/45">
                  {formatContextWindowTokens(agent.totalTokens)}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
});

export type { BackgroundAgentsCardProps };
