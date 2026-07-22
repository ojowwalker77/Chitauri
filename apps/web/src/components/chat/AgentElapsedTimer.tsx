import { memo } from "react";

import { useNowMs } from "../../hooks/useNowMs";
import { formatClockDuration } from "../../session-logic";

interface AgentElapsedTimerProps {
  startedAt: string;
}

export const AgentElapsedTimer = memo(function AgentElapsedTimer({
  startedAt,
}: AgentElapsedTimerProps) {
  const nowMs = useNowMs(true, 1_000);
  const elapsedMs = nowMs - Date.parse(startedAt);

  if (Number.isNaN(elapsedMs) || elapsedMs < 0) {
    return null;
  }

  return (
    <span className="shrink-0 font-mono text-xs tabular-nums text-faint">
      {formatClockDuration(elapsedMs)}
    </span>
  );
});
