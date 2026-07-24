// FILE: threadBootstrap.ts
// Purpose: Pure helpers for draft reuse and thread promotion payloads.
// Layer: Web bootstrap/domain helpers
// Exports: draft patching, reuse checks, and thread creation state resolution.

import {
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type OrchestrationThreadPullRequest,
  type ProjectId,
  type ProviderKind,
  type RuntimeMode,
  type ThreadEnvironmentMode,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveThreadEnvironmentMode } from "@t3tools/shared/threadEnvironment";
import {
  type ComposerThreadDraftState,
  type DraftThreadEnvMode,
  type DraftThreadState,
  resolvePreferredComposerModelSelection,
} from "../composerDraftStore";
import type { AppSettings, NewThreadWorkspaceMode } from "../appSettings";
import { type Thread } from "../types";

export interface NewThreadOptions {
  branch?: string | null;
  worktreePath?: string | null;
  envMode?: DraftThreadEnvMode;
  runtimeMode?: RuntimeMode;
  lastKnownPr?: OrchestrationThreadPullRequest | null;
  provider?: ProviderKind;
  fresh?: boolean;
}

/**
 * Product invariant for a repository thread: start pending creation of a fresh
 * worktree. The first send resolves the base from the fetched remote default
 * branch; an explicit per-thread picker choice can still override this.
 */
export const DEFAULT_NEW_THREAD_ENV_MODE = "worktree" as const satisfies DraftThreadEnvMode;

export function applyNewThreadWorkspaceDefaults(
  options: NewThreadOptions | undefined,
  settings: Pick<AppSettings, "defaultNewThreadWorkspaceMode" | "defaultWorktreeBaseBranch">,
): NewThreadOptions {
  const hasPinnedWorktree = Boolean(options?.worktreePath);
  const envMode: NewThreadWorkspaceMode =
    options?.envMode ?? (hasPinnedWorktree ? "worktree" : settings.defaultNewThreadWorkspaceMode);
  const defaultBaseBranch = settings.defaultWorktreeBaseBranch.trim();
  const branch =
    options?.branch !== undefined
      ? options.branch
      : envMode === "worktree" && defaultBaseBranch.length > 0
        ? defaultBaseBranch
        : null;

  return {
    ...options,
    envMode,
    branch,
  };
}

export interface InheritedThreadContext {
  branch: string | null;
  worktreePath: string | null;
  envMode: DraftThreadEnvMode;
}

// Carry the active surface's branch/worktree/env into a new thread bootstrap.
// A pending draft wins outright; otherwise we derive the env mode from the
// active thread's worktree so a fresh thread inherits the same workspace shape.
export function resolveInheritedThreadContext(input: {
  activeThread: Pick<Thread, "branch" | "worktreePath" | "envMode"> | null | undefined;
  activeDraftThread:
    | Pick<DraftThreadState, "branch" | "worktreePath" | "envMode">
    | null
    | undefined;
}): InheritedThreadContext {
  const { activeThread, activeDraftThread } = input;
  if (activeDraftThread) {
    return {
      branch: activeDraftThread.branch,
      worktreePath: activeDraftThread.worktreePath,
      envMode: activeDraftThread.envMode,
    };
  }
  return {
    branch: activeThread?.branch ?? null,
    worktreePath: activeThread?.worktreePath ?? null,
    envMode: resolveThreadEnvironmentMode({
      envMode: activeThread?.envMode,
      worktreePath: activeThread?.worktreePath ?? null,
    }),
  };
}

interface ActiveThreadSnapshot {
  projectId: ProjectId;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  envMode?: ThreadEnvironmentMode | undefined;
  lastKnownPr?: OrchestrationThreadPullRequest | null;
}

export interface DraftReusePlanStored {
  draftThread: DraftThreadState;
  kind: "stored";
  threadId: ThreadId;
}

export interface DraftReusePlanRoute {
  draftThread: DraftThreadState;
  kind: "route";
  threadId: ThreadId;
}

export interface DraftReusePlanFresh {
  kind: "fresh";
}

export type ThreadBootstrapPlan = DraftReusePlanStored | DraftReusePlanRoute | DraftReusePlanFresh;

interface ResolveThreadCreationStateInput {
  activeDraftThread: DraftThreadState | null;
  activeThread: ActiveThreadSnapshot | null;
  defaultProvider?: ProviderKind | null | undefined;
  draftComposerState: ComposerThreadDraftState | null;
  draftThread: DraftThreadState | null;
  options: NewThreadOptions | undefined;
  projectDefaultModelSelection: ModelSelection | null;
  projectId: ProjectId;
}

export interface ThreadCreationState {
  branch: string | null;
  envMode: DraftThreadEnvMode;
  lastKnownPr: OrchestrationThreadPullRequest | null;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  worktreePath: string | null;
}

// Normalize the currently active server thread into a stable snapshot for pure helpers.
export function createActiveThreadSnapshot(
  activeThread:
    | {
        modelSelection: ModelSelection;
        projectId: ProjectId;
        runtimeMode: RuntimeMode;
        envMode?: ThreadEnvironmentMode | undefined;
        lastKnownPr?: OrchestrationThreadPullRequest | null;
      }
    | null
    | undefined,
  projectId: ProjectId,
): ActiveThreadSnapshot | null {
  if (!activeThread || activeThread.projectId !== projectId) {
    return null;
  }
  return {
    projectId: activeThread.projectId,
    modelSelection: activeThread.modelSelection,
    runtimeMode: activeThread.runtimeMode,
    envMode: activeThread.envMode,
    lastKnownPr: activeThread.lastKnownPr ?? null,
  };
}

// Normalize the currently active draft thread into a stable snapshot for pure helpers.
export function createActiveDraftThreadSnapshot(
  activeDraftThread: DraftThreadState | null | undefined,
  projectId: ProjectId,
): DraftThreadState | null {
  if (!activeDraftThread || activeDraftThread.projectId !== projectId) {
    return null;
  }
  return {
    projectId: activeDraftThread.projectId,
    createdAt: activeDraftThread.createdAt,
    runtimeMode: activeDraftThread.runtimeMode,
    branch: activeDraftThread.branch,
    worktreePath: activeDraftThread.worktreePath,
    lastKnownPr: activeDraftThread.lastKnownPr ?? null,
    envMode: activeDraftThread.envMode,
  };
}

/**
 * Promotion (first send) does not erase the project's draft-thread mapping, so a thread that has
 * already started running still looks like a reusable draft. Reusing it makes "New thread" navigate
 * to the thread you are already on — a dead button. Treat such a draft as consumed.
 */
export function isConsumedDraftThread(input: {
  hasLatestTurn: boolean;
  hasServerThread: boolean;
}): boolean {
  return input.hasLatestTurn || input.hasServerThread;
}

// Decide whether we should reuse a stored draft, the current route draft, or create a fresh one.
export function resolveThreadBootstrapPlan(input: {
  latestActiveDraftThread: DraftThreadState | null;
  projectId: ProjectId;
  routeThreadId: ThreadId | null;
  storedDraftThread: ({ threadId: ThreadId } & DraftThreadState) | null;
}): ThreadBootstrapPlan {
  if (
    shouldReuseActiveDraftThread({
      draftThread: input.latestActiveDraftThread,
      projectId: input.projectId,
      routeThreadId: input.routeThreadId,
    })
  ) {
    return {
      kind: "route",
      threadId: input.routeThreadId!,
      draftThread: input.latestActiveDraftThread!,
    };
  }
  if (input.storedDraftThread) {
    return {
      kind: "stored",
      threadId: input.storedDraftThread.threadId,
      draftThread: input.storedDraftThread,
    };
  }
  return { kind: "fresh" };
}

// Build the initial draft-thread metadata for a brand new thread bootstrap.
export function createFreshDraftThreadSeed(input: {
  createdAt: string;
  options: NewThreadOptions | undefined;
}): Omit<DraftThreadState, "projectId"> {
  return {
    createdAt: input.createdAt,
    branch: input.options?.branch ?? null,
    worktreePath: input.options?.worktreePath ?? null,
    // A pinned worktree path (Git Workbench pull requests) is worktree mode by
    // construction, whatever the setting says.
    envMode:
      input.options?.envMode ??
      (input.options?.worktreePath ? "worktree" : DEFAULT_NEW_THREAD_ENV_MODE),
    runtimeMode: input.options?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    lastKnownPr: input.options?.lastKnownPr ?? null,
  };
}

// Detect whether the caller wants to override stored draft context before reuse.
export function hasDraftContextOverrides(options?: NewThreadOptions): boolean {
  return (
    options?.branch !== undefined ||
    options?.worktreePath !== undefined ||
    options?.envMode !== undefined ||
    options?.runtimeMode !== undefined ||
    options?.lastKnownPr !== undefined
  );
}

// Build the exact patch we should apply to an existing draft before reusing it.
export function buildDraftThreadContextPatch(options?: NewThreadOptions): {
  branch?: string | null;
  envMode?: DraftThreadEnvMode;
  lastKnownPr?: OrchestrationThreadPullRequest | null;
  runtimeMode?: RuntimeMode;
  worktreePath?: string | null;
} | null {
  if (!hasDraftContextOverrides(options)) {
    return null;
  }
  const shouldClearWorktreeForLocalMode =
    options?.envMode === "local" && options?.worktreePath === undefined;
  return {
    ...(options?.branch !== undefined ? { branch: options.branch ?? null } : {}),
    ...(options?.worktreePath !== undefined || shouldClearWorktreeForLocalMode
      ? { worktreePath: options?.worktreePath ?? null }
      : {}),
    ...(options?.envMode !== undefined ? { envMode: options.envMode } : {}),
    ...(options?.runtimeMode !== undefined ? { runtimeMode: options.runtimeMode } : {}),
    ...(options?.lastKnownPr !== undefined ? { lastKnownPr: options.lastKnownPr } : {}),
  };
}

// Reuse only when the active route draft already belongs to the target project.
export function shouldReuseActiveDraftThread(input: {
  draftThread: DraftThreadState | null;
  projectId: ProjectId;
  routeThreadId: ThreadId | null;
}): input is {
  draftThread: DraftThreadState;
  projectId: ProjectId;
  routeThreadId: ThreadId;
} {
  return Boolean(
    input.draftThread && input.routeThreadId && input.draftThread.projectId === input.projectId,
  );
}

// Resolve the durable thread payload for promotion from the most specific state.
export function resolveThreadCreationState(
  input: ResolveThreadCreationStateInput,
): ThreadCreationState {
  const hasExplicitEnvModeOverride =
    input.options !== undefined && Object.hasOwn(input.options, "envMode");
  const explicitEnvMode: DraftThreadEnvMode | undefined = hasExplicitEnvModeOverride
    ? (input.options?.envMode ?? DEFAULT_NEW_THREAD_ENV_MODE)
    : undefined;
  // A caller that pins a worktree path (Git Workbench opening a pull request)
  // is already in worktree mode. Everything else uses the product default
  // rather than inheriting from whatever thread happened to be open.
  const inheritedEnvMode =
    input.draftThread?.envMode !== undefined ? input.draftThread.envMode : undefined;

  return {
    modelSelection: resolvePreferredComposerModelSelection({
      draft: input.draftComposerState,
      threadModelSelection:
        input.activeThread?.projectId === input.projectId
          ? input.activeThread.modelSelection
          : null,
      projectModelSelection: input.projectDefaultModelSelection,
      defaultProvider: input.defaultProvider,
    }),
    runtimeMode:
      input.draftThread?.runtimeMode ??
      (input.activeThread?.projectId === input.projectId ? input.activeThread.runtimeMode : null) ??
      (input.activeDraftThread?.projectId === input.projectId
        ? input.activeDraftThread.runtimeMode
        : null) ??
      DEFAULT_RUNTIME_MODE,
    lastKnownPr:
      input.draftThread?.lastKnownPr ??
      (input.activeThread?.projectId === input.projectId
        ? (input.activeThread.lastKnownPr ?? null)
        : null) ??
      (input.activeDraftThread?.projectId === input.projectId
        ? (input.activeDraftThread.lastKnownPr ?? null)
        : null) ??
      null,
    envMode: hasExplicitEnvModeOverride
      ? (explicitEnvMode ?? DEFAULT_NEW_THREAD_ENV_MODE)
      : (inheritedEnvMode ?? DEFAULT_NEW_THREAD_ENV_MODE),
    branch:
      input.options?.branch !== undefined
        ? (input.options.branch ?? null)
        : (input.draftThread?.branch ?? null),
    worktreePath: (() => {
      if (input.options?.worktreePath !== undefined) {
        return input.options.worktreePath ?? null;
      }
      if (explicitEnvMode === "local") {
        return null;
      }
      return input.draftThread?.worktreePath ?? null;
    })(),
  };
}
