// FILE: focusedChatContext.ts
// Purpose: Resolves the active single-chat route into its thread and project context.

import { ThreadId, type ThreadId as ThreadIdType } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

import { type DraftThreadState, useComposerDraftStore } from "./composerDraftStore";
import { useStore } from "./store";
import { createProjectSelector, createThreadSelector } from "./storeSelectors";
import type { Project, Thread } from "./types";

export interface FocusedChatContext {
  routeThreadId: ThreadIdType | null;
  focusedThreadId: ThreadIdType | null;
  activeThread: Thread | null;
  activeDraftThread: DraftThreadState | null;
  activeProjectId: Project["id"] | null;
  activeProject: Project | null;
}

export function resolveFocusedChatContext(input: {
  routeThreadId: ThreadIdType | null;
  threads: readonly Thread[];
  projects: readonly Project[];
  draftThreadsByThreadId: Record<string, DraftThreadState | undefined>;
}): FocusedChatContext {
  const focusedThreadId = input.routeThreadId;
  const activeThread =
    focusedThreadId !== null
      ? (input.threads.find((thread) => thread.id === focusedThreadId) ?? null)
      : null;
  const activeDraftThread =
    focusedThreadId !== null ? (input.draftThreadsByThreadId[focusedThreadId] ?? null) : null;
  const activeProjectId = activeDraftThread?.projectId ?? activeThread?.projectId ?? null;
  const activeProject =
    activeProjectId !== null
      ? (input.projects.find((project) => project.id === activeProjectId) ?? null)
      : null;

  return {
    routeThreadId: input.routeThreadId,
    focusedThreadId,
    activeThread,
    activeDraftThread,
    activeProjectId,
    activeProject,
  };
}

export function useFocusedChatContext(): FocusedChatContext {
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeThread = useStore(
    useMemo(() => createThreadSelector(routeThreadId), [routeThreadId]),
  );
  const activeDraftThread =
    routeThreadId !== null ? (draftThreadsByThreadId[routeThreadId] ?? null) : null;
  const activeProjectId = activeDraftThread?.projectId ?? activeThread?.projectId ?? null;
  const activeProject = useStore(
    useMemo(() => createProjectSelector(activeProjectId), [activeProjectId]),
  );

  return useMemo(
    () => ({
      routeThreadId,
      focusedThreadId: routeThreadId,
      activeThread: activeThread ?? null,
      activeDraftThread,
      activeProjectId,
      activeProject: activeProject ?? null,
    }),
    [activeDraftThread, activeProject, activeProjectId, activeThread, routeThreadId],
  );
}
