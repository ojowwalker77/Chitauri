// FILE: _chat.research.index.tsx
// Purpose: Lists durable research artifacts across repositories and worktrees.

import { workspaceRootsEqual } from "@t3tools/shared/threadWorkspace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { ProjectSurfaceFrame } from "~/components/ProjectSurfaceFrame";
import { RepositoryProjectFilter } from "~/components/RepositoryProjectFilter";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { CHAT_BACKGROUND_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { useOpenResearchDocument } from "~/hooks/useOpenResearchDocument";
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  BooksIcon,
  FileIcon,
  GitBranchIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "~/lib/icons";
import {
  ALL_PROJECTS_FILTER,
  parseProjectFilterSearch,
  projectFilterValue,
  resolveProjectFilter,
} from "~/lib/projectFilter";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useLatestProjectStore } from "~/latestProjectStore";
import { useStore } from "~/store";
import {
  researchListQueryOptions,
  setResearchArchived,
  updateResearchArchiveCaches,
} from "./-research.shared";

type ResearchLibraryView = "new" | "archived";

export const Route = createFileRoute("/_chat/research/")({
  validateSearch: (search) => ({
    ...parseProjectFilterSearch(search),
    libraryView: search.libraryView === "archived" ? ("archived" as const) : undefined,
  }),
  component: ResearchIndexRoute,
});

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function ResearchIndexRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const libraryView: ResearchLibraryView = search.libraryView ?? "new";
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);
  const projectsHydrated = useStore((state) => state.threadsHydrated);
  const projects = useStore((state) => state.projects);
  const repositoryProjects = projects.filter((project) => project.kind === "project");
  const project = resolveProjectFilter({
    projects: repositoryProjects,
    searchProject: search.project,
    latestProjectId,
  });
  const canonicalProjectFilter = projectFilterValue(project);
  useEffect(() => {
    if (!projectsHydrated) return;
    if (search.project === canonicalProjectFilter) return;
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, project: canonicalProjectFilter }),
    });
  }, [canonicalProjectFilter, navigate, projectsHydrated, search.project]);
  const query = useQuery(researchListQueryOptions());
  const openResearch = useOpenResearchDocument();
  const archiveMutation = useMutation({
    mutationFn: setResearchArchived,
    onSuccess: (result, input) => {
      updateResearchArchiveCaches(queryClient, result);
      toastManager.add({
        type: "success",
        title: input.archived ? "Research archived" : "Research restored",
      });
    },
    onError: (error, input) => {
      toastManager.add({
        type: "error",
        title: input.archived ? "Could not archive research" : "Could not restore research",
        description: error instanceof Error ? error.message : "The archive state did not change.",
      });
    },
  });
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();
  const projectDocuments = (query.data?.documents ?? []).filter((document) => {
    if (!project) return true;
    const repositoryNameMatches =
      document.repositoryName === project.name ||
      document.repositoryName === project.remoteName ||
      document.repositoryName === project.folderName;
    return (
      (document.repositoryRoot
        ? workspaceRootsEqual(document.repositoryRoot, project.cwd)
        : false) || repositoryNameMatches
    );
  });
  const newDocumentCount = projectDocuments.filter(
    (document) => document.archivedAt === null,
  ).length;
  const archivedDocumentCount = projectDocuments.length - newDocumentCount;
  const documents = projectDocuments.filter((document) =>
    libraryView === "archived" ? document.archivedAt !== null : document.archivedAt === null,
  );
  const loadError = query.error instanceof Error ? query.error.message : null;

  const updateProjectFilter = (value: string) => {
    if (value !== ALL_PROJECTS_FILTER) {
      const nextProject = repositoryProjects.find((candidate) => candidate.id === value);
      if (!nextProject) return;
      useLatestProjectStore.getState().setLatestProjectId(nextProject.id);
    }
    void navigate({
      search: (previous) => ({ ...previous, project: value }),
    });
  };

  const updateLibraryView = (view: ResearchLibraryView) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        libraryView: view === "archived" ? "archived" : undefined,
      }),
    });
  };

  return (
    <ProjectSurfaceFrame>
      <RouteInsetSurface>
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            CHAT_BACKGROUND_CLASS_NAME,
          )}
        >
          <header
            className={cn(
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              "drag-region",
              desktopTopBarTrafficLightGutterClassName,
              desktopTopBarWindowControlsGutterClassName,
            )}
          >
            <div className={cn("flex items-center gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}>
              <SidebarHeaderNavigationControls />
              <BooksIcon className="size-4 text-foreground" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-[590] tracking-[-0.005em] text-foreground">
                Research Library
              </span>
              <RepositoryProjectFilter
                ariaLabel="Research Library repository"
                projects={repositoryProjects}
                selectedProject={project}
                onValueChange={updateProjectFilter}
                align="end"
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh Research Library"
                title="Refresh Research Library"
                onClick={() => void query.refetch()}
                className="[-webkit-app-region:no-drag]"
              >
                <RefreshCwIcon className={cn("size-4", query.isFetching && "animate-spin")} />
              </Button>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-16 pt-6 sm:px-10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div
                  role="radiogroup"
                  aria-label="Research Library view"
                  className="inline-flex items-center gap-0.5 rounded-lg bg-muted/70 p-0.5"
                >
                  {(
                    [
                      { value: "new", label: "New", count: newDocumentCount },
                      { value: "archived", label: "Archived", count: archivedDocumentCount },
                    ] as const
                  ).map((option) => {
                    const active = libraryView === option.value;
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        variant={active ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => updateLibraryView(option.value)}
                        className={cn(
                          "min-w-[5.5rem] gap-1.5 rounded-md px-2.5",
                          !active && "text-muted-foreground",
                        )}
                      >
                        {option.label}
                        <span className="text-[10px] tabular-nums text-faint">{option.count}</span>
                      </Button>
                    );
                  })}
                </div>
                {query.data ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void ensureNativeApi().shell.showInFolder(query.data.plansRoot)}
                    className="shrink-0 gap-2"
                  >
                    <FileIcon className="size-3.5" />
                    Open library folder
                  </Button>
                ) : null}
              </div>
              <p className="mb-5 max-w-xl text-[13px] leading-5 text-muted-foreground">
                {libraryView === "archived"
                  ? "Archived research stays available here until you restore it."
                  : project
                    ? `Plans and investigations saved for ${project.name}.`
                    : "Plans and investigations across every repository."}
              </p>

              {query.isLoading || !projectsHydrated ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  Loading research…
                </div>
              ) : query.isError ? (
                <div className="flex flex-col items-center rounded-xl border border-destructive/28 bg-panel px-8 py-16 text-center">
                  <p className="text-sm font-medium text-foreground">
                    Research could not be loaded
                  </p>
                  <p className="mt-1 max-w-md text-pretty text-xs leading-5 text-muted-foreground">
                    {loadError ?? "The research service did not return a usable response."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void query.refetch()}
                    className="mt-4"
                  >
                    Try again
                  </Button>
                </div>
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-panel-border bg-panel px-8 py-16 text-center">
                  {libraryView === "archived" ? (
                    <ArchiveIcon className="mb-3 size-6 text-muted-foreground" />
                  ) : (
                    <BooksIcon className="mb-3 size-6 text-muted-foreground" />
                  )}
                  <p className="text-sm font-medium text-foreground">
                    {libraryView === "archived"
                      ? "No archived research"
                      : project
                        ? "This research library is ready"
                        : "Your research library is ready"}
                  </p>
                  <p className="mt-1 max-w-sm text-pretty text-xs leading-5 text-muted-foreground">
                    {libraryView === "archived" ? (
                      "Research you archive will remain reachable here."
                    ) : (
                      <>
                        Invoke <span className="font-mono text-foreground">/research</span> in any
                        repository thread. The agent will save a polished plan and its sources here.
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-panel-border bg-panel">
                  {documents.map((document) => {
                    const changingArchiveState =
                      archiveMutation.isPending && archiveMutation.variables.id === document.id;
                    return (
                      <div
                        key={document.id}
                        className="group flex items-start border-b border-panel-border transition-colors duration-press ease-out last:border-b-0 hover:bg-hover motion-reduce:transition-none"
                      >
                        <button
                          type="button"
                          onClick={() => void openResearch(document)}
                          className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3.5 text-left active:opacity-70"
                        >
                          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-selected text-foreground">
                            <FileIcon className="size-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <h2 className="line-clamp-1 text-[14px] font-medium leading-5 text-foreground">
                                {document.title}
                              </h2>
                              <span className="shrink-0 text-[11px] tabular-nums text-faint">
                                {shortDate(document.updatedAt)}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                              {document.summary ??
                                "Open the Markdown document to review its findings and implementation plan."}
                            </p>
                            <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px] text-faint">
                              <span className="truncate text-muted-foreground">
                                {document.repositoryName}
                              </span>
                              <span>·</span>
                              <span>Markdown</span>
                              {document.branch ? (
                                <span className="flex min-w-0 items-center gap-1 truncate">
                                  <GitBranchIcon className="size-3 shrink-0" />
                                  <span className="truncate">{document.branch}</span>
                                </span>
                              ) : null}
                              <span className="ml-auto shrink-0">
                                {document.referenceCount} refs
                              </span>
                            </div>
                          </div>
                          <ArrowUpRightIcon className="mt-1 size-3.5 shrink-0 text-faint opacity-0 transition-opacity duration-tooltip group-hover:opacity-100" />
                        </button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          disabled={changingArchiveState}
                          aria-label={
                            libraryView === "archived"
                              ? `Restore ${document.title}`
                              : `Archive ${document.title}`
                          }
                          title={
                            libraryView === "archived" ? "Restore research" : "Archive research"
                          }
                          onClick={() =>
                            archiveMutation.mutate({
                              id: document.id,
                              archived: libraryView !== "archived",
                            })
                          }
                          className="mr-2 mt-3 shrink-0 opacity-70 group-hover:opacity-100"
                        >
                          {libraryView === "archived" ? (
                            <RotateCcwIcon
                              className={cn("size-3.5", changingArchiveState && "animate-spin")}
                            />
                          ) : (
                            <ArchiveIcon
                              className={cn("size-3.5", changingArchiveState && "animate-pulse")}
                            />
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
        </div>
      </RouteInsetSurface>
    </ProjectSurfaceFrame>
  );
}
