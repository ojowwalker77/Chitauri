// FILE: _chat.research.index.tsx
// Purpose: Lists durable research artifacts across repositories and worktrees.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { CHAT_BACKGROUND_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { Button } from "~/components/ui/button";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { useOpenResearchDocument } from "~/hooks/useOpenResearchDocument";
import { ArrowUpRightIcon, BrainIcon, FileIcon, GitBranchIcon, RefreshCwIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { researchListQueryOptions } from "./-research.shared";

export const Route = createFileRoute("/_chat/research/")({
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
  const query = useQuery(researchListQueryOptions());
  const openResearch = useOpenResearchDocument();
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();
  const documents = query.data?.documents ?? [];
  const loadError = query.error instanceof Error ? query.error.message : null;

  return (
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
            <div className="min-w-0 flex-1" />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh research"
              title="Refresh research"
              onClick={() => void query.refetch()}
              className="[-webkit-app-region:no-drag]"
            >
              <RefreshCwIcon className={cn("size-4", query.isFetching && "animate-spin")} />
            </Button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col px-6 pb-16 pt-9 sm:px-10">
            <div className="mb-9 flex items-end justify-between gap-5">
              <div>
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-panel-border bg-panel text-claude">
                  <BrainIcon className="size-5" />
                </div>
                <h1 className="text-balance font-heading text-3xl font-semibold tracking-[-0.025em] text-foreground">
                  Research
                </h1>
                <p className="mt-2 max-w-xl text-pretty text-sm leading-6 text-muted-foreground">
                  Durable plans from every repository, ready to refine with an agent or turn into
                  implementation.
                </p>
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
                  Open plans folder
                </Button>
              ) : null}
            </div>

            {query.isLoading ? (
              <div className="py-20 text-center text-sm text-muted-foreground">
                Loading research…
              </div>
            ) : query.isError ? (
              <div className="flex flex-col items-center rounded-xl border border-destructive/28 bg-panel px-8 py-20 text-center">
                <p className="text-sm font-medium text-foreground">Research could not be loaded</p>
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
              <div className="flex flex-col items-center rounded-xl border border-panel-border bg-panel px-8 py-20 text-center">
                <BrainIcon className="mb-4 size-8 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">
                  Your research library is ready
                </p>
                <p className="mt-1 max-w-sm text-pretty text-xs leading-5 text-muted-foreground">
                  Invoke <span className="font-mono text-foreground">/research</span> in any
                  repository thread. The agent will save a polished plan and its sources here.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {documents.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => void openResearch(document)}
                    className="group flex min-h-48 flex-col rounded-xl border border-panel-border bg-panel p-5 text-left transition-[scale,background-color] duration-press ease-out hover:bg-[color-mix(in_srgb,var(--panel)_95%,white_5%)] active:scale-[0.96] motion-reduce:transition-none"
                  >
                    <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                      <span className="rounded-full bg-selected px-2.5 py-1 font-medium">
                        {document.format === "html" ? "Visual brief" : "Plan"}
                      </span>
                      <span className="tabular-nums">{shortDate(document.updatedAt)}</span>
                    </div>
                    <h2 className="mt-5 line-clamp-2 text-balance font-heading text-lg font-semibold leading-snug tracking-[-0.015em] text-foreground">
                      {document.title}
                    </h2>
                    <p className="mt-2 line-clamp-2 text-pretty text-xs leading-5 text-muted-foreground">
                      {document.summary ??
                        "Open the research artifact to review its findings and implementation plan."}
                    </p>
                    <div className="mt-auto flex items-center gap-2 pt-5 text-[11px] text-muted-foreground">
                      <span className="truncate font-medium text-foreground/80">
                        {document.repositoryName}
                      </span>
                      {document.branch ? (
                        <span className="flex min-w-0 items-center gap-1 truncate">
                          <GitBranchIcon className="size-3 shrink-0" />
                          <span className="truncate">{document.branch}</span>
                        </span>
                      ) : null}
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {document.referenceCount} refs
                        <ArrowUpRightIcon className="size-3 opacity-0 transition-opacity duration-150 group-hover:opacity-70" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </RouteInsetSurface>
  );
}
