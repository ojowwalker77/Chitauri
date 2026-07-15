// FILE: ComposerBackgroundAgentsCard.tsx
// Purpose: Wraps BackgroundAgentsCard in the shared stacked-panel frame so the fleet card pins
//          flush above the composer, exactly like the active-task-list card.
// Layer: Chat composer UI
// Exports: ComposerBackgroundAgentsCard

import type { ProviderKind } from "@t3tools/contracts";
import type { UnifiedSubagentState } from "@t3tools/shared/subagentActivity";
import { memo } from "react";

import { BackgroundAgentsCard } from "./BackgroundAgentsCard";
import { ComposerStackedPanel } from "./ComposerStackedPanel";

interface ComposerBackgroundAgentsCardProps {
  agents: ReadonlyArray<UnifiedSubagentState>;
  provider: ProviderKind | null;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  attachedToPrevious?: boolean;
}

export const ComposerBackgroundAgentsCard = memo(function ComposerBackgroundAgentsCard({
  agents,
  provider,
  compact,
  onCompactChange,
  attachedToPrevious = false,
}: ComposerBackgroundAgentsCardProps) {
  return (
    <ComposerStackedPanel
      passthroughSideMargins
      attachedToPrevious={attachedToPrevious}
      data-testid="background-agents-card"
    >
      <BackgroundAgentsCard
        agents={agents}
        provider={provider}
        compact={compact}
        onCompactChange={onCompactChange}
      />
    </ComposerStackedPanel>
  );
});
