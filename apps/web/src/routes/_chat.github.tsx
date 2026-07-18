import type {
  GitHubCheckStatus,
  GitHubWorkItemActionInput,
  GitHubWorkItemDetail,
  GitHubWorkItemSummary,
  GitHubWorkListView,
} from "@t3tools/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { DiffPanelPatchViewport } from "~/components/DiffPanelPatchViewport";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { ProjectSurfaceFrame } from "~/components/ProjectSurfaceFrame";
import { RepositoryProjectFilter } from "~/components/RepositoryProjectFilter";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { disclosureChevronClassName } from "~/lib/disclosureMotion";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { useComposerDraftStore } from "~/composerDraftStore";
import {
  DEFAULT_GITHUB_VIEW,
  GITHUB_WORK_VIEWS,
  buildGitHubAgentPrompt,
  findProjectForGitHubItem,
  groupGitHubItemsByRepository,
} from "~/githubWorkbench.logic";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useLatestProjectStore } from "~/latestProjectStore";
import { useTheme } from "~/hooks/useTheme";
import { formatRelativeTime } from "~/lib/relativeTime";
import {
  githubConnectionQueryOptions,
  githubPullRequestDiffQueryOptions,
  githubWorkItemActionMutationOptions,
  githubWorkItemDetailQueryOptions,
  githubWorkListQueryOptions,
} from "~/lib/githubReactQuery";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  EyeIcon,
  GitBranchIcon,
  GitHubIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  ListTodoIcon,
  MessageCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "~/lib/icons";
import { getRenderablePatch, sortFileDiffsByPath } from "~/lib/diffRendering";
import {
  ALL_PROJECTS_FILTER,
  parseProjectFilterSearch,
  projectFilterValue,
  resolveProjectFilter,
} from "~/lib/projectFilter";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { toastManager } from "~/components/ui/toast";

export const Route = createFileRoute("/_chat/github")({
  validateSearch: (search) => parseProjectFilterSearch(search),
  component: GitHubWorkbenchRoute,
});

type DetailTab = "summary" | "timeline" | "code";
type ComposerMode = "comment" | null;
type AgentIntent = "work" | "review" | "triage";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "GitHub request failed.";
}

function StatusDot({ status }: { status: GitHubCheckStatus | null }) {
  return (
    <span
      aria-label={status ? `Checks ${status}` : "No check status"}
      className={cn(
        "size-2 shrink-0 rounded-full border",
        status === "success" && "border-success/60 bg-success",
        status === "failure" && "border-destructive/60 bg-destructive",
        status === "pending" && "border-[var(--info)]/60 bg-[var(--info)]",
        status === "cancelled" && "border-faint/60 bg-faint",
        (status === "neutral" || status === "skipped" || status === null) &&
          "border-muted-foreground/40 bg-muted-foreground/25",
      )}
    />
  );
}

function ItemGlyph({ item }: { item: GitHubWorkItemSummary }) {
  const Icon = item.kind === "pull_request" ? GitPullRequestIcon : ListTodoIcon;
  return (
    <Icon
      className={cn(
        "mt-0.5 size-4 shrink-0",
        item.state === "open"
          ? "text-success"
          : item.state === "merged"
            ? "text-success"
            : "text-muted-foreground",
      )}
    />
  );
}

function WorkListRow({
  item,
  selected,
  onSelect,
}: {
  item: GitHubWorkItemSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left outline-none transition-[background-color,scale] duration-press ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:active:scale-100",
        selected ? "bg-selected" : "hover:bg-hover",
      )}
    >
      <ItemGlyph item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{item.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>#{item.number}</span>
          {item.isDraft ? <span>Draft</span> : null}
          <span>·</span>
          <span className="shrink-0">{formatRelativeTime(item.updatedAt)}</span>
          {item.kind === "pull_request" && (item.additions != null || item.deletions != null) ? (
            <span className="shrink-0">
              <span className="text-success">+{item.additions ?? 0}</span>{" "}
              <span className="text-destructive">−{item.deletions ?? 0}</span>
            </span>
          ) : null}
          <span className="ml-auto">
            <StatusDot status={item.checkStatus} />
          </span>
        </span>
      </span>
    </button>
  );
}

function EmptyList({ loading, error }: { loading: boolean; error: unknown }) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-4" /> Loading GitHub work…
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        {errorMessage(error)}
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
      <CheckCircle2Icon className="size-5 text-success/80" />
      <p>No matching GitHub work.</p>
    </div>
  );
}

function DetailHeader({
  detail,
  tab,
  refreshing,
  onBack,
  onTabChange,
  onOpenExternal,
  onRefresh,
}: {
  detail: GitHubWorkItemDetail;
  tab: DetailTab;
  refreshing: boolean;
  onBack: () => void;
  onTabChange: (tab: DetailTab) => void;
  onOpenExternal: () => void;
  onRefresh: () => void;
}) {
  const tabs: ReadonlyArray<{ value: DetailTab; label: string }> = [
    { value: "summary", label: "Summary" },
    { value: "timeline", label: "Timeline" },
    ...(detail.item.kind === "pull_request" ? ([{ value: "code", label: "Code" }] as const) : []),
  ];
  return (
    <div className="flex min-h-12 items-center gap-2 border-b border-border/70 px-3 py-1.5">
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Back to work list"
          className="md:hidden"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <ItemGlyph item={detail.item} />
        <span className="truncate text-[13px] font-medium text-foreground">
          {detail.item.title}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {tabs.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => onTabChange(entry.value)}
            className={cn(
              "h-8 rounded-[8px] px-3 text-xs transition-[background-color,color,scale] duration-press ease-out active:scale-[0.96] motion-reduce:active:scale-100",
              tab === entry.value
                ? "bg-selected text-foreground"
                : "text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-1">
        <Button size="icon-xs" variant="ghost" aria-label="Open in GitHub" onClick={onOpenExternal}>
          <ArrowUpRightIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh this item"
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? <Spinner className="size-3.5" /> : <RefreshCwIcon />}
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger" | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-foreground",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function workItemStatusText(item: GitHubWorkItemSummary): string {
  if (item.state === "merged") return "Merged";
  if (item.state === "closed") return "Closed";
  if (item.kind === "pull_request") {
    return item.isDraft ? "Draft" : "Ready for review";
  }
  return "Open";
}

function checksSummaryText(detail: GitHubWorkItemDetail): string {
  if (detail.checks.length === 0) return "No CI checks";
  const failing = detail.checks.filter(
    (check) => check.status === "failure" || check.status === "cancelled",
  ).length;
  if (failing > 0) {
    return `${detail.checks.length} checks · ${failing} failing`;
  }
  const pending = detail.checks.filter((check) => check.status === "pending").length;
  if (pending > 0) {
    return `${detail.checks.length} checks · ${pending} running`;
  }
  return "All checks passing";
}

function MetaRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof GitBranchIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1 text-[13px]">
      <span className="flex w-28 shrink-0 items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-foreground">
        {children}
      </span>
    </div>
  );
}

function DetailHero({ item }: { item: GitHubWorkItemSummary }) {
  return (
    <header>
      <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.01em] text-foreground">
        {item.title}
      </h1>
      <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {item.author?.avatarUrl ? (
          <img src={item.author.avatarUrl} alt="" className="size-4 rounded-full" />
        ) : null}
        <span className="text-foreground">{item.author?.login ?? "Unknown"}</span>
        <span>·</span>
        <span>{formatRelativeTime(item.updatedAt)}</span>
        <span>·</span>
        <span>{workItemStatusText(item)}</span>
      </p>
    </header>
  );
}

function SummaryView({
  detail,
  cwd,
  rerunningCheckId,
  onRerunCheck,
}: {
  detail: GitHubWorkItemDetail;
  cwd: string | null;
  rerunningCheckId: number | null;
  onRerunCheck: (runId: number) => void;
}) {
  const item = detail.item;
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-6">
      <DetailHero item={item} />
      {item.kind === "pull_request" ? (
        <section className="space-y-0.5">
          <MetaRow icon={GitBranchIcon} label="Branch">
            <span className="truncate">{detail.headBranch ?? "?"}</span>
            <ChevronRightIcon className="size-3 shrink-0 text-faint" />
            <span className="shrink-0">{detail.baseBranch ?? "?"}</span>
            {item.additions != null || item.deletions != null ? (
              <span className="ml-1 shrink-0">
                <span className="text-success">+{item.additions ?? 0}</span>{" "}
                <span className="text-destructive">−{item.deletions ?? 0}</span>
              </span>
            ) : null}
          </MetaRow>
          <MetaRow icon={EyeIcon} label="Reviewers">
            {detail.reviewers.length > 0
              ? detail.reviewers
                  .map(
                    (reviewer) =>
                      `${reviewer.actor.login}${reviewer.state ? ` · ${reviewer.state.toLowerCase()}` : ""}`,
                  )
                  .join(", ")
              : "No reviewers"}
          </MetaRow>
          <MetaRow icon={MessageCircleIcon} label="Comments">
            {item.commentsCount > 0
              ? `${item.commentsCount} comment${item.commentsCount === 1 ? "" : "s"}`
              : "No comments"}
          </MetaRow>
          <MetaRow icon={CircleAlertIcon} label="Checks">
            <span
              className={cn(
                item.checkStatus === "failure" && "text-destructive",
                item.checkStatus === "success" && "text-success",
              )}
            >
              {checksSummaryText(detail)}
            </span>
          </MetaRow>
        </section>
      ) : (
        <section className="grid gap-x-8 gap-y-1 rounded-xl border border-border/70 bg-background/35 p-4 sm:grid-cols-2">
          <>
            <Stat label="Author" value={item.author?.login ?? "Unknown"} />
            <Stat label="State" value={item.state} />
            <Stat
              label="Assignees"
              value={item.assignees.map((actor) => actor.login).join(", ") || "None"}
            />
            <Stat label="Milestone" value={detail.milestone?.title ?? "None"} />
          </>
        </section>
      )}

      {detail.checks.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Checks
          </h2>
          <div className="divide-y divide-border/60 rounded-xl border border-border/70">
            {detail.checks.map((check) => (
              <div
                key={`${check.name}:${check.url ?? ""}`}
                className="flex items-center gap-2 px-3 py-2 text-xs"
              >
                <StatusDot status={check.status} />
                <span className="min-w-0 flex-1 truncate">
                  {check.workflow ? `${check.workflow} · ` : ""}
                  {check.name}
                </span>
                <span className="capitalize text-muted-foreground">{check.status}</span>
                {check.runId && (check.status === "failure" || check.status === "cancelled") ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={rerunningCheckId === check.runId}
                    onClick={() => onRerunCheck(check.runId!)}
                  >
                    {rerunningCheckId === check.runId ? (
                      <Spinner className="size-3" />
                    ) : (
                      <RefreshCwIcon className="size-3" />
                    )}
                    Rerun
                  </Button>
                ) : null}
                {check.url ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => void ensureNativeApi().shell.openExternal(check.url!)}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {item.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {item.labels.map((label) => (
            <span
              key={label.name}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}

      <Collapsible open={descriptionOpen} onOpenChange={setDescriptionOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Description
          <ChevronRightIcon className={disclosureChevronClassName(descriptionOpen)} />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="pt-3">
            {detail.body.trim() ? (
              <ChatMarkdown
                text={detail.body}
                cwd={cwd ?? undefined}
                className="text-sm leading-relaxed"
              />
            ) : (
              <p className="text-sm text-muted-foreground">No description.</p>
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

function TimelineView({ detail, cwd }: { detail: GitHubWorkItemDetail; cwd: string | null }) {
  if (detail.timeline.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No comments, reviews, or commits yet.
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 px-5 py-5">
      {detail.timeline.map((entry) => (
        <article key={entry.id} className="rounded-xl border border-border/70 p-4">
          <header className="mb-2 flex items-center gap-2 text-xs">
            {entry.type === "comment" ? (
              <MessageCircleIcon className="size-3.5" />
            ) : entry.type === "review" ? (
              <GitPullRequestIcon className="size-3.5" />
            ) : (
              <GitMergeIcon className="size-3.5" />
            )}
            <span className="font-medium">{entry.author?.login ?? "GitHub"}</span>
            <span className="capitalize text-muted-foreground">
              {entry.type}
              {entry.state ? ` · ${entry.state.toLowerCase()}` : ""}
            </span>
            <span className="ml-auto text-muted-foreground">
              {formatRelativeTime(entry.createdAt)}
            </span>
          </header>
          {entry.title ? <p className="mb-1 text-sm font-medium">{entry.title}</p> : null}
          {entry.body ? (
            <ChatMarkdown
              text={entry.body}
              cwd={cwd ?? undefined}
              className="text-sm leading-relaxed"
            />
          ) : null}
        </article>
      ))}
    </div>
  );
}

function CodeView({ detail, cwd }: { detail: GitHubWorkItemDetail; cwd: string | null }) {
  const { resolvedTheme } = useTheme();
  const diffInput = {
    cwd,
    repository: detail.item.repository.nameWithOwner,
    number: detail.item.number,
  };
  const diffQuery = useQuery(githubPullRequestDiffQueryOptions(diffInput, true));
  const renderablePatch = useMemo(
    () => getRenderablePatch(diffQuery.data?.patch, `github-pr:${detail.item.id}`),
    [detail.item.id, diffQuery.data?.patch],
  );
  const files = useMemo(
    () => (renderablePatch?.kind === "files" ? sortFileDiffsByPath(renderablePatch.files) : []),
    [renderablePatch],
  );
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCollapsed = useCallback((fileKey: string) => {
    setCollapsedFiles((current) => {
      const next = new Set(current);
      if (next.has(fileKey)) next.delete(fileKey);
      else next.add(fileKey);
      return next;
    });
  }, []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {diffQuery.data?.truncated ? (
        <div className="border-b border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          This diff exceeded 8 MB and is truncated.
        </div>
      ) : null}
      <DiffPanelPatchViewport
        renderablePatch={renderablePatch}
        renderableFiles={files}
        resolvedTheme={resolvedTheme}
        diffRenderMode="stacked"
        diffWordWrap={false}
        workspaceRoot={cwd}
        collapsedFiles={collapsedFiles}
        onToggleFileCollapsed={toggleCollapsed}
        isLoading={diffQuery.isPending}
        hasNoChanges={diffQuery.data?.patch.trim().length === 0}
        error={diffQuery.error ? errorMessage(diffQuery.error) : null}
        loadingLabel="Loading pull request diff…"
        emptyLabel="This pull request has no file changes."
        unavailableLabel="Pull request diff is unavailable."
        viewKind="repo"
      />
    </div>
  );
}

function ActionComposer({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  return (
    <div className="border-t border-border/70 bg-background/95 p-3">
      <Textarea
        autoFocus
        size="sm"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a comment"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="xs"
          onClick={() => onSubmit(body)}
          disabled={pending || body.trim().length === 0}
        >
          {pending ? "Posting…" : "Post comment"}
        </Button>
      </div>
    </div>
  );
}

function IssueCreationDialog({
  open,
  defaultRepository,
  pending,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  defaultRepository: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { repository: string; title: string; body: string }) => void;
}) {
  const [repository, setRepository] = useState(defaultRepository);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (open) setRepository(defaultRepository);
  }, [defaultRepository, open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create issue</DialogTitle>
          <DialogDescription>
            Create the issue directly through your authenticated GitHub account.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Repository</span>
            <Input value={repository} readOnly aria-readonly="true" />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Title</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Description</span>
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
        </DialogPanel>
        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onCreate({ repository: repository.trim(), title: title.trim(), body })}
            disabled={pending || !repository.trim() || !title.trim()}
          >
            {pending ? "Creating…" : "Create issue"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function GitHubWorkbenchRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);
  const queryClient = useQueryClient();
  const projectsHydrated = useStore((state) => state.threadsHydrated);
  const projects = useStore((state) => state.projects);
  const { handleNewThread } = useHandleNewThread();
  const attachedProjects = useMemo(
    () => projects.filter((project) => project.kind === "project"),
    [projects],
  );
  const selectedAttachedProject = resolveProjectFilter({
    projects: attachedProjects,
    searchProject: search.project,
    latestProjectId,
  });
  const canonicalProjectFilter = projectFilterValue(selectedAttachedProject);
  useEffect(() => {
    if (!projectsHydrated) return;
    if (search.project === canonicalProjectFilter) return;
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, project: canonicalProjectFilter }),
    });
  }, [canonicalProjectFilter, navigate, projectsHydrated, search.project]);
  const selectedProjectCwd = selectedAttachedProject?.cwd ?? null;
  const [view, setView] = useState<GitHubWorkListView>(DEFAULT_GITHUB_VIEW);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("summary");
  const [composerMode, setComposerMode] = useState<ComposerMode>(null);
  // Preparing a PR worktree is a slow git/network operation; the action buttons
  // must show it in flight and refuse double-starts.
  const [startingAgentIntent, setStartingAgentIntent] = useState<AgentIntent | null>(null);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);

  const connectionQueries = useQueries({
    queries: attachedProjects.map((project) => githubConnectionQueryOptions(project.cwd)),
  });
  const repositoryScopes = attachedProjects.flatMap((project, index) => {
    const connection = connectionQueries[index]?.data;
    if (!connection?.available || !connection.authenticated || !connection.repository) return [];
    return [
      {
        connection,
        project,
        repository: connection.repository.nameWithOwner,
      },
    ];
  });
  const uniqueRepositoryScopes = repositoryScopes.filter(
    (scope, index, scopes) =>
      scopes.findIndex(
        (candidate) => candidate.repository.toLowerCase() === scope.repository.toLowerCase(),
      ) === index,
  );
  const selectedProjectIndex = selectedAttachedProject
    ? attachedProjects.findIndex((project) => project.id === selectedAttachedProject.id)
    : -1;
  const selectedConnectionQuery =
    selectedProjectIndex >= 0 ? connectionQueries[selectedProjectIndex] : null;
  const selectedRepositoryScope = selectedAttachedProject
    ? (repositoryScopes.find((scope) => scope.project.id === selectedAttachedProject.id) ?? null)
    : null;
  const visibleRepositoryScopes = selectedAttachedProject
    ? selectedRepositoryScope
      ? [selectedRepositoryScope]
      : []
    : uniqueRepositoryScopes;
  const relevantConnectionQueries = selectedConnectionQuery
    ? [selectedConnectionQuery]
    : connectionQueries;
  const workListQueries = useQueries({
    queries: visibleRepositoryScopes.flatMap((scope) =>
      (["pull_request", "issue"] as const).map((kind) =>
        githubWorkListQueryOptions({
          cwd: scope.project.cwd,
          kind,
          view,
          query: query.trim() || null,
          repository: scope.repository,
          limit: 75,
        }),
      ),
    ),
  });
  const listLoading =
    !projectsHydrated ||
    relevantConnectionQueries.some((connectionQuery) => connectionQuery.isPending) ||
    workListQueries.some((workListQuery) => workListQuery.isPending);
  const listError =
    relevantConnectionQueries.find((connectionQuery) => connectionQuery.error)?.error ??
    workListQueries.find((workListQuery) => workListQuery.error)?.error ??
    null;
  const listSyncedAt =
    workListQueries
      .map((workListQuery) => workListQuery.data?.syncedAt)
      .filter((syncedAt): syncedAt is string => typeof syncedAt === "string")
      .sort()
      .at(-1) ?? null;
  const repositoryGroups = groupGitHubItemsByRepository(
    workListQueries.map((workListQuery) => workListQuery.data?.items ?? []),
  );
  const visibleItems = useMemo(
    () => repositoryGroups.flatMap((group) => group.items),
    [repositoryGroups],
  );
  useEffect(() => {
    if (visibleItems.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleItems.some((item) => item.id === selectedId)) {
      const autoSelect =
        typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
      setSelectedId(autoSelect ? visibleItems[0]!.id : null);
    }
  }, [selectedId, visibleItems]);
  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? null;
  const selectedItemRepositoryScope = selectedItem
    ? (repositoryScopes.find(
        (scope) =>
          scope.repository.toLowerCase() === selectedItem.repository.nameWithOwner.toLowerCase(),
      ) ?? null)
    : null;
  const selectedProject = selectedItem
    ? (selectedItemRepositoryScope?.project ??
      findProjectForGitHubItem(attachedProjects, selectedItem))
    : null;
  const selectedItemConnection = selectedItemRepositoryScope?.connection ?? null;
  const detailInput = selectedItem
    ? {
        cwd: selectedProject?.cwd ?? selectedProjectCwd,
        kind: selectedItem.kind,
        repository: selectedItem.repository.nameWithOwner,
        number: selectedItem.number,
      }
    : null;
  const detailQuery = useQuery(githubWorkItemDetailQueryOptions(detailInput));
  const detail = detailQuery.data?.detail ?? null;
  const actionMutation = useMutation(githubWorkItemActionMutationOptions(queryClient));

  const changeView = (nextView: GitHubWorkListView) => {
    setView(nextView);
    setSelectedId(null);
    setDetailTab("summary");
  };
  const runAction = async (input: GitHubWorkItemActionInput) => {
    try {
      const result = await actionMutation.mutateAsync(input);
      toastManager.add({ type: "success", title: result.message, timeout: 3500 });
      setComposerMode(null);
      return result;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "GitHub action failed",
        description: errorMessage(error),
        timeout: 6000,
      });
      return null;
    }
  };
  const target =
    selectedItem && detailInput
      ? {
          cwd: detailInput.cwd,
          kind: selectedItem.kind,
          repository: selectedItem.repository.nameWithOwner,
          number: selectedItem.number,
        }
      : null;

  const startAgent = async (intent: AgentIntent) => {
    if (startingAgentIntent !== null) {
      return;
    }
    if (!selectedItem || !selectedProject) {
      toastManager.add({
        type: "warning",
        title: "Add this repository to TeaCode first",
        description: "Agent work needs a local project or managed checkout.",
        timeout: 5000,
      });
      return;
    }
    setStartingAgentIntent(intent);
    try {
      let branch: string | null = null;
      let worktreePath: string | null = null;
      if (selectedItem.kind === "pull_request") {
        const prepared = await ensureNativeApi().git.preparePullRequestThread({
          cwd: selectedProject.cwd,
          reference: selectedItem.url,
          mode: "worktree",
        });
        branch = prepared.branch;
        worktreePath = prepared.worktreePath;
      }
      const threadId = await handleNewThread(selectedProject.id, {
        fresh: true,
        branch,
        worktreePath,
      });
      useComposerDraftStore
        .getState()
        .setPrompt(threadId, buildGitHubAgentPrompt(selectedItem, intent));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to prepare agent work",
        description: errorMessage(error),
        timeout: 6000,
      });
    } finally {
      setStartingAgentIntent(null);
    }
  };

  const connection =
    selectedAttachedProject !== null
      ? selectedConnectionQuery?.data
      : (repositoryScopes[0]?.connection ??
        connectionQueries.find((connectionQuery) => connectionQuery.data?.authenticated)?.data);
  const attachedRepository = selectedRepositoryScope?.repository ?? null;
  const connectionBlocked =
    selectedAttachedProject !== null &&
    connection &&
    (!connection.available || !connection.authenticated || connection.repository === null);

  const updateProjectFilter = (value: string) => {
    if (value !== ALL_PROJECTS_FILTER) {
      const nextProject = attachedProjects.find((project) => project.id === value);
      if (!nextProject) return;
      useLatestProjectStore.getState().setLatestProjectId(nextProject.id);
    }
    setSelectedId(null);
    setDetailTab("summary");
    setComposerMode(null);
    setCreateIssueOpen(false);
    void navigate({
      search: (previous) => ({ ...previous, project: value }),
    });
  };

  return (
    <ProjectSurfaceFrame>
      <RouteInsetSurface>
        <div className="flex h-full min-h-0 flex-col">
          <header
            className={cn(
              CHAT_SURFACE_HEADER_HEIGHT_CLASS,
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              "flex shrink-0 items-center gap-3",
            )}
          >
            <SidebarHeaderNavigationControls />
            <GitHubIcon className="size-4 text-foreground" />
            <span className="text-[14px] font-[590] tracking-[-0.005em]">Git Workbench</span>
            <RepositoryProjectFilter
              ariaLabel="Git Workbench repository"
              projects={attachedProjects}
              selectedProject={selectedAttachedProject}
              onValueChange={updateProjectFilter}
            />
            {connection?.account ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {connection.account}
                {connection.host ? ` · ${connection.host}` : ""}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Refresh Git Workbench"
                onClick={() =>
                  void queryClient.invalidateQueries({ queryKey: ["github-workbench"] })
                }
              >
                <RefreshCwIcon />
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!attachedRepository}
                title={
                  attachedRepository ? "Create issue" : "Choose a repository to create an issue"
                }
                onClick={() => setCreateIssueOpen(true)}
              >
                <PlusIcon /> Issue
              </Button>
            </div>
          </header>

          {connectionBlocked ? (
            <div className="m-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
              <div className="flex items-start gap-3">
                <TriangleAlertIcon className="mt-0.5 size-5 text-warning" />
                <div>
                  <h2 className="text-sm font-semibold">
                    {connection.repository === null &&
                    connection.authenticated &&
                    selectedAttachedProject
                      ? "No GitHub repository found"
                      : "GitHub access needs attention"}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {connection.error ??
                      "Choose a project with a GitHub remote, or inspect this repository's remotes."}
                  </p>
                  {!connection.authenticated ? (
                    <code className="mt-3 block rounded-md bg-muted px-2 py-1.5 text-xs">
                      Set TEACODE_GITHUB_TOKEN, then restart TeaCode
                    </code>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <aside
                className={cn(
                  "w-[340px] min-w-[280px] max-w-[42%] shrink-0 flex-col border-r border-border/70 max-md:w-full max-md:max-w-full",
                  selectedItem ? "hidden md:flex" : "flex",
                )}
              >
                <div className="border-b border-border/70 p-3">
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {GITHUB_WORK_VIEWS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => changeView(option.value)}
                        className={cn(
                          "h-8 shrink-0 rounded-[7px] px-2.5 text-[12px] transition-[background-color,color,scale] duration-press ease-out active:scale-[0.96] motion-reduce:active:scale-100",
                          view === option.value
                            ? "bg-selected text-foreground"
                            : "text-muted-foreground hover:bg-hover hover:text-foreground",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center rounded-[8px] border border-panel-border bg-[var(--well)] px-2">
                    <SearchIcon className="size-3.5 text-muted-foreground" />
                    <Input
                      unstyled
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search title, repo, or number"
                      className="min-h-8"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {repositoryGroups.length > 0 ? (
                    repositoryGroups.map((group) => (
                      <section key={group.repository.nameWithOwner} className="mb-2">
                        <h2 className="sticky top-0 z-10 bg-background/95 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
                          {group.repository.nameWithOwner}
                        </h2>
                        {group.items.map((item) => (
                          <WorkListRow
                            key={item.id}
                            item={item}
                            selected={item.id === selectedId}
                            onSelect={() => {
                              setSelectedId(item.id);
                              setDetailTab("summary");
                              setComposerMode(null);
                            }}
                          />
                        ))}
                      </section>
                    ))
                  ) : (
                    <EmptyList loading={listLoading} error={listError} />
                  )}
                </div>
                {listSyncedAt ? (
                  <div className="border-t border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
                    {visibleItems.length} items · synced {formatRelativeTime(listSyncedAt)}
                  </div>
                ) : null}
              </aside>

              <main
                className={cn("min-w-0 flex-1 flex-col", selectedItem ? "flex" : "hidden md:flex")}
              >
                {!selectedItem ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    <GitHubIcon className="size-6 opacity-50" />
                    Select a pull request or issue.
                  </div>
                ) : detailQuery.isPending && !detail ? (
                  <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="size-4" /> Loading details…
                  </div>
                ) : detailQuery.error && !detail ? (
                  <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
                    {errorMessage(detailQuery.error)}
                  </div>
                ) : detail ? (
                  <>
                    <DetailHeader
                      detail={detail}
                      tab={detailTab}
                      refreshing={detailQuery.isFetching}
                      onBack={() => setSelectedId(null)}
                      onTabChange={setDetailTab}
                      onOpenExternal={() =>
                        void ensureNativeApi().shell.openExternal(detail.item.url)
                      }
                      onRefresh={() => void detailQuery.refetch()}
                    />
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-3 py-2">
                      <Button
                        size="xs"
                        disabled={startingAgentIntent !== null}
                        onClick={() => void startAgent("work")}
                      >
                        {startingAgentIntent === "work" ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <SparklesIcon />
                        )}{" "}
                        Work on this
                      </Button>
                      {detail.item.kind === "pull_request" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={startingAgentIntent !== null}
                          onClick={() => void startAgent("review")}
                        >
                          {startingAgentIntent === "review" ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <GitPullRequestIcon />
                          )}{" "}
                          Review this
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={startingAgentIntent !== null}
                          onClick={() => void startAgent("triage")}
                        >
                          {startingAgentIntent === "triage" ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <ListChecksIcon />
                          )}{" "}
                          Triage this issue
                        </Button>
                      )}
                      {detail.item.kind === "issue" ? (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setComposerMode("comment")}
                          >
                            <MessageCircleIcon /> Comment
                          </Button>
                          {target ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                void runAction({
                                  action: "assign_self",
                                  ...target,
                                  assigned: !detail.item.assignees.some(
                                    (actor) => actor.login === selectedItemConnection?.account,
                                  ),
                                })
                              }
                            >
                              {detail.item.assignees.some(
                                (actor) => actor.login === selectedItemConnection?.account,
                              )
                                ? "Unassign me"
                                : "Assign me"}
                            </Button>
                          ) : null}
                          {target ? (
                            <div className="ml-auto">
                              <Button
                                size="xs"
                                variant={
                                  detail.item.state === "open" ? "destructive-outline" : "outline"
                                }
                                onClick={async () => {
                                  const nextState =
                                    detail.item.state === "open" ? "closed" : "open";
                                  const confirmed =
                                    nextState === "open" ||
                                    (await ensureNativeApi().dialogs.confirm(
                                      `Close issue #${detail.item.number}?`,
                                    ));
                                  if (confirmed)
                                    void runAction({
                                      action: "set_state",
                                      ...target,
                                      state: nextState,
                                      closeReason: nextState === "closed" ? "completed" : null,
                                    });
                                }}
                              >
                                {detail.item.state === "open" ? "Close" : "Reopen"}
                              </Button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {detailTab === "summary" ? (
                        <SummaryView
                          detail={detail}
                          cwd={selectedProject?.cwd ?? null}
                          rerunningCheckId={
                            actionMutation.variables?.action === "rerun_checks"
                              ? actionMutation.variables.runId
                              : null
                          }
                          onRerunCheck={(runId) => {
                            if (target)
                              void runAction({
                                action: "rerun_checks",
                                cwd: target.cwd,
                                kind: "pull_request",
                                repository: target.repository,
                                number: target.number,
                                runId,
                                failedOnly: true,
                              });
                          }}
                        />
                      ) : detailTab === "timeline" ? (
                        <TimelineView detail={detail} cwd={selectedProject?.cwd ?? null} />
                      ) : (
                        <CodeView
                          detail={detail}
                          cwd={selectedProject?.cwd ?? selectedProjectCwd}
                        />
                      )}
                    </div>
                    {composerMode ? (
                      <ActionComposer
                        pending={actionMutation.isPending}
                        onCancel={() => setComposerMode(null)}
                        onSubmit={(body) => {
                          if (!target) return;
                          void runAction({ action: "comment", ...target, body: body.trim() });
                        }}
                      />
                    ) : null}
                  </>
                ) : null}
              </main>
            </div>
          )}
        </div>
        <IssueCreationDialog
          open={createIssueOpen}
          defaultRepository={connection?.repository?.nameWithOwner ?? ""}
          pending={actionMutation.isPending}
          onOpenChange={setCreateIssueOpen}
          onCreate={(input) => {
            void runAction({
              action: "create_issue",
              cwd: selectedProjectCwd,
              repository: input.repository,
              title: input.title,
              body: input.body,
              labels: [],
              assignees: [],
            }).then((result) => {
              if (result) setCreateIssueOpen(false);
            });
          }}
        />
      </RouteInsetSurface>
    </ProjectSurfaceFrame>
  );
}
