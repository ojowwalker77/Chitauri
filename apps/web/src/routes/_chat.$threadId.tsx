// FILE: _chat.$threadId.tsx
// Purpose: Resolves the active thread route into the chat and its focused project tools.
// Layer: Route container
// Depends on: ChatView, editor view, and the Explorer/Diff/Terminal right dock.

import {
  type ProjectId,
  ThreadId,
  type ThreadId as ThreadIdType,
  type TurnId,
} from "@t3tools/contracts";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { isWorkspaceRelativePathSafe } from "@t3tools/shared/path";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Suspense,
  lazy,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ChatView from "../components/ChatView";
import { ProjectSurfaceFrame } from "../components/ProjectSurfaceFrame";
import { EditorWorkspaceView } from "../components/EditorWorkspaceView";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { useComposerDraftStore } from "../composerDraftStore";
import { useDockPaneRuntimeActivation } from "../hooks/useDockPaneRuntimeActivation";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import {
  type EmptyRouteRestoreRecoveryState,
  shouldHoldMissingThreadRouteFallback,
  shouldStartMissingThreadRouteRecovery,
} from "../chatRouteRestore";
import {
  refreshEmptyRouteRestoreSnapshot,
  waitForEmptyRouteRestoreFallbackDelay,
} from "../chatRouteRecovery";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import type { ChatPanelState } from "../chatPanelState";
import { selectRightDockState, useRightDockStore } from "../rightDockStore";
import {
  type RightDockPane,
  type RightDockPaneKind,
  resolveActivePane,
} from "../rightDockStore.logic";
import { RightDock } from "../components/chat/RightDock";
import { DockTerminalPane } from "../components/chat/DockTerminalPane";
import { PanelStateMessage } from "../components/chat/PanelStateMessage";
import { RIGHT_DOCK_ADD_MENU_KINDS } from "../components/chat/rightDockPaneMeta";
import { DockExplorerPane } from "../components/chat/DockExplorerPane";
import { readEditorViewState, storeEditorViewState } from "../editorViewState";
import {
  addChatFileComment,
  appendChatFileReference,
  appendComposerPromptText,
  buildWhyLinesPrompt,
  type ChatFileReference,
} from "../lib/chatReferences";
import type { FileCommentSelection } from "../lib/fileComments";
import { type DockPaneRuntimeMode } from "../lib/dockPaneActivation";
import { projectListDirectoriesQueryOptions } from "../lib/projectReactQuery";
import {
  WorkspaceFileOpenerContext,
  prefetchWorkspaceFile,
  resolveDockFileOpenTarget,
  resolveWorkspaceFileOpenTarget,
  type WorkspaceFileOpener,
} from "../lib/workspaceFileOpener";
import {
  canComposerHandlePanelWidth,
  createPanelResizeOverlay,
  removePanelResizeOverlay,
} from "../lib/panelResize";
import { EDITOR_CHAT_PANE_SCOPE_ID, SINGLE_CHAT_PANE_SCOPE_ID } from "../lib/chatPaneScope";
import { toastManager } from "../components/ui/toast";
import { useAppSettings } from "../appSettings";
import { useStore } from "../store";
import { readNativeApi } from "../nativeApi";
import {
  createProjectSelector,
  createSidebarThreadSummariesSelector,
  createThreadExistsSelector,
  createThreadProjectIdSelector,
  createThreadWorkspaceMetadataSelector,
} from "../storeSelectors";
import { sortThreadsForSidebar } from "../components/Sidebar.logic";
import {
  resolveFilePreviewWorkspaceRoot,
  resolveRoutePanelBootstrap,
} from "./-chatThreadRoute.logic";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import {
  CHAT_BACKGROUND_CLASS_NAME,
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import { cn } from "~/lib/utils";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarInset } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
// Pre-measure approximation of the dock's 50/50 split (half the viewport minus
// half a 16rem left sidebar). RightDock measures the actual shell on open and
// pins the width to exactly half; this only covers the first paint before that
// effect runs. `max()` keeps a sane minimum on narrow screens.
const DIFF_INLINE_DEFAULT_WIDTH = "max(28rem, calc(50vw - 8rem))";
const SINGLE_PANEL_MIN_WIDTH = 26 * 16;
const DiffLoadingFallback = (props: { mode: DiffPanelMode; hideHeader?: boolean }) => {
  return (
    <DiffPanelShell
      mode={props.mode}
      header={props.hideHeader ? null : <DiffPanelHeaderSkeleton />}
    >
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: {
  mode: DiffPanelMode;
  threadId?: ThreadIdType | null;
  panelState?: Pick<ChatPanelState, "panel" | "diffTurnId" | "diffFilePath">;
  onUpdatePanelState?: (
    patch: Partial<Pick<ChatPanelState, "panel" | "diffTurnId" | "diffFilePath">>,
  ) => void;
  onClosePanel?: () => void;
  liveRefreshEnabled?: boolean;
  queriesEnabled?: boolean;
  hideHeader?: boolean;
  onRenderableFilesChange?: (files: ReadonlyArray<FileDiffMetadata>, isLoading: boolean) => void;
  onEditorDiffOptionsChange?: (control: ReactNode | null) => void;
}) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense
        fallback={
          <DiffLoadingFallback
            mode={props.mode}
            {...(props.hideHeader !== undefined ? { hideHeader: props.hideHeader } : {})}
          />
        }
      >
        <DiffPanel
          mode={props.mode}
          {...(props.threadId !== undefined ? { threadId: props.threadId } : {})}
          {...(props.panelState ? { panelState: props.panelState } : {})}
          {...(props.onUpdatePanelState ? { onUpdatePanelState: props.onUpdatePanelState } : {})}
          {...(props.onClosePanel ? { onClosePanel: props.onClosePanel } : {})}
          {...(props.liveRefreshEnabled !== undefined
            ? { liveRefreshEnabled: props.liveRefreshEnabled }
            : {})}
          {...(props.queriesEnabled !== undefined ? { queriesEnabled: props.queriesEnabled } : {})}
          {...(props.hideHeader !== undefined ? { hideHeader: props.hideHeader } : {})}
          {...(props.onRenderableFilesChange
            ? { onRenderableFilesChange: props.onRenderableFilesChange }
            : {})}
          {...(props.onEditorDiffOptionsChange
            ? { onEditorDiffOptionsChange: props.onEditorDiffOptionsChange }
            : {})}
        />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

function stripEditorViewSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "view" | "editorFilePath"> {
  const { view: _view, editorFilePath: _editorFilePath, ...rest } = params;
  return rest as Omit<T, "view" | "editorFilePath">;
}

function collectParentDirectoryPaths(filePath: string): string[] {
  const segments = filePath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return [];
  }

  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

function resolveSingleProjectId(input: {
  threadProjectId: ProjectId | null;
  draftProjectId: ProjectId | null;
}): ProjectId | null {
  return input.threadProjectId ?? input.draftProjectId ?? null;
}

function SingleChatSurface(props: {
  threadId: ThreadIdType;
  search: DiffRouteSearch;
  projectId: ProjectId | null;
}) {
  const navigate = useNavigate();
  const dockState = useRightDockStore(selectRightDockState(props.threadId));
  const openPane = useRightDockStore((store) => store.openPane);
  const toggleSingletonPane = useRightDockStore((store) => store.toggleSingletonPane);
  const closePane = useRightDockStore((store) => store.closePane);
  const setActivePane = useRightDockStore((store) => store.setActivePane);
  const setDockOpen = useRightDockStore((store) => store.setDockOpen);
  const updatePane = useRightDockStore((store) => store.updatePane);
  const activeProject = useStore(
    useMemo(() => createProjectSelector(props.projectId), [props.projectId]),
  );
  const threadWorkspaceMetadata = useStore(
    useMemo(() => createThreadWorkspaceMetadataSelector(props.threadId), [props.threadId]),
  );
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[props.threadId] ?? null,
  );
  // File preview must follow the same runtime cwd as chat markdown, diffs, and git:
  // worktree-backed threads resolve links against their materialized worktree.
  const workspaceRoot = resolveFilePreviewWorkspaceRoot({
    projectCwd: activeProject?.cwd ?? null,
    threadEnvMode: threadWorkspaceMetadata.envMode ?? draftThread?.envMode ?? null,
    threadWorktreePath: threadWorkspaceMetadata.worktreePath ?? draftThread?.worktreePath ?? null,
  });
  const projects = useStore((store) => store.projects);
  const { settings: appSettings } = useAppSettings();
  const { handleNewThread } = useHandleNewThread();
  const queryClient = useQueryClient();
  const lastAppliedRoutePanelSearchKeyRef = useRef<string | null>(null);
  const [editorExpandedDirectories, setEditorExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set(readEditorViewState(props.threadId)?.expandedDirectories ?? []),
  );
  const [editorCenterMode, setEditorCenterMode] = useState<"file" | "diff">(() =>
    props.search.editorFilePath
      ? "file"
      : (readEditorViewState(props.threadId)?.centerMode ?? "diff"),
  );
  // This route component is reused across thread navigations; reload the
  // persisted editor view state when the thread changes.
  const editorViewStateThreadIdRef = useRef(props.threadId);
  useEffect(() => {
    if (editorViewStateThreadIdRef.current === props.threadId) {
      return;
    }
    editorViewStateThreadIdRef.current = props.threadId;
    const persisted = readEditorViewState(props.threadId);
    setEditorExpandedDirectories(new Set(persisted?.expandedDirectories ?? []));
    setEditorCenterMode(props.search.editorFilePath ? "file" : (persisted?.centerMode ?? "diff"));
  }, [props.search.editorFilePath, props.threadId]);
  const editorViewActive = props.search.view === "editor";
  useEffect(() => {
    if (!editorViewActive) {
      return;
    }
    storeEditorViewState(props.threadId, {
      expandedDirectories: [...editorExpandedDirectories],
      centerMode: editorCenterMode,
    });
  }, [editorCenterMode, editorExpandedDirectories, editorViewActive, props.threadId]);
  const [editorDiffPanelState, setEditorDiffPanelState] = useState<
    Pick<ChatPanelState, "panel" | "diffTurnId" | "diffFilePath">
  >({
    panel: "diff",
    diffTurnId: props.search.diffTurnId ?? null,
    diffFilePath: props.search.diffFilePath ?? null,
  });
  const [editorDiffFiles, setEditorDiffFiles] = useState<ReadonlyArray<FileDiffMetadata>>([]);
  const [editorDiffFilesLoading, setEditorDiffFilesLoading] = useState(false);
  const [editorDiffOptionsControl, setEditorDiffOptionsControl] = useState<ReactNode | null>(null);

  const activePane = resolveActivePane(dockState);
  const { activePaneRuntimeMode, requestImmediateHydration: requestImmediateDockHydration } =
    useDockPaneRuntimeActivation({
      threadId: props.threadId,
      activePane,
    });

  const chatPanelState = useMemo<ChatPanelState>(
    () => ({
      panel: activePane?.kind === "diff" ? "diff" : null,
      diffTurnId: activePane?.kind === "diff" ? activePane.diffTurnId : null,
      diffFilePath: activePane?.kind === "diff" ? activePane.diffFilePath : null,
      hasOpenedPanel: dockState.panes.length > 0,
      lastOpenPanel: "diff",
    }),
    [activePane, dockState.panes.length],
  );

  const handleToggleDiff = useCallback(() => {
    requestImmediateDockHydration("diff");
    toggleSingletonPane(props.threadId, { kind: "diff" });
  }, [props.threadId, requestImmediateDockHydration, toggleSingletonPane]);
  const handleOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      requestImmediateDockHydration("diff");
      openPane(props.threadId, {
        kind: "diff",
        diffTurnId: turnId,
        diffFilePath: filePath ?? null,
      });
    },
    [openPane, props.threadId, requestImmediateDockHydration],
  );

  const handleOpenEditorView = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId: props.threadId },
      search: (previous) => ({
        ...stripDiffSearchParams(previous),
        view: "editor",
        ...(props.search.editorFilePath ? { editorFilePath: props.search.editorFilePath } : {}),
      }),
    });
  }, [navigate, props.search.editorFilePath, props.threadId]);

  const handleCloseEditorView = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId: props.threadId },
      search: (previous) => stripEditorViewSearchParams(stripDiffSearchParams(previous)),
    });
  }, [navigate, props.threadId]);

  const handleSelectEditorFile = useCallback(
    (filePath: string) => {
      setEditorCenterMode("file");
      void navigate({
        to: "/$threadId",
        params: { threadId: props.threadId },
        replace: true,
        search: (previous) => ({
          ...stripDiffSearchParams(previous),
          view: "editor",
          editorFilePath: filePath,
        }),
      });
    },
    [navigate, props.threadId],
  );

  const handleToggleEditorDirectory = useCallback((directoryPath: string) => {
    setEditorExpandedDirectories((previous) => {
      const next = new Set(previous);
      if (next.has(directoryPath)) {
        next.delete(directoryPath);
      } else {
        next.add(directoryPath);
      }
      return next;
    });
  }, []);

  const handleEditorToggleDiff = useCallback(() => {
    setEditorCenterMode((current) =>
      current === "diff" && props.search.editorFilePath ? "file" : "diff",
    );
  }, [props.search.editorFilePath]);

  const handleEditorOpenTurnDiff = useCallback((turnId: TurnId, filePath?: string) => {
    setEditorCenterMode("diff");
    setEditorDiffPanelState({
      panel: "diff",
      diffTurnId: turnId,
      diffFilePath: filePath ?? null,
    });
  }, []);

  const handleUpdateEditorDiffPanelState = useCallback(
    (patch: Partial<Pick<ChatPanelState, "panel" | "diffTurnId" | "diffFilePath">>) => {
      setEditorDiffPanelState((previous) => ({
        panel: "diff",
        diffTurnId: "diffTurnId" in patch ? (patch.diffTurnId ?? null) : previous.diffTurnId,
        diffFilePath:
          "diffFilePath" in patch ? (patch.diffFilePath ?? null) : previous.diffFilePath,
      }));
    },
    [],
  );
  const handleEditorDiffFilesChange = useCallback(
    (files: ReadonlyArray<FileDiffMetadata>, isLoading: boolean) => {
      setEditorDiffFiles(files);
      setEditorDiffFilesLoading(isLoading);
    },
    [],
  );
  const handleSelectEditorDiffFile = useCallback((filePath: string) => {
    setEditorCenterMode("diff");
    setEditorDiffPanelState((previous) => ({
      ...previous,
      panel: "diff",
      diffFilePath: filePath,
    }));
  }, []);
  const handleEditorDiffOptionsChange = useCallback((control: ReactNode | null) => {
    setEditorDiffOptionsControl(control);
  }, []);
  const handleReferenceInChat = useCallback(
    (reference: ChatFileReference) => {
      appendChatFileReference(props.threadId, reference);
    },
    [props.threadId],
  );
  const handleAskWhyInChat = useCallback(
    (reference: ChatFileReference) => {
      appendComposerPromptText(props.threadId, buildWhyLinesPrompt(reference));
    },
    [props.threadId],
  );
  const handleCommentInChat = useCallback(
    (comment: FileCommentSelection) => {
      addChatFileComment(props.threadId, comment);
    },
    [props.threadId],
  );

  // Hover warm-up shared by both surfaces' file openers: file contents land in
  // the React Query cache and the matching Shiki highlighter loads, so the
  // preview paints instantly on click.
  const prefetchOpenerFile = useCallback(
    (path: string) => {
      if (!workspaceRoot) {
        return;
      }
      const relativePath = resolveWorkspaceFileOpenTarget(path, workspaceRoot);
      if (relativePath) {
        prefetchWorkspaceFile(queryClient, workspaceRoot, relativePath);
      }
    },
    [queryClient, workspaceRoot],
  );
  // Chat surface: file references open in the right-dock file pane. References
  // outside the workspace report unhandled so chips fall back to the external
  // editor.
  const dockFileOpener = useMemo<WorkspaceFileOpener>(
    () => ({
      openFile: (path) => {
        // In-workspace references map to relative paths for the file-read RPC;
        // binary previews in a session's scratch workspace (outside the chat
        // workspace) open by absolute path through the local-image route.
        const targetPath = resolveDockFileOpenTarget(path, workspaceRoot);
        if (!targetPath) {
          return false;
        }
        requestImmediateDockHydration("explorer");
        openPane(props.threadId, { kind: "explorer", filePath: targetPath });
        return true;
      },
      prefetchFile: prefetchOpenerFile,
    }),
    [openPane, prefetchOpenerFile, props.threadId, requestImmediateDockHydration, workspaceRoot],
  );
  // Editor surface: the center file pane is already the file viewer, so file
  // references select into it instead of opening a dock pane.
  const editorFileOpener = useMemo<WorkspaceFileOpener>(
    () => ({
      openFile: (path) => {
        if (!workspaceRoot) {
          return false;
        }
        const relativePath = resolveWorkspaceFileOpenTarget(path, workspaceRoot);
        if (!relativePath) {
          return false;
        }
        handleSelectEditorFile(relativePath);
        return true;
      },
      prefetchFile: prefetchOpenerFile,
    }),
    [handleSelectEditorFile, prefetchOpenerFile, workspaceRoot],
  );

  useEffect(() => {
    const { nextAppliedSearchKey, panelPatch } = resolveRoutePanelBootstrap({
      scopeId: props.threadId,
      search: props.search,
      lastAppliedSearchKey: lastAppliedRoutePanelSearchKeyRef.current,
    });

    lastAppliedRoutePanelSearchKeyRef.current = nextAppliedSearchKey;
    if (!panelPatch) {
      return;
    }

    if (panelPatch.panel === "diff") {
      requestImmediateDockHydration("diff");
      openPane(props.threadId, {
        kind: "diff",
        diffTurnId: panelPatch.diffTurnId ?? null,
        diffFilePath: panelPatch.diffFilePath ?? null,
      });
    } else {
      setDockOpen(props.threadId, false);
    }
    void navigate({
      to: "/$threadId",
      params: { threadId: props.threadId },
      replace: true,
      search: (previous) => stripDiffSearchParams(previous),
    });
  }, [
    navigate,
    openPane,
    props.search,
    props.threadId,
    requestImmediateDockHydration,
    setDockOpen,
  ]);

  const editorProjectOptions = useMemo(
    () =>
      projects.flatMap((project) =>
        project.kind === "project" ? [{ id: project.id, name: project.name }] : [],
      ),
    [projects],
  );
  const threadSummaries = useStore(useMemo(() => createSidebarThreadSummariesSelector(), []));
  const openEditorProject = useCallback(
    async (projectId: ProjectId) => {
      const latestThread = sortThreadsForSidebar(
        threadSummaries.filter((thread) => thread.projectId === projectId),
        appSettings.sidebarThreadSortOrder,
      )[0];

      if (latestThread) {
        await navigate({
          to: "/$threadId",
          params: { threadId: latestThread.id },
          search: (previous) => ({
            ...stripEditorViewSearchParams(stripDiffSearchParams(previous)),
            view: "editor",
          }),
        });
        return;
      }

      await handleNewThread(
        projectId,
        {
          envMode: appSettings.defaultThreadEnvMode,
        },
        {
          search: (previous) => ({
            ...stripEditorViewSearchParams(stripDiffSearchParams(previous)),
            view: "editor",
          }),
        },
      );
    },
    [
      appSettings.defaultThreadEnvMode,
      appSettings.sidebarThreadSortOrder,
      handleNewThread,
      navigate,
      threadSummaries,
    ],
  );
  const handleSelectEditorProject = useCallback(
    (projectId: ProjectId) => {
      void openEditorProject(projectId).catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Unable to open project",
          description: error instanceof Error ? error.message : "The project could not be opened.",
        });
      });
    },
    [openEditorProject],
  );
  const shouldAcceptDockWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      return canComposerHandlePanelWidth({
        nextWidth,
        // Scope the width probe to the main composer.
        paneScopeId: SINGLE_CHAT_PANE_SCOPE_ID,
        applyWidth: (width) => {
          wrapper.style.setProperty("--sidebar-width", `${width}px`);
        },
        resetWidth: () => {
          if (previousSidebarWidth.length > 0) {
            wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
          } else {
            wrapper.style.removeProperty("--sidebar-width");
          }
        },
      });
    },
    [],
  );

  const handleAddDockPane = useCallback(
    (kind: RightDockPaneKind) => {
      requestImmediateDockHydration(kind);
      openPane(props.threadId, { kind });
    },
    [openPane, props.threadId, requestImmediateDockHydration],
  );

  const renderDockPane = useCallback(
    (
      pane: RightDockPane,
      context: { runtimeMode: DockPaneRuntimeMode; isActive: boolean },
    ): ReactNode => {
      switch (pane.kind) {
        case "diff":
          return (
            <LazyDiffPanel
              mode="sidebar"
              threadId={props.threadId}
              panelState={{
                panel: "diff",
                diffTurnId: pane.diffTurnId,
                diffFilePath: pane.diffFilePath,
              }}
              onUpdatePanelState={(patch) =>
                updatePane(props.threadId, pane.id, {
                  diffTurnId: patch.diffTurnId ?? null,
                  diffFilePath: patch.diffFilePath ?? null,
                })
              }
              onClosePanel={() => closePane(props.threadId, pane.id)}
              liveRefreshEnabled={context.isActive && dockState.open}
              queriesEnabled={context.isActive && dockState.open}
            />
          );
        case "terminal":
          if (context.runtimeMode === "preview") {
            return <PanelStateMessage>Terminal is sleeping. Restoring shortly.</PanelStateMessage>;
          }
          return (
            <DockTerminalPane
              hostThreadId={props.threadId}
              projectId={props.projectId}
              isActive={context.isActive && dockState.open}
            />
          );
        case "explorer":
          return (
            <DockExplorerPane
              workspaceRoot={workspaceRoot}
              initialFilePath={pane.filePath}
              onReferenceInChat={handleReferenceInChat}
              onAskWhyInChat={handleAskWhyInChat}
              onCommentInChat={handleCommentInChat}
            />
          );
      }
    },
    [
      closePane,
      dockState.open,
      handleAskWhyInChat,
      handleCommentInChat,
      handleReferenceInChat,
      props.projectId,
      props.threadId,
      updatePane,
      workspaceRoot,
    ],
  );

  const handleSelectDockPane = useCallback(
    (paneId: string) => {
      requestImmediateDockHydration(dockState.panes.find((pane) => pane.id === paneId)?.kind);
      setActivePane(props.threadId, paneId);
    },
    [dockState.panes, props.threadId, requestImmediateDockHydration, setActivePane],
  );
  // The editor file path arrives via the URL, so an attacker-crafted link can
  // carry traversal segments ("../../etc"). Treat unsafe values as no selection
  // so neither the ancestor prefetch nor the preview ever queries them.
  const rawEditorFilePath = props.search.editorFilePath ?? null;
  const selectedEditorFilePath =
    rawEditorFilePath !== null && isWorkspaceRelativePathSafe(rawEditorFilePath)
      ? rawEditorFilePath
      : null;
  useEffect(() => {
    if (!selectedEditorFilePath) {
      return;
    }

    const parentPaths = collectParentDirectoryPaths(selectedEditorFilePath);
    if (parentPaths.length === 0) {
      return;
    }

    // Prefetch every ancestor listing in parallel: the explorer renders one
    // directory level at a time, so without this each depth waits for the
    // previous level's response (a per-level request waterfall).
    if (workspaceRoot) {
      for (const parentPath of parentPaths) {
        void queryClient.prefetchQuery(
          projectListDirectoriesQueryOptions({
            cwd: workspaceRoot,
            relativePath: parentPath,
            includeFiles: true,
          }),
        );
      }
    }

    setEditorExpandedDirectories((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const parentPath of parentPaths) {
        if (!next.has(parentPath)) {
          next.add(parentPath);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [workspaceRoot, queryClient, selectedEditorFilePath]);

  const editorChatPanelState = useMemo<ChatPanelState>(
    () => ({
      panel: editorCenterMode === "diff" ? "diff" : null,
      diffTurnId: editorDiffPanelState.diffTurnId,
      diffFilePath: editorDiffPanelState.diffFilePath,
      hasOpenedPanel: true,
      lastOpenPanel: "diff",
    }),
    [editorCenterMode, editorDiffPanelState.diffFilePath, editorDiffPanelState.diffTurnId],
  );

  if (props.search.view === "editor") {
    const editorSurface = (
      <WorkspaceFileOpenerContext.Provider value={editorFileOpener}>
        <div
          className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
        >
          <EditorWorkspaceView
            workspaceRoot={workspaceRoot}
            projectName={activeProject?.name ?? null}
            currentProjectId={activeProject?.id ?? null}
            projectOptions={editorProjectOptions}
            selectedFilePath={selectedEditorFilePath}
            expandedDirectories={editorExpandedDirectories}
            centerMode={editorCenterMode}
            diffFiles={editorDiffFiles}
            diffFilesLoading={editorDiffFilesLoading}
            selectedDiffFilePath={editorDiffPanelState.diffFilePath ?? null}
            diffOptionsControl={editorDiffOptionsControl}
            onSelectDiffFile={handleSelectEditorDiffFile}
            onSelectFile={handleSelectEditorFile}
            onToggleDirectory={handleToggleEditorDirectory}
            onCenterModeChange={setEditorCenterMode}
            onExitEditorView={handleCloseEditorView}
            onReferenceInChat={handleReferenceInChat}
            onAskWhyInChat={handleAskWhyInChat}
            onCommentInChat={handleCommentInChat}
            onSelectProject={handleSelectEditorProject}
            diffPanel={
              <LazyDiffPanel
                mode="sidebar"
                threadId={props.threadId}
                panelState={editorDiffPanelState}
                onUpdatePanelState={handleUpdateEditorDiffPanelState}
                liveRefreshEnabled={editorCenterMode === "diff"}
                // Keep diff data warm while browsing files so switching to the
                // diff tab renders instantly instead of cold-fetching.
                queriesEnabled
                hideHeader
                onRenderableFilesChange={handleEditorDiffFilesChange}
                onEditorDiffOptionsChange={handleEditorDiffOptionsChange}
              />
            }
            chatPanel={
              <SidebarInset
                className="min-h-0 min-w-0 overflow-hidden overscroll-y-none text-foreground"
                surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}
              >
                <ChatView
                  threadId={props.threadId}
                  paneScopeId={EDITOR_CHAT_PANE_SCOPE_ID}
                  surfaceMode="split"
                  presentationMode="editor"
                  isFocusedPane={true}
                  panelState={editorChatPanelState}
                  onToggleDiffPanel={handleEditorToggleDiff}
                  onOpenTurnDiffPanel={handleEditorOpenTurnDiff}
                />
              </SidebarInset>
            }
          />
        </div>
      </WorkspaceFileOpenerContext.Provider>
    );
    return <ProjectSurfaceFrame>{editorSurface}</ProjectSurfaceFrame>;
  }

  const chatSurface = (
    <WorkspaceFileOpenerContext.Provider value={dockFileOpener}>
      <div
        className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
      >
        <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
          <ChatView
            threadId={props.threadId}
            paneScopeId={SINGLE_CHAT_PANE_SCOPE_ID}
            surfaceMode="single"
            isFocusedPane={true}
            panelState={chatPanelState}
            onToggleDiffPanel={handleToggleDiff}
            onOpenTurnDiffPanel={handleOpenTurnDiff}
            viewModeAction={{
              label: "Editor view",
              active: false,
              onClick: handleOpenEditorView,
            }}
          />
        </RouteInsetSurface>
        <RightDock
          state={dockState}
          minWidth={SINGLE_PANEL_MIN_WIDTH}
          defaultWidth={DIFF_INLINE_DEFAULT_WIDTH}
          shouldAcceptWidth={shouldAcceptDockWidth}
          addMenuKinds={RIGHT_DOCK_ADD_MENU_KINDS}
          motionKey={props.threadId}
          activePaneRuntimeMode={activePaneRuntimeMode}
          onSelectPane={handleSelectDockPane}
          onClosePane={(paneId) => closePane(props.threadId, paneId)}
          onCollapse={() => setDockOpen(props.threadId, false)}
          onOpenChange={(open) => setDockOpen(props.threadId, open)}
          onAddPane={handleAddDockPane}
          renderPane={renderDockPane}
        />
      </div>
    </WorkspaceFileOpenerContext.Provider>
  );
  return <ProjectSurfaceFrame>{chatSurface}</ProjectSurfaceFrame>;
}

function ChatThreadRouteView() {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const hasKnownServerThreads = useStore(
    (store) => (store.threadIds?.length ?? 0) > 0 || store.threads.length > 0,
  );
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const threadProjectIdSelector = useMemo(
    () => createThreadProjectIdSelector(threadId),
    [threadId],
  );
  const threadExistsSelector = useMemo(() => createThreadExistsSelector(threadId), [threadId]);
  const threadProjectId: ProjectId | null = useStore(threadProjectIdSelector);
  const threadExists = useStore(threadExistsSelector);
  const draftThreadState = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const draftThreadExists = draftThreadState !== null;
  const routeThreadExists = threadExists || draftThreadExists;
  const activeProjectId = resolveSingleProjectId({
    threadProjectId,
    draftProjectId: draftThreadState?.projectId ?? null,
  });
  const navigate = useNavigate();
  const [missingThreadRecoveryState, setMissingThreadRecoveryState] =
    useState<EmptyRouteRestoreRecoveryState>("idle");
  const mountedRef = useRef(true);
  const missingThreadRecoveryRunRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    missingThreadRecoveryRunRef.current += 1;
    setMissingThreadRecoveryState("idle");
  }, [threadId]);

  useEffect(() => {
    if (routeThreadExists && missingThreadRecoveryState !== "idle") {
      missingThreadRecoveryRunRef.current += 1;
      setMissingThreadRecoveryState("idle");
    }
  }, [missingThreadRecoveryState, routeThreadExists]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      if (
        shouldStartMissingThreadRouteRecovery({
          hasKnownServerThreads,
          recoveryState: missingThreadRecoveryState,
          routeThreadExists,
        })
      ) {
        const recoveryRun = (missingThreadRecoveryRunRef.current += 1);
        setMissingThreadRecoveryState("pending");
        void Promise.all([
          refreshEmptyRouteRestoreSnapshot(readNativeApi()).catch(() => false),
          waitForEmptyRouteRestoreFallbackDelay(),
        ]).finally(() => {
          if (mountedRef.current && missingThreadRecoveryRunRef.current === recoveryRun) {
            setMissingThreadRecoveryState("done");
          }
        });
        return;
      }

      if (
        shouldHoldMissingThreadRouteFallback({
          hasKnownServerThreads,
          recoveryState: missingThreadRecoveryState,
          routeThreadExists,
        })
      ) {
        return;
      }
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [
    hasKnownServerThreads,
    missingThreadRecoveryState,
    navigate,
    routeThreadExists,
    threadId,
    threadsHydrated,
  ]);

  if (
    !threadsHydrated ||
    shouldHoldMissingThreadRouteFallback({
      hasKnownServerThreads,
      recoveryState: missingThreadRecoveryState,
      routeThreadExists,
    })
  ) {
    return null;
  }

  if (!routeThreadExists) {
    return null;
  }

  return <SingleChatSurface threadId={threadId} search={search} projectId={activeProjectId} />;
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  component: ChatThreadRouteView,
});
