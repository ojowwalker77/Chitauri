// FILE: _chat.$threadId.tsx
// Purpose: Resolves the active thread route into its chat surface.
// Layer: Route container
// Depends on: ChatView and the thread-route restore helpers.

import { type ProjectId, ThreadId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import ChatView from "../components/ChatView";
import { ProjectSurfaceFrame } from "../components/ProjectSurfaceFrame";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  type EmptyRouteRestoreRecoveryState,
  shouldHoldMissingThreadRouteFallback,
  shouldStartMissingThreadRouteRecovery,
} from "../chatRouteRestore";
import {
  refreshEmptyRouteRestoreSnapshot,
  waitForEmptyRouteRestoreFallbackDelay,
} from "../chatRouteRecovery";
import { SINGLE_CHAT_PANE_SCOPE_ID } from "../lib/chatPaneScope";
import { useStore } from "../store";
import { readNativeApi } from "../nativeApi";
import { createThreadExistsSelector, createThreadProjectIdSelector } from "../storeSelectors";
import {
  CHAT_SURFACE_TRANSPARENT_CLASS_NAME,
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import { cn } from "~/lib/utils";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";

function resolveSingleProjectId(input: {
  threadProjectId: ProjectId | null;
  draftProjectId: ProjectId | null;
}): ProjectId | null {
  return input.threadProjectId ?? input.draftProjectId ?? null;
}

function SingleChatSurface(props: { threadId: ThreadId }) {
  return (
    <ProjectSurfaceFrame>
      <div
        className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
      >
        <RouteInsetSurface surfaceClassName={CHAT_SURFACE_TRANSPARENT_CLASS_NAME}>
          <ChatView
            threadId={props.threadId}
            paneScopeId={SINGLE_CHAT_PANE_SCOPE_ID}
            surfaceMode="single"
            isFocusedPane={true}
          />
        </RouteInsetSurface>
      </div>
    </ProjectSurfaceFrame>
  );
}

function ChatThreadRouteView() {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const hasKnownServerThreads = useStore(
    (store) => (store.threadIds?.length ?? 0) > 0 || store.threads.length > 0,
  );
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const threadProjectIdSelector = useMemo(
    () => createThreadProjectIdSelector(threadId),
    [threadId],
  );
  const threadExistsSelector = useMemo(() => createThreadExistsSelector(threadId), [threadId]);
  const threadProjectId: ProjectId | null = useStore(threadProjectIdSelector);
  const threadExists = useStore(threadExistsSelector);
  const draftThreadState = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const draftThreadExists = draftThreadState !== null;
  const routeThreadExists = threadExists || draftThreadExists;
  // Resolved for parity with the previous route shape; kept so future surfaces can
  // scope to the thread's project without re-deriving it here.
  void resolveSingleProjectId({
    threadProjectId,
    draftProjectId: draftThreadState?.projectId ?? null,
  });
  const navigate = useNavigate();
  const [missingThreadRecoveryState, setMissingThreadRecoveryState] =
    useState<EmptyRouteRestoreRecoveryState>("idle");
  const mountedRef = useRef(true);
  const missingThreadRecoveryRunRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    missingThreadRecoveryRunRef.current += 1;
    setMissingThreadRecoveryState("idle");
  }, [threadId]);

  useEffect(() => {
    if (routeThreadExists && missingThreadRecoveryState !== "idle") {
      missingThreadRecoveryRunRef.current += 1;
      setMissingThreadRecoveryState("idle");
    }
  }, [missingThreadRecoveryState, routeThreadExists]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      if (
        shouldStartMissingThreadRouteRecovery({
          hasKnownServerThreads,
          recoveryState: missingThreadRecoveryState,
          routeThreadExists,
        })
      ) {
        const recoveryRun = (missingThreadRecoveryRunRef.current += 1);
        setMissingThreadRecoveryState("pending");
        void Promise.all([
          refreshEmptyRouteRestoreSnapshot(readNativeApi()).catch(() => false),
          waitForEmptyRouteRestoreFallbackDelay(),
        ]).finally(() => {
          if (mountedRef.current && missingThreadRecoveryRunRef.current === recoveryRun) {
            setMissingThreadRecoveryState("done");
          }
        });
        return;
      }

      if (
        shouldHoldMissingThreadRouteFallback({
          hasKnownServerThreads,
          recoveryState: missingThreadRecoveryState,
          routeThreadExists,
        })
      ) {
        return;
      }
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [
    hasKnownServerThreads,
    missingThreadRecoveryState,
    navigate,
    routeThreadExists,
    threadId,
    threadsHydrated,
  ]);

  if (
    !threadsHydrated ||
    shouldHoldMissingThreadRouteFallback({
      hasKnownServerThreads,
      recoveryState: missingThreadRecoveryState,
      routeThreadExists,
    })
  ) {
    return null;
  }

  if (!routeThreadExists) {
    return null;
  }

  return <SingleChatSurface threadId={threadId} />;
}

export const Route = createFileRoute("/_chat/$threadId")({
  component: ChatThreadRouteView,
});
