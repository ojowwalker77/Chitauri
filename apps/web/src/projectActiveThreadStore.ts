// FILE: projectActiveThreadStore.ts
// Purpose: Remember the last thread selected inside each project so the project header's
//          middle destination stays pointed at it while the user is on that project's
//          Research or GitHub surface.
// Layer: Web client state
//
// The chat surface records (project → thread) whenever a thread is active; the standalone
// Research/GitHub surfaces read it back to label and target their middle tab. Persisting it
// keeps the destination stable across reloads and back/forward navigation.

import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const PROJECT_ACTIVE_THREAD_STORAGE_KEY = "teacode:project-active-thread:v1";

interface ProjectActiveThreadStore {
  activeThreadByProjectId: Record<ProjectId, ThreadId>;
  setActiveThread: (projectId: ProjectId, threadId: ThreadId) => void;
  clearProject: (projectId: ProjectId) => void;
}

export const useProjectActiveThreadStore = create<ProjectActiveThreadStore>()(
  persist(
    (set) => ({
      activeThreadByProjectId: {},
      setActiveThread: (projectId, threadId) =>
        set((state) => {
          if (state.activeThreadByProjectId[projectId] === threadId) {
            return state;
          }
          return {
            activeThreadByProjectId: {
              ...state.activeThreadByProjectId,
              [projectId]: threadId,
            },
          };
        }),
      clearProject: (projectId) =>
        set((state) => {
          if (!(projectId in state.activeThreadByProjectId)) {
            return state;
          }
          const next = { ...state.activeThreadByProjectId };
          delete next[projectId];
          return { activeThreadByProjectId: next };
        }),
    }),
    {
      name: PROJECT_ACTIVE_THREAD_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Guard against a corrupt persisted payload reaching consumers that treat the
      // values as thread ids.
      merge: (persisted, current) => {
        const persistedMap = (persisted as { activeThreadByProjectId?: unknown } | undefined)
          ?.activeThreadByProjectId;
        const safeMap: Record<ProjectId, ThreadId> = {};
        if (persistedMap && typeof persistedMap === "object") {
          for (const [projectId, threadId] of Object.entries(persistedMap as object)) {
            if (typeof threadId === "string") {
              safeMap[projectId as ProjectId] = threadId as ThreadId;
            }
          }
        }
        return { ...current, activeThreadByProjectId: safeMap };
      },
    },
  ),
);
