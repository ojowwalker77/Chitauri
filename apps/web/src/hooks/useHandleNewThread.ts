import { type ProjectId, ThreadId } from "@t3tools/contracts";
import { getDefaultModel } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useAppSettings } from "../appSettings";
import {
  type ComposerThreadDraftState,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import {
  buildDraftThreadContextPatch,
  createActiveDraftThreadSnapshot,
  createActiveThreadSnapshot,
  createFreshDraftThreadSeed,
  isConsumedDraftThread,
  resolveThreadBootstrapPlan,
  type NewThreadOptions,
} from "../lib/threadBootstrap";
import { newThreadId } from "../lib/utils";
import { useFocusedChatContext } from "../focusedChatContext";
import { useStore } from "../store";

export interface NewThreadNavigationOptions {
  /**
   * Search params applied when the hook navigates to the created thread.
   * Lets callers keep view-level state (e.g. the editor workspace view)
   * across the route change; default navigation clears all search params.
   */
  search?: (previous: Record<string, unknown>) => Record<string, unknown>;
  /** Lets first-class non-chat surfaces keep their own route while reusing thread bootstrapping. */
  navigate?: (threadId: ThreadId) => Promise<void>;
}

export function useHandleNewThread() {
  const projects = useStore((store) => store.projects);
  const { settings } = useAppSettings();
  const navigate = useNavigate();
  const { activeDraftThread, activeProjectId, activeThread, focusedThreadId, routeThreadId } =
    useFocusedChatContext();

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: NewThreadOptions,
      navigation?: NewThreadNavigationOptions,
    ): Promise<ThreadId> => {
      const navigateToThread = (threadId: ThreadId) =>
        navigation?.navigate
          ? navigation.navigate(threadId)
          : navigate({
              to: "/$threadId",
              params: { threadId },
              ...(navigation?.search ? { search: navigation.search } : {}),
            });
      const applyProviderOverride = (threadId: ThreadId) => {
        if (!options?.provider) {
          return;
        }
        const defaultModel = getDefaultModel(options.provider);
        if (!defaultModel) {
          return;
        }
        setModelSelection(threadId, {
          provider: options.provider,
          model: defaultModel,
        });
      };
      const restoreComposerDraft = (
        threadId: ThreadId,
        draftState: ComposerThreadDraftState | null,
      ) => {
        if (!draftState) {
          return;
        }
        useComposerDraftStore.setState((state) => {
          if (state.draftsByThreadId[threadId] === draftState) {
            return state;
          }
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: draftState,
            },
          };
        });
      };
      const {
        clearProjectDraftThreadId,
        getDraftThread,
        getDraftThreadByProjectId,
        applyStickyState,
        setDraftThreadContext,
        setProjectDraftThreadId,
        setModelSelection,
      } = useComposerDraftStore.getState();
      const shouldForceFreshThread = options?.fresh === true;

      if (shouldForceFreshThread) {
        clearProjectDraftThreadId(projectId);
      }

      // Read the live store: a draft whose thread has since been promoted (sent) is no longer a
      // reusable draft, even though the project mapping still points at it.
      const isDraftThreadConsumed = (candidateThreadId: ThreadId): boolean => {
        const store = useStore.getState();
        return isConsumedDraftThread({
          hasLatestTurn: store.sidebarThreadSummaryById[candidateThreadId]?.latestTurn != null,
          hasServerThread: store.threads.some((thread) => thread.id === candidateThreadId),
        });
      };

      const storedDraftThreadCandidateRaw = getDraftThreadByProjectId(projectId);
      let storedDraftThreadCandidate = storedDraftThreadCandidateRaw;
      if (
        storedDraftThreadCandidateRaw &&
        isDraftThreadConsumed(storedDraftThreadCandidateRaw.threadId)
      ) {
        clearProjectDraftThreadId(projectId);
        storedDraftThreadCandidate = null;
      }
      const latestActiveDraftThreadCandidate: DraftThreadState | null =
        focusedThreadId && !isDraftThreadConsumed(focusedThreadId)
          ? getDraftThread(focusedThreadId)
          : null;
      const storedDraftThread = !shouldForceFreshThread ? storedDraftThreadCandidate : null;
      const latestActiveDraftThread: DraftThreadState | null = !shouldForceFreshThread
        ? latestActiveDraftThreadCandidate
        : null;
      const bootstrapPlan = resolveThreadBootstrapPlan({
        storedDraftThread,
        latestActiveDraftThread,
        projectId,
        routeThreadId: focusedThreadId,
      });
      // Read from the store at call time so post-sync sidebar flows can use the latest project defaults.
      const projectDefaultModelSelection =
        useStore.getState().projects.find((project) => project.id === projectId)
          ?.defaultModelSelection ?? null;
      if (bootstrapPlan.kind === "stored") {
        return (async (): Promise<ThreadId> => {
          const preservedComposerDraft =
            useComposerDraftStore.getState().draftsByThreadId[bootstrapPlan.threadId] ?? null;
          const draftContextPatch = buildDraftThreadContextPatch(options);
          if (draftContextPatch) {
            setDraftThreadContext(bootstrapPlan.threadId, draftContextPatch);
          }
          applyProviderOverride(bootstrapPlan.threadId);
          setProjectDraftThreadId(projectId, bootstrapPlan.threadId);
          restoreComposerDraft(bootstrapPlan.threadId, preservedComposerDraft);
          if (focusedThreadId === bootstrapPlan.threadId) {
            return bootstrapPlan.threadId;
          }
          await navigateToThread(bootstrapPlan.threadId);
          restoreComposerDraft(bootstrapPlan.threadId, preservedComposerDraft);
          return bootstrapPlan.threadId;
        })();
      }

      clearProjectDraftThreadId(projectId);

      if (bootstrapPlan.kind === "route") {
        return (async (): Promise<ThreadId> => {
          const preservedComposerDraft =
            useComposerDraftStore.getState().draftsByThreadId[bootstrapPlan.threadId] ?? null;
          const draftContextPatch = buildDraftThreadContextPatch(options);
          if (draftContextPatch) {
            setDraftThreadContext(bootstrapPlan.threadId, draftContextPatch);
          }
          applyProviderOverride(bootstrapPlan.threadId);
          setProjectDraftThreadId(projectId, bootstrapPlan.threadId);
          restoreComposerDraft(bootstrapPlan.threadId, preservedComposerDraft);
          return bootstrapPlan.threadId;
        })();
      }

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async (): Promise<ThreadId> => {
        setProjectDraftThreadId(projectId, threadId, {
          ...createFreshDraftThreadSeed({
            createdAt,
            options: {
              ...options,
              runtimeMode: options?.runtimeMode ?? settings.defaultRuntimeMode,
            },
          }),
        });
        applyStickyState(threadId);
        applyProviderOverride(threadId);

        await navigateToThread(threadId);
        return threadId;
      })();
    },
    [navigate, focusedThreadId, settings.defaultRuntimeMode],
  );

  return {
    activeDraftThread,
    activeProjectId,
    activeThread,
    activeContextThreadId: focusedThreadId,
    handleNewThread,
    projects,
    routeThreadId,
  };
}
