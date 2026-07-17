import type { OrchestrationShellSnapshot, ThreadId } from "@t3tools/contracts";
import { resolveWorktreeHandoffIntent } from "@t3tools/shared/worktreeHandoff";
import { useCallback, useState } from "react";
import { buildSuggestedWorktreeName } from "../components/ChatView.logic";
import { toastManager } from "../components/ui/toast";
import { readNativeApi } from "../nativeApi";
import {
  setupProjectScript,
  type ProjectScriptRunOptions,
  type ProjectScriptRunResult,
} from "../projectScripts";
import type { Project, ProjectScript, Thread, ThreadWorkspacePatch } from "../types";

export function useThreadWorkspaceHandoff(input: {
  activeProject: Project | undefined;
  activeThread: Thread | undefined;
  activeRootBranch: string | null;
  activeThreadAssociatedWorktree: {
    associatedWorktreePath: string | null;
    associatedWorktreeBranch: string | null;
    associatedWorktreeRef: string | null;
  };
  isServerThread: boolean;
  stopActiveThreadSession: () => Promise<void>;
  runProjectScript: (
    script: ProjectScript,
    options?: ProjectScriptRunOptions,
  ) => Promise<ProjectScriptRunResult | null>;
  setStoreThreadWorkspace: (threadId: ThreadId, patch: ThreadWorkspacePatch) => void;
  syncServerShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
}) {
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [worktreeHandoffDialogOpen, setWorktreeHandoffDialogOpen] = useState(false);
  const [worktreeHandoffName, setWorktreeHandoffName] = useState("");

  const handoffThread = useCallback(
    async (targetMode: "local" | "worktree", options?: { preferredWorktreeName?: string }) => {
      const api = readNativeApi();
      if (
        !api ||
        !input.activeProject ||
        !input.activeThread ||
        !input.isServerThread ||
        handoffBusy
      ) {
        return false;
      }

      try {
        await input.stopActiveThreadSession();
        setHandoffBusy(true);
        const result = await api.workspace.handoffThread({
          threadId: input.activeThread.id,
          targetMode,
          preferredNewWorktreeName: options?.preferredWorktreeName ?? null,
        });

        const workspacePatch = {
          envMode: result.targetMode,
          branch: result.branch,
          worktreePath: result.worktreePath,
          associatedWorktreePath: result.associatedWorktreePath,
          associatedWorktreeBranch: result.associatedWorktreeBranch,
          associatedWorktreeRef: result.associatedWorktreeRef,
          ...(targetMode === "worktree" ? { createBranchFlowCompleted: false } : {}),
        } as const;

        input.setStoreThreadWorkspace(input.activeThread.id, workspacePatch);

        const snapshot = await api.orchestration.getShellSnapshot();
        input.syncServerShellSnapshot(snapshot);

        if (targetMode === "worktree" && result.worktreePath) {
          const setupScript = setupProjectScript(input.activeProject.scripts);
          if (setupScript) {
            await input.runProjectScript(setupScript, {
              cwd: result.worktreePath,
              worktreePath: result.worktreePath,
              rememberAsLastInvoked: false,
            });
          }
        }

        toastManager.add({
          type: result.conflictsDetected ? "warning" : "success",
          title:
            targetMode === "worktree"
              ? "Thread handed off to worktree"
              : "Thread handed off to local",
          ...(result.message ? { description: result.message } : {}),
        });
        return true;
      } catch (error) {
        toastManager.add({
          type: "error",
          title:
            targetMode === "worktree"
              ? "Could not hand off to worktree"
              : "Could not hand off to local",
          description:
            error instanceof Error ? error.message : "An error occurred during the handoff.",
        });
        return false;
      } finally {
        setHandoffBusy(false);
      }
    },
    [handoffBusy, input],
  );

  const onHandoffToWorktree = useCallback(() => {
    if (!input.activeThread) {
      return;
    }

    const worktreeIntent = resolveWorktreeHandoffIntent({
      associatedWorktreePath: input.activeThreadAssociatedWorktree.associatedWorktreePath,
      associatedWorktreeBranch: input.activeThreadAssociatedWorktree.associatedWorktreeBranch,
      associatedWorktreeRef: input.activeThreadAssociatedWorktree.associatedWorktreeRef,
      preferredWorktreeBaseBranch: input.activeRootBranch,
      currentBranch: input.activeThread.branch ?? null,
    });
    if (worktreeIntent?.kind === "reuse-associated") {
      void handoffThread("worktree");
      return;
    }

    setWorktreeHandoffName(
      buildSuggestedWorktreeName({
        associatedWorktreeBranch:
          input.activeThreadAssociatedWorktree.associatedWorktreeBranch ??
          input.activeThread.branch ??
          null,
        title: input.activeThread.title,
      }),
    );
    setWorktreeHandoffDialogOpen(true);
  }, [handoffThread, input]);

  const confirmWorktreeHandoff = useCallback(async () => {
    const normalizedWorktreeName = buildSuggestedWorktreeName({
      associatedWorktreeBranch: worktreeHandoffName,
    });
    setWorktreeHandoffName(normalizedWorktreeName);
    const succeeded = await handoffThread("worktree", {
      preferredWorktreeName: normalizedWorktreeName,
    });
    if (succeeded) {
      setWorktreeHandoffDialogOpen(false);
    }
  }, [handoffThread, worktreeHandoffName]);

  const onHandoffToLocal = useCallback(async () => {
    await handoffThread("local");
  }, [handoffThread]);

  return {
    handoffBusy,
    worktreeHandoffDialogOpen,
    setWorktreeHandoffDialogOpen,
    worktreeHandoffName,
    setWorktreeHandoffName,
    onHandoffToWorktree,
    onHandoffToLocal,
    confirmWorktreeHandoff,
  };
}
