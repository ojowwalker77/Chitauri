import { useCallback } from "react";
import type { useNavigate } from "@tanstack/react-router";
import type { ThreadId } from "@t3tools/contracts";

import type { LastThreadRoute } from "../chatRouteRestore";
import type { SidebarThreadSummary } from "../types";

type Navigate = ReturnType<typeof useNavigate>;

export type ThreadActivationControllerInput = {
  clearSelection: () => void;
  navigate: Navigate;
  prewarmThreadDetailForIntent: (threadId: ThreadId) => void;
  rememberLastThreadRouteNow: (nextLastThreadRoute: LastThreadRoute) => void;
  routeThreadId: ThreadId | null | undefined;
  selectedThreadCount: number;
  setOptimisticActiveThreadId: (threadId: ThreadId) => void;
  setSelectionAnchor: (threadId: ThreadId) => void;
  sidebarThreadSummaryById: Readonly<
    Partial<Record<ThreadId, Pick<SidebarThreadSummary, "id" | "projectId">>>
  >;
};

export function activateThreadFromSidebarIntent(
  input: ThreadActivationControllerInput,
  threadId: ThreadId,
): void {
  if (!input.sidebarThreadSummaryById[threadId] || input.routeThreadId === threadId) {
    return;
  }

  input.prewarmThreadDetailForIntent(threadId);
  input.setOptimisticActiveThreadId(threadId);
  if (input.selectedThreadCount > 0) {
    input.clearSelection();
  }
  input.setSelectionAnchor(threadId);
  input.rememberLastThreadRouteNow({ threadId });

  void input.navigate({
    to: "/$threadId",
    params: { threadId },
  });
}

export function useThreadActivationController(input: ThreadActivationControllerInput): {
  activateThreadFromSidebarIntent: (threadId: ThreadId) => void;
} {
  const activateThread = useCallback(
    (threadId: ThreadId) => activateThreadFromSidebarIntent(input, threadId),
    [input],
  );
  return { activateThreadFromSidebarIntent: activateThread };
}
