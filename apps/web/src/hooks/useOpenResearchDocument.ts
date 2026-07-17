// FILE: useOpenResearchDocument.ts
// Purpose: Opens a research artifact in a draft thread attributed to its repository/worktree.
// Layer: Web research navigation

import type { ResearchDocumentSummary } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { resolveResearchProjectId } from "~/lib/researchProjectResolution";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { toastManager } from "~/components/ui/toast";
import { useHandleNewThread } from "./useHandleNewThread";

export function useOpenResearchDocument() {
  const navigate = useNavigate();
  const projects = useStore((state) => state.projects);
  const syncServerShellSnapshot = useStore((state) => state.syncServerShellSnapshot);
  const { handleNewThread } = useHandleNewThread();

  return useCallback(
    async (document: ResearchDocumentSummary) => {
      const repositoryRoot = document.repositoryRoot?.trim();
      if (!repositoryRoot) {
        toastManager.add({
          type: "error",
          title: "Research is missing its repository",
          description: "Add repository.root to the sibling .research.json manifest.",
        });
        return;
      }

      try {
        const api = ensureNativeApi();
        const projectId = await resolveResearchProjectId({
          api,
          repositoryRoot,
          projects,
          onSnapshot: syncServerShellSnapshot,
        });

        await handleNewThread(
          projectId,
          {
            fresh: true,
            envMode: document.worktreePath ? "worktree" : "local",
            worktreePath: document.worktreePath,
            branch: document.branch,
          },
          {
            navigate: (threadId) =>
              navigate({
                to: "/research/$researchId/$threadId",
                params: { researchId: document.id, threadId },
              }),
          },
        );
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not open research",
          description:
            error instanceof Error ? error.message : "The research workspace failed to open.",
        });
      }
    },
    [handleNewThread, navigate, projects, syncServerShellSnapshot],
  );
}
