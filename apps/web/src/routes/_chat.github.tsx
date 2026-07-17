import type {
  GitHubCheckStatus,
  GitHubWorkItemActionInput,
  GitHubWorkItemDetail,
  GitHubWorkItemSummary,
  GitHubWorkListView,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { DiffPanelPatchViewport } from "~/components/DiffPanelPatchViewport";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { Button } from "~/components/ui/button";
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
  CircleAlertIcon,
  ExternalLinkIcon,
  GitHubIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  ListTodoIcon,
  MessageCircleIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "~/lib/icons";
import { getRenderablePatch, sortFileDiffsByPath } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { toastManager } from "~/components/ui/toast";

export const Route = createFileRoute("/_chat/github")({
  component: GitHubWorkbenchRoute,
});

type DetailTab = "summary" | "timeline" | "code";
type ComposerMode = "comment" | "review" | null;

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
        status === "failure" && "border-red-500/60 bg-red-500",
        status === "pending" && "border-gold/60 bg-gold",
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
            ? "text-violet-500"
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
        "group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring/60",
        selected
          ? "bg-[var(--color-background-elevated-secondary)]"
          : "hover:bg-[var(--color-background-elevated-secondary)]/70",
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
  onBack,
  onTabChange,
  onOpenExternal,
}: {
  detail: GitHubWorkItemDetail;
  tab: DetailTab;
  onBack: () => void;
  onTabChange: (tab: DetailTab) => void;
  onOpenExternal: () => void;
}) {
  const tabs: ReadonlyArray<{ value: DetailTab; label: string }> = [
    { value: "summary", label: "Summary" },
    { value: "timeline", label: "Timeline" },
    ...(detail.item.kind === "pull_request" ? ([{ value: "code", label: "Code" }] as const) : []),
  ];
  return (
    <div className="border-b border-border/70">
      <div className="flex min-h-12 items-center gap-2 px-4 py-2">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Back to GitHub work list"
          className="md:hidden"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <ItemGlyph item={detail.item} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-foreground">
            {detail.item.title}
          </h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {detail.item.repository.nameWithOwner} #{detail.item.number} · {detail.item.state}
            {detail.item.isDraft ? " · draft" : ""}
          </p>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="Open in GitHub" onClick={onOpenExternal}>
          <ArrowUpRightIcon />
        </Button>
      </div>
      <div className="flex items-center gap-1 px-4">
        {tabs.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => onTabChange(entry.value)}
            className={cn(
              "h-8 rounded-[10px] border px-3 text-xs transition-colors",
              tab === entry.value
                ? "border-panel-border bg-panel text-foreground"
                : "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
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
          tone === "danger" && "text-red-500",
        )}
      >
        {value}
      </span>
    </div>
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
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-5 py-5">
      <section className="grid gap-x-8 gap-y-1 rounded-xl border border-border/70 bg-background/35 p-4 sm:grid-cols-2">
        {item.kind === "pull_request" ? (
          <>
            <Stat
              label="Branch"
              value={`${detail.headBranch ?? "?"} → ${detail.baseBranch ?? "?"}`}
            />
            <Stat label="Mergeability" value={detail.mergeability ?? "Unknown"} />
            <Stat label="Review" value={item.reviewDecision ?? "No decision"} />
            <Stat
              label="Checks"
              value={item.checkStatus ?? (detail.checks.length > 0 ? "Unknown" : "No checks")}
              {...(item.checkStatus === "success"
                ? { tone: "success" as const }
                : item.checkStatus === "failure"
                  ? { tone: "danger" as const }
                  : {})}
            />
            <Stat label="Files" value={String(item.changedFiles ?? "—")} />
            <Stat label="Diff" value={`+${item.additions ?? "—"} −${item.deletions ?? "—"}`} />
          </>
        ) : (
          <>
            <Stat label="Author" value={item.author?.login ?? "Unknown"} />
            <Stat label="State" value={item.state} />
            <Stat
              label="Assignees"
              value={item.assignees.map((actor) => actor.login).join(", ") || "None"}
            />
            <Stat label="Milestone" value={detail.milestone?.title ?? "None"} />
          </>
        )}
      </section>

      {detail.reviewers.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reviewers
          </h2>
          <div className="flex flex-wrap gap-2">
            {detail.reviewers.map((reviewer) => (
              <span
                key={reviewer.actor.login}
                className="rounded-full border border-border px-2 py-1 text-[11px]"
              >
                {reviewer.actor.login} · {reviewer.state?.toLowerCase() ?? "pending"}
              </span>
            ))}
          </div>
        </section>
      ) : null}

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

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Description
        </h2>
        {detail.body.trim() ? (
          <ChatMarkdown
            text={detail.body}
            cwd={cwd ?? undefined}
            className="text-sm leading-relaxed"
          />
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )}
      </section>
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
  mode,
  pending,
  canSubmitDecision,
  onCancel,
  onSubmit,
}: {
  mode: Exclude<ComposerMode, null>;
  pending: boolean;
  canSubmitDecision: boolean;
  onCancel: () => void;
  onSubmit: (body: string, verdict: "comment" | "approve" | "request_changes") => void;
}) {
  const [body, setBody] = useState("");
  const [verdict, setVerdict] = useState<"comment" | "approve" | "request_changes">("comment");
  return (
    <div className="border-t border-border/70 bg-background/95 p-3">
      {mode === "review" ? (
        <div className="mb-2">
          <div className="flex gap-1">
            {(
              [
                "comment",
                ...(canSubmitDecision ? (["approve", "request_changes"] as const) : []),
              ] as const
            ).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setVerdict(value)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] capitalize",
                  verdict === value
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {value.replaceAll("_", " ")}
              </button>
            ))}
          </div>
          {!canSubmitDecision ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              GitHub only allows a comment review on your own pull request.
            </p>
          ) : null}
        </div>
      ) : null}
      <Textarea
        autoFocus
        size="sm"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={mode === "review" ? "Review summary" : "Write a comment"}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="xs"
          onClick={() => onSubmit(body, verdict)}
          disabled={pending || body.trim().length === 0}
        >
          {pending ? "Posting…" : mode === "review" ? "Submit review" : "Post comment"}
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
            Create the issue through your authenticated GitHub CLI.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Repository</span>
            <Input
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder="owner/repository"
            />
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
  const queryClient = useQueryClient();
  const projects = useStore((state) => state.projects);
  const { handleNewThread } = useHandleNewThread();
  const firstProjectCwd = projects[0]?.cwd ?? null;
  const [view, setView] = useState<GitHubWorkListView>(DEFAULT_GITHUB_VIEW);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("summary");
  const [composerMode, setComposerMode] = useState<ComposerMode>(null);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);

  const connectionQuery = useQuery(githubConnectionQueryOptions(firstProjectCwd));
  const listInputBase = useMemo(
    () => ({
      cwd: firstProjectCwd,
      view,
      query: query.trim() || null,
      repository: null,
      limit: 75,
    }),
    [firstProjectCwd, query, view],
  );
  const pullRequestListQuery = useQuery(
    githubWorkListQueryOptions({ ...listInputBase, kind: "pull_request" }),
  );
  const issueListQuery = useQuery(githubWorkListQueryOptions({ ...listInputBase, kind: "issue" }));
  const listLoading = pullRequestListQuery.isPending || issueListQuery.isPending;
  const listError = pullRequestListQuery.error ?? issueListQuery.error;
  const listSyncedAt = pullRequestListQuery.data?.syncedAt ?? issueListQuery.data?.syncedAt ?? null;
  const repositoryGroups = useMemo(
    () =>
      groupGitHubItemsByRepository([
        pullRequestListQuery.data?.items ?? [],
        issueListQuery.data?.items ?? [],
      ]),
    [issueListQuery.data?.items, pullRequestListQuery.data?.items],
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
  const selectedProject = selectedItem ? findProjectForGitHubItem(projects, selectedItem) : null;
  const detailInput = selectedItem
    ? {
        cwd: selectedProject?.cwd ?? firstProjectCwd,
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

  const startAgent = async (intent: "work" | "review" | "fix_ci") => {
    if (!selectedItem || !selectedProject) {
      toastManager.add({
        type: "warning",
        title: "Add this repository to TeaCode first",
        description: "Agent work needs a local project or managed checkout.",
        timeout: 5000,
      });
      return;
    }
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
    }
  };

  const connection = connectionQuery.data;
  const connectionBlocked = connection && (!connection.available || !connection.authenticated);

  return (
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
          <GitHubIcon className="size-4" />
          <span className="text-sm font-semibold">GitHub</span>
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
              aria-label="Refresh GitHub"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["github-workbench"] })}
            >
              <RefreshCwIcon />
            </Button>
            <Button size="xs" variant="outline" onClick={() => setCreateIssueOpen(true)}>
              <PlusIcon /> Issue
            </Button>
          </div>
        </header>

        {connectionBlocked ? (
          <div className="m-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
            <div className="flex items-start gap-3">
              <TriangleAlertIcon className="mt-0.5 size-5 text-warning" />
              <div>
                <h2 className="text-sm font-semibold">GitHub CLI needs attention</h2>
                <p className="mt-1 text-xs text-muted-foreground">{connection.error}</p>
                <code className="mt-3 block rounded-md bg-muted px-2 py-1.5 text-xs">
                  {connection.available ? "gh auth login" : "brew install gh"}
                </code>
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
                        "shrink-0 rounded-full px-2 py-1 text-[11px]",
                        view === option.value
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center rounded-lg border border-border bg-background/60 px-2">
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
                      <h2 className="sticky top-0 z-10 bg-[var(--color-background-elevated)] px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground">
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
                    onBack={() => setSelectedId(null)}
                    onTabChange={setDetailTab}
                    onOpenExternal={() =>
                      void ensureNativeApi().shell.openExternal(detail.item.url)
                    }
                  />
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-3 py-2">
                    <Button size="xs" onClick={() => void startAgent("work")}>
                      <SparklesIcon /> Work on this
                    </Button>
                    {detail.item.kind === "pull_request" ? (
                      <Button size="xs" variant="outline" onClick={() => void startAgent("review")}>
                        <GitPullRequestIcon /> Agent review
                      </Button>
                    ) : null}
                    {detail.item.checkStatus === "failure" ? (
                      <Button size="xs" variant="outline" onClick={() => void startAgent("fix_ci")}>
                        <CircleAlertIcon /> Fix CI
                      </Button>
                    ) : null}
                    <Button size="xs" variant="ghost" onClick={() => setComposerMode("comment")}>
                      <MessageCircleIcon /> Comment
                    </Button>
                    {detail.item.kind === "pull_request" ? (
                      <Button size="xs" variant="ghost" onClick={() => setComposerMode("review")}>
                        <CheckCircle2Icon /> Review
                      </Button>
                    ) : null}
                    {detail.item.isDraft && target ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          void runAction({ action: "ready", ...target, kind: "pull_request" })
                        }
                      >
                        <PlayIcon /> Ready
                      </Button>
                    ) : null}
                    {target ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          void runAction({
                            action: "assign_self",
                            ...target,
                            assigned: !detail.item.assignees.some(
                              (actor) => actor.login === connection?.account,
                            ),
                          })
                        }
                      >
                        {detail.item.assignees.some((actor) => actor.login === connection?.account)
                          ? "Unassign me"
                          : "Assign me"}
                      </Button>
                    ) : null}
                    <div className="ml-auto flex gap-1">
                      {detail.item.kind === "pull_request" && target ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            void runAction({
                              action: "update_branch",
                              ...target,
                              kind: "pull_request",
                            })
                          }
                        >
                          <RefreshCwIcon /> Update branch
                        </Button>
                      ) : null}
                      {target ? (
                        <Button
                          size="xs"
                          variant={detail.item.state === "open" ? "destructive-outline" : "outline"}
                          onClick={async () => {
                            const nextState = detail.item.state === "open" ? "closed" : "open";
                            const confirmed =
                              nextState === "open" ||
                              (await ensureNativeApi().dialogs.confirm(
                                `Close ${detail.item.kind === "pull_request" ? "pull request" : "issue"} #${detail.item.number}?`,
                              ));
                            if (confirmed)
                              void runAction({
                                action: "set_state",
                                ...target,
                                state: nextState,
                                closeReason:
                                  detail.item.kind === "issue" && nextState === "closed"
                                    ? "completed"
                                    : null,
                              });
                          }}
                        >
                          {detail.item.state === "open" ? "Close" : "Reopen"}
                        </Button>
                      ) : null}
                      {detail.item.kind === "pull_request" &&
                      detail.item.state === "open" &&
                      detail.headSha &&
                      target ? (
                        <Button
                          size="xs"
                          onClick={async () => {
                            const confirmed = await ensureNativeApi().dialogs.confirm(
                              `Squash and merge #${detail.item.number} at ${detail.headSha?.slice(0, 8)}?`,
                            );
                            if (confirmed)
                              void runAction({
                                action: "merge",
                                ...target,
                                kind: "pull_request",
                                method: "squash",
                                deleteBranch: true,
                                auto: false,
                                expectedHeadSha: detail.headSha!,
                              });
                          }}
                        >
                          <GitMergeIcon /> Merge
                        </Button>
                      ) : null}
                    </div>
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
                      <CodeView detail={detail} cwd={selectedProject?.cwd ?? firstProjectCwd} />
                    )}
                  </div>
                  {composerMode ? (
                    <ActionComposer
                      mode={composerMode}
                      pending={actionMutation.isPending}
                      canSubmitDecision={detail.item.author?.login !== connection?.account}
                      onCancel={() => setComposerMode(null)}
                      onSubmit={(body, verdict) => {
                        if (!target) return;
                        void runAction(
                          composerMode === "review"
                            ? {
                                action: "review",
                                ...target,
                                kind: "pull_request",
                                verdict,
                                body: body.trim(),
                              }
                            : { action: "comment", ...target, body: body.trim() },
                        );
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
            cwd: firstProjectCwd,
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
  );
}
