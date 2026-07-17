// FILE: RestoreOrCreateChatRoute.tsx
// Purpose: Shared cold-start machinery for chat index routes — guards against briefly-empty
//          bootstrap snapshots, then defers to a caller-supplied resolver to pick the thread
//          route to restore, falling back to creating a fresh draft. Used by the home-chat index
//          route with empty-snapshot recovery.
// Layer: Routing
// Depends on: sidebar UI persistence plus caller-supplied restore/fresh-chat policy.

import { ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SplashScreen } from "./SplashScreen";
import {
  type EmptyRouteRestoreRecoveryState,
  type LastThreadRoute,
  shouldHoldRememberedRouteFallback,
  shouldStartRememberedRouteRecovery,
} from "../chatRouteRestore";
import { readSidebarUiState } from "./Sidebar.uiState";
import {
  refreshEmptyRouteRestoreSnapshot,
  waitForEmptyRouteRestoreFallbackDelay,
} from "../chatRouteRecovery";
import type { StartContainerChatResult } from "../lib/startContainerChat";
import { readNativeApi } from "../nativeApi";
import { EMPTY_THREAD_IDS, useStore } from "../store";

export type RestoreRouteResolverInput = Record<string, never>;

// Resolves which thread route (if any) this surface should restore to. Returning `null` defers
// to `createFreshChat` (e.g. because there is a draft to reopen instead of an existing thread).
export type RestoreRouteResolver = (input: RestoreRouteResolverInput) => LastThreadRoute | null;

export function RestoreOrCreateChatRoute({
  resolveRestoreRoute,
  createFreshChat,
}: {
  // Policy for picking the thread route to restore. The remembered-route recovery below still
  // keys off the total thread count.
  readonly resolveRestoreRoute: RestoreRouteResolver;
  readonly createFreshChat: () => Promise<StartContainerChatResult>;
}) {
  const navigate = useNavigate();
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const threadIds = useStore((state) => state.threadIds ?? EMPTY_THREAD_IDS);
  const [attempt, setAttempt] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emptyRestoreRecoveryState, setEmptyRestoreRecoveryState] =
    useState<EmptyRouteRestoreRecoveryState>("idle");
  const mountedRef = useRef(true);
  const emptyRestoreRecoveryRunRef = useRef(0);
  // One fresh-chat creation at a time per mount: a dep change mid-create re-runs the effect,
  // and without this guard the superseded run and the new run could both mint a draft.
  const createFreshChatInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (threadIds.length > 0 && emptyRestoreRecoveryState !== "idle") {
      emptyRestoreRecoveryRunRef.current += 1;
      setEmptyRestoreRecoveryState("idle");
    }
  }, [emptyRestoreRecoveryState, threadIds.length]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    let cancelled = false;
    setErrorMessage(null);

    void (async () => {
      const lastThreadRoute = readSidebarUiState().lastThreadRoute;
      if (
        shouldStartRememberedRouteRecovery({
          lastThreadRoute,
          availableThreadCount: threadIds.length,
          recoveryState: emptyRestoreRecoveryState,
        })
      ) {
        const recoveryRun = (emptyRestoreRecoveryRunRef.current += 1);
        setEmptyRestoreRecoveryState("pending");
        await Promise.all([
          refreshEmptyRouteRestoreSnapshot(readNativeApi()).catch(() => false),
          waitForEmptyRouteRestoreFallbackDelay(),
        ]);
        if (mountedRef.current && emptyRestoreRecoveryRunRef.current === recoveryRun) {
          setEmptyRestoreRecoveryState("done");
        }
        return;
      }

      if (
        shouldHoldRememberedRouteFallback({
          lastThreadRoute,
          availableThreadCount: threadIds.length,
          recoveryState: emptyRestoreRecoveryState,
        })
      ) {
        return;
      }

      const restorableRoute = resolveRestoreRoute({});
      if (restorableRoute) {
        if (cancelled) {
          return;
        }
        await navigate({
          to: "/$threadId",
          params: { threadId: ThreadId.makeUnsafe(restorableRoute.threadId) },
          replace: true,
        });
        return;
      }

      if (cancelled || createFreshChatInFlightRef.current) {
        return;
      }
      createFreshChatInFlightRef.current = true;
      let result: StartContainerChatResult;
      try {
        result = await createFreshChat();
      } finally {
        createFreshChatInFlightRef.current = false;
      }
      if (cancelled || result.ok) {
        return;
      }
      setErrorMessage(result.error);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    attempt,
    createFreshChat,
    emptyRestoreRecoveryState,
    navigate,
    resolveRestoreRoute,
    threadIds.length,
    threadsHydrated,
  ]);

  return (
    <SplashScreen
      errorMessage={errorMessage}
      onRetry={errorMessage ? () => setAttempt((value) => value + 1) : null}
    />
  );
}
