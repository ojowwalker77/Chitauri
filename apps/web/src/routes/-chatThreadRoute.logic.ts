// FILE: chatThreadRoute.logic.ts
// Purpose: Keep route-level chat panel state transitions and fallbacks deterministic.
// Layer: Route UI logic helpers.
// Exports: thread title fallback, deep-link bootstrap replay handling, and panel toggle helpers.

import type { ThreadEnvironmentMode, TurnId } from "@t3tools/contracts";
import { resolveThreadWorkspaceCwd } from "@t3tools/shared/threadEnvironment";

import type { ChatRightPanel, DiffRouteSearch } from "../diffRouteSearch";

export interface ChatPanelStateSnapshot {
  panel: ChatRightPanel | null;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
}

export interface ChatPanelStatePatch {
  panel?: ChatRightPanel | null;
  diffTurnId?: TurnId | null;
  diffFilePath?: string | null;
}

export interface RoutePanelBootstrapResult {
  nextAppliedSearchKey: string | null;
  panelPatch: ChatPanelStatePatch | null;
}

// File previews follow the thread runtime cwd so worktree chats open the files they actually edit.
export function resolveFilePreviewWorkspaceRoot(input: {
  projectCwd?: string | null | undefined;
  threadEnvMode?: ThreadEnvironmentMode | null | undefined;
  threadWorktreePath?: string | null | undefined;
}): string | null {
  return resolveThreadWorkspaceCwd({
    projectCwd: input.projectCwd,
    envMode: input.threadEnvMode,
    worktreePath: input.threadWorktreePath,
  });
}

function createRoutePanelSearchKey(input: {
  scopeId: string;
  search: DiffRouteSearch;
}): string | null {
  const { scopeId, search } = input;
  if (
    search.panel === undefined &&
    search.diff === undefined &&
    search.diffTurnId === undefined &&
    search.diffFilePath === undefined
  ) {
    return null;
  }

  return JSON.stringify({
    scopeId,
    panel: search.panel ?? (search.diff ? "diff" : null),
    diffTurnId: search.diffTurnId ?? null,
    diffFilePath: search.diffFilePath ?? null,
  });
}

export function resolveRoutePanelBootstrap(input: {
  scopeId: string;
  search: DiffRouteSearch;
  lastAppliedSearchKey: string | null;
}): RoutePanelBootstrapResult {
  const nextAppliedSearchKey = createRoutePanelSearchKey({
    scopeId: input.scopeId,
    search: input.search,
  });

  if (nextAppliedSearchKey === null) {
    return {
      nextAppliedSearchKey: null,
      panelPatch: null,
    };
  }

  if (input.lastAppliedSearchKey === nextAppliedSearchKey) {
    return {
      nextAppliedSearchKey,
      panelPatch: null,
    };
  }

  return {
    nextAppliedSearchKey,
    panelPatch: {
      panel: input.search.panel ?? (input.search.diff ? "diff" : null),
      diffTurnId: input.search.diffTurnId ?? null,
      diffFilePath: input.search.diffFilePath ?? null,
    },
  };
}
