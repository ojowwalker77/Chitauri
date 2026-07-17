// FILE: workspaceStore.ts
// Purpose: Persists server-provided filesystem roots used by chat and project flows.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  normalizeServerWorkspacePaths,
  type ServerWorkspacePaths,
} from "./lib/serverWorkspacePaths";

interface WorkspaceStoreState {
  homeDir: string | null;
  chatWorkspaceRoot: string | null;
  setHomeDir: (homeDir: string | null | undefined) => void;
  setChatWorkspaceRoot: (chatWorkspaceRoot: string | null | undefined) => void;
  setServerWorkspacePaths: (paths: ServerWorkspacePaths) => void;
}

const WORKSPACE_STORE_STORAGE_KEY = "teacode:workspace-paths:v1";

function normalizePath(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : (value?.trim() ?? null);
}

export const useWorkspaceStore = create<WorkspaceStoreState>()(
  persist(
    (set) => ({
      homeDir: null,
      chatWorkspaceRoot: null,
      setHomeDir: (homeDir) =>
        set((state) => {
          const next = normalizePath(homeDir);
          return next === undefined || next === state.homeDir ? state : { homeDir: next };
        }),
      setChatWorkspaceRoot: (chatWorkspaceRoot) =>
        set((state) => {
          const next = normalizePath(chatWorkspaceRoot);
          return next === undefined || next === state.chatWorkspaceRoot
            ? state
            : { chatWorkspaceRoot: next };
        }),
      setServerWorkspacePaths: (paths) =>
        set((state) => {
          const normalized = normalizeServerWorkspacePaths(paths);
          const next: Partial<WorkspaceStoreState> = {};
          if (paths.homeDir !== undefined && normalized.homeDir !== state.homeDir) {
            next.homeDir = normalized.homeDir;
          }
          if (
            paths.chatWorkspaceRoot !== undefined &&
            normalized.chatWorkspaceRoot !== state.chatWorkspaceRoot
          ) {
            next.chatWorkspaceRoot = normalized.chatWorkspaceRoot;
          }
          return Object.keys(next).length > 0 ? next : state;
        }),
    }),
    {
      name: WORKSPACE_STORE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        homeDir: state.homeDir,
        chatWorkspaceRoot: state.chatWorkspaceRoot,
      }),
    },
  ),
);
