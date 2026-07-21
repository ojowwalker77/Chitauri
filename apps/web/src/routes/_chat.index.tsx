// FILE: _chat.index.tsx
// Purpose: Restores the last chat route on app launch, falling back to a fresh home-chat draft.
// Layer: Routing
// Depends on: the shared restore/create route surface plus the home-chat new-chat handler.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import {
  RestoreOrCreateChatRoute,
  type RestoreRouteResolver,
} from "../components/RestoreOrCreateChatRoute";
import { readSidebarUiState } from "../components/Sidebar.uiState";
import { resolveRestorableThreadRoute } from "../chatRouteRestore";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewChat } from "../hooks/useHandleNewChat";
import { EMPTY_THREAD_IDS, useStore } from "../store";

function ChatIndexRouteView() {
  const { handleNewChat } = useHandleNewChat();
  const threadIds = useStore((state) => state.threadIds ?? EMPTY_THREAD_IDS);
  const draftThreadsByThreadId = useComposerDraftStore((state) => state.draftThreadsByThreadId);
  const createFreshChat = useCallback(() => handleNewChat({ fresh: true }), [handleNewChat]);

  // Fresh unsent chats have a route id but no persisted sidebar summary yet, so the thread-id
  // list never contains them. Include plain, still-unsent chat drafts so a cold start on "/"
  // can restore one instead of always minting a new one. `promotedTo` means the draft already
  // became a real thread, so its stale id is no longer a valid restore target.
  const draftThreadIds = useMemo(() => {
    const draftThreadIds = new Set<string>();
    for (const [threadId, draft] of Object.entries(draftThreadsByThreadId)) {
      if (draft.promotedTo === undefined) {
        draftThreadIds.add(threadId);
      }
    }
    return draftThreadIds;
  }, [draftThreadsByThreadId]);
  const resolveRestoreRoute = useCallback<RestoreRouteResolver>(() => {
    const availableThreadIds = new Set<string>(threadIds);
    for (const draftThreadId of draftThreadIds) {
      availableThreadIds.add(draftThreadId);
    }
    return resolveRestorableThreadRoute({
      lastThreadRoute: readSidebarUiState().lastThreadRoute,
      availableThreadIds,
    });
  }, [draftThreadIds, threadIds]);

  return (
    <RestoreOrCreateChatRoute
      resolveRestoreRoute={resolveRestoreRoute}
      createFreshChat={createFreshChat}
    />
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
