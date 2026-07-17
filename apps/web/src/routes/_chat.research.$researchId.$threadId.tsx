// FILE: _chat.research.$researchId.$threadId.tsx
// Purpose: Research reader backed by a real TeaCode thread and composer.

import { ThreadId, type ProjectId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  getProviderStartOptions,
  resolveAssistantDeliveryMode,
  useAppSettings,
} from "~/appSettings";
import ChatView from "~/components/ChatView";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { ProjectSurfaceFrame } from "~/components/ProjectSurfaceHeader";
import { ResearchDocumentView } from "~/components/research/ResearchDocumentView";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import {
  resolvePreferredComposerModelSelection,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { resolveResearchProjectId } from "~/lib/researchProjectResolution";
import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { getThreadFromState } from "~/threadDerivation";
import { truncateTitle } from "~/truncateTitle";
import {
  buildResearchImplementationPrompt,
  buildResearchRevisionPrompt,
  researchDetailQueryOptions,
} from "./-research.shared";

export const Route = createFileRoute("/_chat/research/$researchId/$threadId")({
  component: ResearchDetailRoute,
});

function ResearchStatus({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <p className="max-w-md text-pretty">{message}</p>
      {retry ? (
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function ResearchDetailRoute() {
  const { researchId, threadId: rawThreadId } = Route.useParams();
  const threadId = ThreadId.makeUnsafe(rawThreadId);
  const navigate = useNavigate();
  const query = useQuery(researchDetailQueryOptions(researchId));
  const { settings } = useAppSettings();
  const [applying, setApplying] = useState(false);
  const syncServerShellSnapshot = useStore((state) => state.syncServerShellSnapshot);
  const projects = useStore((state) => state.projects);
  const serverThread = useStore((state) => getThreadFromState(state, threadId));
  const draftThread = useComposerDraftStore((state) => state.draftThreadsByThreadId[threadId]);
  const composerDraft = useComposerDraftStore((state) => state.draftsByThreadId[threadId]);
  const projectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const project = useStore((state) =>
    projectId ? state.projects.find((candidate) => candidate.id === projectId) : undefined,
  );
  const document = query.data?.document ?? null;

  const modelSelection = useMemo(
    () =>
      resolvePreferredComposerModelSelection({
        draft: composerDraft,
        threadModelSelection: serverThread?.modelSelection,
        projectModelSelection: project?.defaultModelSelection,
        defaultProvider: settings.defaultProvider,
      }),
    [
      composerDraft,
      project?.defaultModelSelection,
      serverThread?.modelSelection,
      settings.defaultProvider,
    ],
  );

  const applyInNewThread = async () => {
    if (!document || applying) return;
    const api = ensureNativeApi();
    const nextThreadId = newThreadId();
    const createdAt = new Date().toISOString();
    const runtimeMode =
      serverThread?.runtimeMode ?? composerDraft?.runtimeMode ?? settings.defaultRuntimeMode;
    const envMode =
      serverThread?.envMode ??
      draftThread?.envMode ??
      (document.worktreePath ? "worktree" : "local");
    const branch = serverThread?.branch ?? draftThread?.branch ?? document.branch;
    const worktreePath =
      serverThread?.worktreePath ?? draftThread?.worktreePath ?? document.worktreePath;
    setApplying(true);
    try {
      // Anchor the implementation thread to the research document's own repository;
      // the reader thread's project is only a fallback for documents without one.
      const repositoryRoot = document.repositoryRoot?.trim();
      const targetProjectId = repositoryRoot
        ? await resolveResearchProjectId({
            api,
            repositoryRoot,
            projects,
            onSnapshot: syncServerShellSnapshot,
          })
        : projectId;
      if (!targetProjectId) {
        throw new Error("This research is not linked to a repository or project.");
      }
      await api.orchestration.dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        projectId: targetProjectId as ProjectId,
        title: truncateTitle(`Implement · ${document.title}`),
        modelSelection,
        runtimeMode,
        interactionMode: "default",
        envMode,
        branch,
        worktreePath,
        lastKnownPr: serverThread?.lastKnownPr ?? null,
        associatedWorktreePath: serverThread?.associatedWorktreePath ?? worktreePath,
        associatedWorktreeBranch: serverThread?.associatedWorktreeBranch ?? branch,
        associatedWorktreeRef: serverThread?.associatedWorktreeRef ?? branch,
        createdAt,
      });
      const providerOptions = getProviderStartOptions(settings);
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: nextThreadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: buildResearchImplementationPrompt(document),
          attachments: [],
        },
        modelSelection,
        ...(providerOptions ? { providerOptions } : {}),
        assistantDeliveryMode: resolveAssistantDeliveryMode(settings),
        dispatchMode: "queue",
        runtimeMode,
        interactionMode: "default",
        createdAt,
      });
      const snapshot = await api.orchestration.getShellSnapshot();
      syncServerShellSnapshot(snapshot);
      await navigate({ to: "/$threadId", params: { threadId: nextThreadId } });
    } catch (error) {
      await api.orchestration
        .dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: nextThreadId,
        })
        .catch(() => undefined);
      toastManager.add({
        type: "error",
        title: "Could not start implementation thread",
        description: error instanceof Error ? error.message : "The implementation handoff failed.",
      });
    } finally {
      setApplying(false);
    }
  };

  const transcriptContent = document ? (
    <ResearchDocumentView document={document} applying={applying} onApply={applyInNewThread} />
  ) : query.isError ? (
    <ResearchStatus
      message={query.error instanceof Error ? query.error.message : "Research could not be loaded."}
      retry={() => void query.refetch()}
    />
  ) : (
    <ResearchStatus message="Loading research…" />
  );

  return (
    <ProjectSurfaceFrame
      activeSurface="research"
      middleThreadId={threadId}
      middleThreadTitle={serverThread?.title ?? null}
      projectId={projectId}
      projectName={project?.name ?? null}
      routeThreadId={threadId}
    >
      <RouteInsetSurface>
        <ChatView
          threadId={threadId}
          transcriptContent={transcriptContent}
          surfaceTitle={document?.title ?? "Research"}
          {...(document
            ? {
                transformOutgoingPrompt: (prompt: string) =>
                  buildResearchRevisionPrompt(document, prompt),
              }
            : {})}
        />
      </RouteInsetSurface>
    </ProjectSurfaceFrame>
  );
}
