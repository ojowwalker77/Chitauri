import { ProjectId, type ModelSelection, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { type ComposerThreadDraftState, type DraftThreadState } from "../composerDraftStore";
import {
  buildDraftThreadContextPatch,
  createActiveDraftThreadSnapshot,
  createActiveThreadSnapshot,
  createFreshDraftThreadSeed,
  hasDraftContextOverrides,
  isConsumedDraftThread,
  resolveInheritedThreadContext,
  resolveThreadCreationState,
  resolveThreadBootstrapPlan,
  shouldReuseActiveDraftThread,
} from "./threadBootstrap";

const PROJECT_ID = ProjectId.makeUnsafe("project-bootstrap");
const THREAD_ID = ThreadId.makeUnsafe("thread-bootstrap");

function modelSelection(
  provider: "codex" | "claudeAgent",
  model: string,
  options?: ModelSelection["options"],
): ModelSelection {
  return {
    provider,
    model,
    ...(options ? { options } : {}),
  } as ModelSelection;
}

function makeDraftThread(partial?: Partial<DraftThreadState>): DraftThreadState {
  return {
    projectId: PROJECT_ID,
    createdAt: "2026-04-05T10:00:00.000Z",
    runtimeMode: "approval-required",
    branch: "feature/terminal-bootstrap",
    worktreePath: "/repo/.worktrees/terminal-bootstrap",
    envMode: "worktree",
    ...partial,
  };
}

function makeComposerDraftState(
  partial?: Partial<ComposerThreadDraftState>,
): ComposerThreadDraftState {
  return {
    prompt: "",
    promptHistorySavedDraft: null,
    images: [],
    files: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    assistantSelections: [],
    fileComments: [],
    pastedTexts: [],
    skills: [],
    mentions: [],
    queuedTurns: [],
    modelSelectionByProvider: {
      claudeAgent: modelSelection("claudeAgent", "claude-opus-4-6", { effort: "max" }),
    },
    activeProvider: "claudeAgent",
    runtimeMode: null,
    ...partial,
  };
}

describe("threadBootstrap", () => {
  it("detects when a draft context override is present", () => {
    expect(hasDraftContextOverrides()).toBe(false);
    expect(hasDraftContextOverrides({ branch: "feature/new-branch" })).toBe(true);
  });

  it("builds a draft patch only when overrides are provided", () => {
    expect(buildDraftThreadContextPatch()).toBeNull();
    expect(
      buildDraftThreadContextPatch({
        branch: "feature/new-branch",
        worktreePath: "/repo/.worktrees/new-branch",
      }),
    ).toEqual({
      branch: "feature/new-branch",
      worktreePath: "/repo/.worktrees/new-branch",
    });
    expect(
      buildDraftThreadContextPatch({
        envMode: "local",
      }),
    ).toEqual({
      envMode: "local",
      worktreePath: null,
    });
  });

  it("recognizes when the active route draft can be reused", () => {
    expect(
      shouldReuseActiveDraftThread({
        draftThread: makeDraftThread(),
        projectId: PROJECT_ID,
        routeThreadId: THREAD_ID,
      }),
    ).toBe(true);
    expect(
      shouldReuseActiveDraftThread({
        draftThread: makeDraftThread(),
        projectId: PROJECT_ID,
        routeThreadId: null,
      }),
    ).toBe(false);
  });

  it("treats promoted drafts as consumed", () => {
    expect(isConsumedDraftThread({ hasLatestTurn: false, hasServerThread: true })).toBe(true);
    expect(isConsumedDraftThread({ hasLatestTurn: true, hasServerThread: false })).toBe(true);
    expect(isConsumedDraftThread({ hasLatestTurn: false, hasServerThread: false })).toBe(false);
  });

  it("resolves bootstrap precedence as route draft, then stored draft, then fresh", () => {
    expect(
      resolveThreadBootstrapPlan({
        storedDraftThread: { threadId: ThreadId.makeUnsafe("stored-thread"), ...makeDraftThread() },
        latestActiveDraftThread: makeDraftThread({ branch: "feature/route-draft" }),
        projectId: PROJECT_ID,
        routeThreadId: THREAD_ID,
      }),
    ).toMatchObject({ kind: "route", threadId: THREAD_ID });
    expect(
      resolveThreadBootstrapPlan({
        storedDraftThread: { threadId: THREAD_ID, ...makeDraftThread() },
        latestActiveDraftThread: null,
        projectId: PROJECT_ID,
        routeThreadId: null,
      }),
    ).toMatchObject({ kind: "stored", threadId: THREAD_ID });
    expect(
      resolveThreadBootstrapPlan({
        storedDraftThread: null,
        latestActiveDraftThread: null,
        projectId: PROJECT_ID,
        routeThreadId: null,
      }),
    ).toEqual({ kind: "fresh" });
  });

  it("creates stable snapshots for active thread state", () => {
    expect(
      createActiveThreadSnapshot(
        {
          projectId: PROJECT_ID,
          modelSelection: modelSelection("codex", "gpt-5"),
          runtimeMode: "full-access",
        },
        PROJECT_ID,
      ),
    ).toEqual({
      projectId: PROJECT_ID,
      modelSelection: modelSelection("codex", "gpt-5"),
      runtimeMode: "full-access",
      envMode: undefined,
      lastKnownPr: null,
    });
    expect(createActiveDraftThreadSnapshot(makeDraftThread(), PROJECT_ID)).toEqual({
      ...makeDraftThread(),
      lastKnownPr: null,
    });
  });

  it("lets an active draft override inherited branch and worktree context", () => {
    expect(
      resolveInheritedThreadContext({
        activeThread: {
          branch: "feature/server-thread",
          worktreePath: "/repo/.worktrees/server-thread",
          envMode: "worktree",
        },
        activeDraftThread: makeDraftThread({
          branch: "feature/draft-thread",
          worktreePath: "/repo/.worktrees/draft-thread",
          envMode: "worktree",
        }),
      }),
    ).toEqual({
      branch: "feature/draft-thread",
      worktreePath: "/repo/.worktrees/draft-thread",
      envMode: "worktree",
    });
  });

  it("lets a local active draft clear active thread branch and worktree context", () => {
    expect(
      resolveInheritedThreadContext({
        activeThread: {
          branch: "feature/server-thread",
          worktreePath: "/repo/.worktrees/server-thread",
          envMode: "worktree",
        },
        activeDraftThread: makeDraftThread({
          branch: null,
          worktreePath: null,
          envMode: "local",
        }),
      }),
    ).toEqual({
      branch: null,
      worktreePath: null,
      envMode: "local",
    });
  });

  it("derives inherited environment mode from the active thread when no draft exists", () => {
    expect(
      resolveInheritedThreadContext({
        activeThread: {
          branch: "feature/server-thread",
          worktreePath: "/repo/.worktrees/server-thread",
          envMode: undefined,
        },
        activeDraftThread: null,
      }),
    ).toEqual({
      branch: "feature/server-thread",
      worktreePath: "/repo/.worktrees/server-thread",
      envMode: "worktree",
    });
  });

  it("builds the fresh draft seed from creation inputs", () => {
    expect(
      createFreshDraftThreadSeed({
        createdAt: "2026-04-05T10:00:00.000Z",
        options: {
          branch: "feature/new-terminal",
          worktreePath: "/repo/.worktrees/new-terminal",
          envMode: "worktree",
          runtimeMode: "approval-required",
        },
      }),
    ).toEqual({
      createdAt: "2026-04-05T10:00:00.000Z",
      branch: "feature/new-terminal",
      worktreePath: "/repo/.worktrees/new-terminal",
      envMode: "worktree",
      runtimeMode: "approval-required",
      lastKnownPr: null,
    });
  });

  it("always seeds a fresh thread in worktree mode when the caller does not pick one", () => {
    expect(
      createFreshDraftThreadSeed({
        createdAt: "2026-04-05T10:00:00.000Z",
        options: undefined,
      }),
    ).toMatchObject({ envMode: "worktree", branch: null, worktreePath: null });
  });

  it("keeps an explicit local picker override ahead of the worktree default", () => {
    expect(
      createFreshDraftThreadSeed({
        createdAt: "2026-04-05T10:00:00.000Z",
        options: { envMode: "local" },
      }),
    ).toMatchObject({ envMode: "local" });
  });

  it("treats a caller-pinned worktree path as worktree mode", () => {
    expect(
      createFreshDraftThreadSeed({
        createdAt: "2026-04-05T10:00:00.000Z",
        options: { branch: "pr-42", worktreePath: "/repo/.worktrees/pr-42" },
      }),
    ).toMatchObject({ envMode: "worktree", worktreePath: "/repo/.worktrees/pr-42" });
  });

  it("prefers draft state when resolving creation payloads", () => {
    expect(
      resolveThreadCreationState({
        activeDraftThread: null,
        activeThread: {
          projectId: PROJECT_ID,
          modelSelection: modelSelection("codex", "gpt-5"),
          runtimeMode: "full-access",
        },
        draftComposerState: makeComposerDraftState(),
        draftThread: makeDraftThread(),
        options: undefined,
        projectDefaultModelSelection: modelSelection("codex", "gpt-5.4"),
        projectId: PROJECT_ID,
      }),
    ).toEqual({
      modelSelection: modelSelection("claudeAgent", "claude-opus-4-6", {
        effort: "max",
      }),
      runtimeMode: "approval-required",
      envMode: "worktree",
      branch: "feature/terminal-bootstrap",
      worktreePath: "/repo/.worktrees/terminal-bootstrap",
      lastKnownPr: null,
    });
  });

  it("clears inherited worktree state when an explicit local env override is requested", () => {
    expect(
      resolveThreadCreationState({
        activeDraftThread: null,
        activeThread: {
          projectId: PROJECT_ID,
          modelSelection: modelSelection("codex", "gpt-5"),
          runtimeMode: "full-access",
          envMode: "worktree",
        },
        draftComposerState: makeComposerDraftState(),
        draftThread: makeDraftThread(),
        options: {
          envMode: "local",
        },
        projectDefaultModelSelection: modelSelection("codex", "gpt-5.4"),
        projectId: PROJECT_ID,
      }),
    ).toMatchObject({
      envMode: "local",
      worktreePath: null,
      branch: "feature/terminal-bootstrap",
    });
  });
});
