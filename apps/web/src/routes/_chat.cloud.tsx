import type {
  CloudContextSummary,
  CloudProjectBinding,
  CloudProjectDiscoveryResult,
  CloudResourceSummary,
  CloudSearchResourcesInput,
  CloudUpsertBindingInput,
} from "@t3tools/contracts";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useQueries,
} from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ProjectSurfaceFrame } from "~/components/ProjectSurfaceFrame";
import { RepositoryProjectFilter } from "~/components/RepositoryProjectFilter";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import {
  buildCloudAgentPrompt,
  cloudBindingScopeLabel,
  cloudContextLabel,
  cloudResourceMatchesView,
  dedupeCloudResources,
  type CloudResourceView,
} from "~/cloudWorkbench.logic";
import { useComposerDraftStore } from "~/composerDraftStore";
import { openInPreferredEditor } from "~/editorPreferences";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useLatestProjectStore } from "~/latestProjectStore";
import {
  cloudBindingsQueryOptions,
  cloudContextsQueryOptions,
  cloudDiscoveryQueryOptions,
  cloudInventoryInfiniteQueryOptions,
  cloudInventoryPageQueryOptions,
  cloudQueryKeys,
  cloudQueryLogsMutationOptions,
  cloudResourceDetailQueryOptions,
  cloudUpsertBindingMutationOptions,
} from "~/lib/cloudReactQuery";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CloudIcon,
  ExternalLinkIcon,
  FileIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "~/lib/icons";
import {
  ALL_PROJECTS_FILTER,
  parseProjectFilterSearch,
  projectFilterValue,
  resolveProjectFilter,
} from "~/lib/projectFilter";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import type { Project } from "~/types";

export const Route = createFileRoute("/_chat/cloud")({
  validateSearch: (search) => parseProjectFilterSearch(search),
  component: CloudWorkbenchRoute,
});

type DetailTab = "overview" | "logs" | "activity" | "code";
type ScopedCloudResource = {
  readonly key: string;
  readonly bindingId: CloudProjectBinding["id"];
  readonly resource: CloudResourceSummary;
};

const ALL_BINDINGS = "__all_cloud_bindings__";
const MAX_ALL_PROJECT_BINDINGS = 4;
const EMPTY_BINDINGS: readonly CloudProjectBinding[] = [];

const RESOURCE_VIEWS: ReadonlyArray<{ value: CloudResourceView; label: string }> = [
  { value: "all", label: "All resources" },
  { value: "attention", label: "Needs attention" },
  { value: "managed", label: "Managed by this repo" },
  { value: "untracked", label: "Untracked / uncertain" },
];

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Cloud request failed.";
  const setupInstruction = (error as Error & { readonly setupInstruction?: unknown })
    .setupInstruction;
  return typeof setupInstruction === "string" && setupInstruction.length > 0
    ? `${error.message} ${setupInstruction}`
    : error.message;
}

function healthTone(status: string | null): "success" | "error" | "warning" | "secondary" {
  const value = status?.toLowerCase() ?? "";
  if (value.includes("healthy") || value.includes("active") || value.includes("running")) {
    return "success";
  }
  if (value.includes("unhealthy") || value.includes("fail") || value.includes("error")) {
    return "error";
  }
  if (value.includes("degraded") || value.includes("pending") || value.includes("rollback")) {
    return "warning";
  }
  return "secondary";
}

function BlastRadiusStrip(props: {
  binding: CloudProjectBinding | null;
  context: CloudContextSummary | null;
  syncedAt: string | null;
  completeness: string | null;
}) {
  if (!props.binding || !props.context) {
    return (
      <div className="flex min-h-9 items-center border-b border-border/70 px-4 text-[11px] text-muted-foreground">
        No cloud scope is active. Choose or create an explicit repository binding.
      </div>
    );
  }
  const scope = props.context.accountId ?? props.context.projectId ?? "identity unavailable";
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 px-4 py-1.5 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground">{props.context.provider.toUpperCase()}</span>
      <span>{scope}</span>
      <span>{props.binding.environment}</span>
      <span>{props.binding.regions.join(", ")}</span>
      <span className="max-w-64 truncate" title={props.context.principalLabel ?? undefined}>
        {props.context.principalLabel ?? "principal unavailable"}
      </span>
      <span>{props.context.sourceHost}</span>
      <span className="ml-auto">
        {props.completeness ?? "unknown completeness"}
        {props.syncedAt ? ` · ${formatRelativeTime(props.syncedAt)}` : ""}
      </span>
    </div>
  );
}

function AggregateBlastRadiusStrip(props: {
  bindingCount: number;
  loadedCount: number;
  failedCount: number;
  partial: boolean;
  syncedAt: string | null;
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 px-4 py-1.5 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground">All repositories</span>
      <span>{props.bindingCount} explicit cloud bindings</span>
      <span>
        {props.loadedCount} loaded
        {props.failedCount > 0 ? ` · ${props.failedCount} failed` : ""}
      </span>
      <span className="ml-auto">
        {props.partial ? "partial" : "complete"}
        {props.syncedAt ? ` · ${formatRelativeTime(props.syncedAt)}` : ""}
      </span>
    </div>
  );
}

function BindingSetup(props: {
  project: Project | null;
  contexts: readonly CloudContextSummary[];
  discovery: CloudProjectDiscoveryResult | null;
  pending: boolean;
  onCancel?: (() => void) | undefined;
  onSave: (input: CloudUpsertBindingInput) => void;
}) {
  const authenticated = props.contexts.filter((context) => context.authState === "authenticated");
  const [contextId, setContextId] = useState("");
  const [environment, setEnvironment] = useState("");
  const [regions, setRegions] = useState("");
  const selectedContext = props.contexts.find((context) => context.id === contextId) ?? null;

  useEffect(() => {
    if (!contextId && authenticated[0]) setContextId(authenticated[0].id);
  }, [authenticated, contextId]);

  if (!props.project) {
    return (
      <div className="m-auto max-w-md p-8 text-center">
        <CloudIcon className="mx-auto size-7 text-muted-foreground" />
        <h2 className="mt-4 text-sm font-semibold">Choose one repository to bind</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Repository discovery can suggest evidence, but it never selects a cloud account, project,
          environment, or region.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-5 sm:p-8">
      <div className="rounded-xl border border-border/70 bg-background p-5">
        <div className="flex items-start gap-3">
          <CloudIcon className="mt-0.5 size-5 text-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Bind {props.project.name} to a cloud scope</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              TeaCode stores only this selector and the verified external identity. Credentials stay
              on the TeaCode server host.
            </p>
          </div>
        </div>

        {props.discovery ? (
          <div className="mt-4 rounded-lg bg-muted/40 p-3 text-xs">
            <p className="font-medium">Repository evidence</p>
            <p className="mt-1 text-muted-foreground">
              {props.discovery.evidence.length > 0
                ? `${props.discovery.tools.join(", ")} · ${props.discovery.evidence.length} safe evidence path${props.discovery.evidence.length === 1 ? "" : "s"}`
                : "No strong AWS or Google Cloud ownership signal was found. You can still bind explicitly."}
            </p>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-xs">
            <span className="font-medium">Verified server identity</span>
            <select
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={contextId}
              onChange={(event) => setContextId(event.target.value)}
            >
              <option value="">Choose an authenticated context</option>
              {props.contexts.map((context) => (
                <option
                  key={context.id}
                  value={context.id}
                  disabled={context.authState !== "authenticated"}
                >
                  {context.label} · {context.authState}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs">
            <span className="font-medium">Environment label</span>
            <Input
              size="sm"
              value={environment}
              placeholder="Production, Staging, Preview…"
              onChange={(event) => setEnvironment(event.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              This is explicit user metadata. TeaCode never infers production from a name.
            </span>
          </label>
          <label className="grid gap-1.5 text-xs">
            <span className="font-medium">Allowed regions or locations</span>
            <Input
              size="sm"
              value={regions}
              placeholder={
                selectedContext?.provider === "gcp" ? "us-central1, global" : "us-east-1"
              }
              onChange={(event) => setRegions(event.target.value)}
            />
          </label>
        </div>

        {props.contexts.some((context) => context.authState !== "authenticated") ? (
          <div className="mt-4 space-y-2">
            {props.contexts
              .filter((context) => context.authState !== "authenticated")
              .map((context) => (
                <div key={context.id} className="rounded-lg border border-warning/30 p-3 text-xs">
                  <p className="font-medium">{context.label}</p>
                  <p className="mt-1 text-muted-foreground">
                    {context.setupInstruction ??
                      context.warnings[0] ??
                      "Authentication is unavailable."}
                  </p>
                </div>
              ))}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          {props.onCancel ? (
            <Button size="sm" variant="ghost" onClick={props.onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={props.pending || !selectedContext || !environment.trim() || !regions.trim()}
            onClick={() =>
              props.onSave({
                id: null,
                projectId: props.project!.id,
                contextId: selectedContext!.id,
                environment: environment.trim(),
                regions: regions
                  .split(",")
                  .map((region) => region.trim())
                  .filter(Boolean),
              })
            }
          >
            {props.pending ? "Verifying…" : "Verify and bind"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResourceRow(props: {
  resource: CloudResourceSummary;
  scopeLabel?: string | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left outline-none transition-[background-color,scale] duration-press ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:active:scale-100",
        props.selected ? "bg-selected" : "hover:bg-hover",
      )}
    >
      <span
        className={cn(
          "mt-1 size-2 shrink-0 rounded-full",
          healthTone(props.resource.state) === "success" && "bg-success",
          healthTone(props.resource.state) === "error" && "bg-destructive",
          healthTone(props.resource.state) === "warning" && "bg-warning",
          healthTone(props.resource.state) === "secondary" && "bg-muted-foreground/35",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {props.resource.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {props.resource.type} · {props.resource.location ?? "global"}
          {props.scopeLabel ? ` · ${props.scopeLabel}` : ""}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{props.resource.state ?? "state unknown"}</span>
          <span>·</span>
          <span>{props.resource.ownership.confidence}</span>
        </span>
      </span>
    </button>
  );
}

function CloudWorkbenchRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { handleNewThread } = useHandleNewThread();
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);
  const projectsHydrated = useStore((state) => state.threadsHydrated);
  const projects = useStore((state) => state.projects);
  const attachedProjects = useMemo(
    () => projects.filter((project) => project.kind === "project"),
    [projects],
  );
  const selectedProjectFilter = resolveProjectFilter({
    projects: attachedProjects,
    searchProject: search.project,
    latestProjectId,
  });
  const canonicalProjectFilter = projectFilterValue(selectedProjectFilter);

  useEffect(() => {
    if (!projectsHydrated || search.project === canonicalProjectFilter) return;
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, project: canonicalProjectFilter }),
    });
  }, [canonicalProjectFilter, navigate, projectsHydrated, search.project]);

  const contextsQuery = useQuery(cloudContextsQueryOptions());
  const bindingsQuery = useQuery(
    cloudBindingsQueryOptions({ projectId: selectedProjectFilter?.id ?? null }),
  );
  const discoveryQuery = useQuery(cloudDiscoveryQueryOptions(selectedProjectFilter?.id ?? null));
  const upsertBindingMutation = useMutation(cloudUpsertBindingMutationOptions(queryClient));
  const logsMutation = useMutation(cloudQueryLogsMutationOptions());
  const resetLogsMutation = logsMutation.reset;

  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [selectedResourceKey, setSelectedResourceKey] = useState<string | null>(null);
  const [resourceView, setResourceView] = useState<CloudResourceView>("all");
  const [resourceQuery, setResourceQuery] = useState("");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [showBindingSetup, setShowBindingSetup] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [logRangeMinutes, setLogRangeMinutes] = useState(15);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
  const [debouncedResourceQuery] = useDebouncedValue(resourceQuery, { wait: 300 });

  const bindings = bindingsQuery.data?.bindings ?? EMPTY_BINDINGS;
  const isAllProjects = selectedProjectFilter === null;
  useEffect(() => {
    if (bindings.length === 0) {
      setSelectedBindingId(null);
      setShowBindingSetup(true);
      return;
    }
    const bindingStillExists = bindings.some((binding) => binding.id === selectedBindingId);
    if (!selectedBindingId || (!bindingStillExists && selectedBindingId !== ALL_BINDINGS)) {
      setSelectedBindingId(isAllProjects ? ALL_BINDINGS : bindings[0]!.id);
    } else if (!isAllProjects && selectedBindingId === ALL_BINDINGS) {
      setSelectedBindingId(bindings[0]!.id);
    }
  }, [bindings, isAllProjects, selectedBindingId]);
  const isAggregateInventory = isAllProjects && selectedBindingId === ALL_BINDINGS;
  const selectedBinding = bindings.find((binding) => binding.id === selectedBindingId) ?? null;
  const selectedContext = selectedBinding
    ? (contextsQuery.data?.contexts.find((context) => context.id === selectedBinding.contextId) ??
      null)
    : null;

  const inventoryInput = selectedBinding
    ? {
        bindingId: selectedBinding.id,
        query: debouncedResourceQuery.trim() || null,
        types: [],
        states: [],
        ownership: [],
        limit: 75,
      }
    : null;
  const inventoryQuery = useInfiniteQuery(cloudInventoryInfiniteQueryOptions(inventoryInput));
  const aggregateInventoryInputs = useMemo<Array<Omit<CloudSearchResourcesInput, "cursor">>>(
    () =>
      isAggregateInventory
        ? bindings.slice(0, MAX_ALL_PROJECT_BINDINGS).map((binding) => ({
            bindingId: binding.id,
            query: debouncedResourceQuery.trim() || null,
            types: [],
            states: [],
            ownership: [],
            limit: 50,
          }))
        : [],
    [bindings, debouncedResourceQuery, isAggregateInventory],
  );
  const aggregateInventoryQueries = useQueries({
    queries: aggregateInventoryInputs.map(cloudInventoryPageQueryOptions),
  });
  const resources = useMemo<ScopedCloudResource[]>(() => {
    if (isAggregateInventory) {
      return aggregateInventoryQueries.flatMap((query, index) => {
        const binding = bindings[index];
        if (!binding || !query.data) return [];
        return query.data.resources
          .filter((resource) => cloudResourceMatchesView(resource, resourceView))
          .map((resource) => ({
            key: `${binding.id}:${resource.id}`,
            bindingId: binding.id,
            resource,
          }));
      });
    }
    if (!selectedBinding) return [];
    return dedupeCloudResources(inventoryQuery.data?.pages.map((page) => page.resources) ?? [])
      .filter((resource) => cloudResourceMatchesView(resource, resourceView))
      .map((resource) => ({
        key: `${selectedBinding.id}:${resource.id}`,
        bindingId: selectedBinding.id,
        resource,
      }));
  }, [
    aggregateInventoryQueries,
    bindings,
    inventoryQuery.data?.pages,
    isAggregateInventory,
    resourceView,
    selectedBinding,
  ]);

  useEffect(() => {
    setSelectedResourceKey(null);
    setDetailTab("overview");
    setSelectedLogIds(new Set());
  }, [selectedBindingId]);

  useEffect(() => {
    if (
      selectedResourceKey &&
      !resources.some((resource) => resource.key === selectedResourceKey)
    ) {
      setSelectedResourceKey(null);
    }
  }, [resources, selectedResourceKey]);

  const selectedResource =
    resources.find((resource) => resource.key === selectedResourceKey) ?? null;
  const selectedResourceBinding = selectedResource
    ? (bindings.find((binding) => binding.id === selectedResource.bindingId) ?? null)
    : null;
  const activeBinding = selectedBinding ?? selectedResourceBinding;
  const selectedBindingProject = activeBinding
    ? (attachedProjects.find((project) => project.id === activeBinding.projectId) ?? null)
    : selectedProjectFilter;
  const detailQuery = useQuery(
    cloudResourceDetailQueryOptions(
      selectedResource
        ? { bindingId: selectedResource.bindingId, resourceId: selectedResource.resource.id }
        : null,
    ),
  );
  const detail = detailQuery.data ?? null;
  const latestInventoryPage = inventoryQuery.data?.pages.at(-1) ?? null;
  const activeContext =
    detail?.context ??
    latestInventoryPage?.context ??
    selectedContext ??
    (activeBinding
      ? (contextsQuery.data?.contexts.find((context) => context.id === activeBinding.contextId) ??
        null)
      : null);
  const aggregateFailures = aggregateInventoryQueries.filter((query) => query.isError).length;
  const aggregatePages = aggregateInventoryQueries.flatMap((query) =>
    query.data ? [query.data] : [],
  );
  const aggregateIsPartial =
    bindings.length > MAX_ALL_PROJECT_BINDINGS ||
    aggregateFailures > 0 ||
    aggregatePages.some((page) => page.completeness !== "complete" || page.nextCursor !== null);
  const aggregateSyncedAt =
    aggregatePages
      .map((page) => page.syncedAt)
      .toSorted()
      .at(-1) ?? null;
  const inventoryIsPending = isAggregateInventory
    ? aggregateInventoryQueries.some((query) => query.isPending)
    : inventoryQuery.isPending;
  const bindingScopeLabels = useMemo(
    () =>
      new Map(
        bindings.map((binding) => {
          const project = attachedProjects.find((candidate) => candidate.id === binding.projectId);
          return [binding.id, `${project?.name ?? "Repository"} / ${binding.environment}`] as const;
        }),
      ),
    [attachedProjects, bindings],
  );

  const selectBinding = (bindingId: string) => {
    setSelectedBindingId(bindingId);
    setSelectedResourceKey(null);
    setSelectedLogIds(new Set());
    resetLogsMutation();
  };

  const updateProjectFilter = async (value: string) => {
    await queryClient.cancelQueries({ queryKey: cloudQueryKeys.all });
    if (value !== ALL_PROJECTS_FILTER) {
      const nextProject = attachedProjects.find((project) => project.id === value);
      if (!nextProject) return;
      useLatestProjectStore.getState().setLatestProjectId(nextProject.id);
    }
    setSelectedBindingId(null);
    setSelectedResourceKey(null);
    setShowBindingSetup(false);
    setResourceQuery("");
    setSelectedLogIds(new Set());
    resetLogsMutation();
    void navigate({ search: (previous) => ({ ...previous, project: value }) });
  };

  const saveBinding = async (input: CloudUpsertBindingInput) => {
    try {
      const binding = await upsertBindingMutation.mutateAsync(input);
      resetLogsMutation();
      setSelectedBindingId(binding.id);
      setShowBindingSetup(false);
      toastManager.add({ type: "success", title: "Cloud scope verified and bound", timeout: 3500 });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Cloud binding failed",
        description: errorMessage(error),
        timeout: 6000,
      });
    }
  };

  const queryLogs = async () => {
    if (!activeBinding || !selectedResource) return;
    const end = new Date();
    const start = new Date(end.valueOf() - logRangeMinutes * 60_000);
    try {
      const result = await logsMutation.mutateAsync({
        bindingId: activeBinding.id,
        resourceId: selectedResource.resource.id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        query: logQuery.trim() || null,
        limit: 200,
      });
      setSelectedLogIds(new Set());
      if (result.warnings[0]) {
        toastManager.add({
          type: "warning",
          title: "Cloud logs are partial",
          description: result.warnings[0],
          timeout: 5000,
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Cloud log query failed",
        description: errorMessage(error),
        timeout: 6000,
      });
    }
  };

  const startInvestigation = async () => {
    if (!detail || !selectedBindingProject) return;
    try {
      const threadId = await handleNewThread(selectedBindingProject.id, { fresh: true });
      const selectedLogs = (logsMutation.data?.entries ?? []).filter((entry) =>
        selectedLogIds.has(entry.id),
      );
      useComposerDraftStore.getState().setPrompt(
        threadId,
        buildCloudAgentPrompt({
          detail,
          logs: selectedLogs,
          repositoryPath: selectedBindingProject.cwd,
        }),
      );
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to start cloud investigation",
        description: errorMessage(error),
        timeout: 6000,
      });
    }
  };

  const openEvidencePath = async (evidencePath: string) => {
    if (!selectedBindingProject) return;
    const target = `${selectedBindingProject.cwd.replace(/[\\/]$/, "")}/${evidencePath}`;
    try {
      await openInPreferredEditor(ensureNativeApi(), target);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to open infrastructure source",
        description: errorMessage(error),
        timeout: 5000,
      });
    }
  };

  const loadError =
    contextsQuery.error ?? bindingsQuery.error ?? inventoryQuery.error ?? detailQuery.error ?? null;
  const bindingSetupVisible =
    showBindingSetup || (!bindingsQuery.isPending && bindings.length === 0);

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
            <CloudIcon className="size-4 text-foreground" />
            <span className="text-[14px] font-[590] tracking-[-0.005em]">Cloud</span>
            <RepositoryProjectFilter
              ariaLabel="Cloud repository"
              projects={attachedProjects}
              selectedProject={selectedProjectFilter}
              onValueChange={(value) => void updateProjectFilter(value)}
            />
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Refresh Cloud"
                onClick={() => void queryClient.invalidateQueries({ queryKey: cloudQueryKeys.all })}
              >
                <RefreshCwIcon />
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!selectedProjectFilter}
                onClick={() => setShowBindingSetup(true)}
              >
                Add environment
              </Button>
            </div>
          </header>

          {isAggregateInventory && !activeBinding ? (
            <AggregateBlastRadiusStrip
              bindingCount={bindings.length}
              loadedCount={aggregatePages.length}
              failedCount={aggregateFailures}
              partial={aggregateIsPartial}
              syncedAt={aggregateSyncedAt}
            />
          ) : (
            <BlastRadiusStrip
              binding={activeBinding}
              context={activeContext}
              syncedAt={latestInventoryPage?.syncedAt ?? detail?.syncedAt ?? null}
              completeness={latestInventoryPage?.completeness ?? detail?.completeness ?? null}
            />
          )}

          {loadError ? (
            <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
              {errorMessage(loadError)}
            </div>
          ) : null}

          {isAggregateInventory &&
          aggregateIsPartial &&
          (aggregatePages.length > 0 || aggregateFailures > 0) ? (
            <div className="mx-4 mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
              All-repository inventory is intentionally bounded to {MAX_ALL_PROJECT_BINDINGS}{" "}
              bindings and one page per binding. Failed or paginated providers remain visible as
              partial data.
              {aggregateFailures > 0
                ? ` ${errorMessage(aggregateInventoryQueries.find((query) => query.isError)?.error)}`
                : ""}
            </div>
          ) : null}

          {bindingSetupVisible ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <BindingSetup
                project={selectedProjectFilter}
                contexts={contextsQuery.data?.contexts ?? []}
                discovery={discoveryQuery.data ?? null}
                pending={upsertBindingMutation.isPending}
                onCancel={bindings.length > 0 ? () => setShowBindingSetup(false) : undefined}
                onSave={(input) => void saveBinding(input)}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border/70 lg:flex">
                <div className="border-b border-border/70 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Environments
                  </p>
                  <div className="space-y-0.5">
                    {isAllProjects ? (
                      <button
                        type="button"
                        onClick={() => selectBinding(ALL_BINDINGS)}
                        className={cn(
                          "w-full rounded-lg px-2.5 py-2 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
                          selectedBindingId === ALL_BINDINGS && "bg-selected text-foreground",
                        )}
                      >
                        <span className="block font-medium">All environments</span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          Bounded read-only inventory
                        </span>
                      </button>
                    ) : null}
                    {bindings.map((binding) => (
                      <button
                        key={binding.id}
                        type="button"
                        onClick={() => selectBinding(binding.id)}
                        className={cn(
                          "w-full rounded-lg px-2.5 py-2 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
                          binding.id === selectedBindingId && "bg-selected text-foreground",
                        )}
                      >
                        <span className="block font-medium">{binding.environment}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {binding.expectedAccountId ?? binding.expectedProjectId}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Views
                  </p>
                  <div className="space-y-0.5">
                    {RESOURCE_VIEWS.map((view) => (
                      <button
                        key={view.value}
                        type="button"
                        onClick={() => setResourceView(view.value)}
                        className={cn(
                          "w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-hover",
                          resourceView === view.value && "bg-selected text-foreground",
                        )}
                      >
                        {view.label}
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              <aside
                className={cn(
                  "w-[340px] min-w-[280px] max-w-[42%] shrink-0 flex-col border-r border-border/70 max-md:w-full max-md:max-w-full",
                  selectedResource ? "hidden md:flex" : "flex",
                )}
              >
                <div className="border-b border-border/70 p-3">
                  {bindings.length > 1 ? (
                    <select
                      aria-label="Cloud environment"
                      className="mb-2 h-8 w-full rounded-lg border border-border bg-background px-2 text-xs lg:hidden"
                      value={selectedBindingId ?? ""}
                      onChange={(event) => selectBinding(event.target.value)}
                    >
                      {isAllProjects ? (
                        <option value={ALL_BINDINGS}>All environments</option>
                      ) : null}
                      {bindings.map((binding) => (
                        <option key={binding.id} value={binding.id}>
                          {binding.environment} ·{" "}
                          {binding.expectedAccountId ?? binding.expectedProjectId}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <Input
                    size="sm"
                    type="search"
                    value={resourceQuery}
                    placeholder="Search name, tag, ARN…"
                    onChange={(event) => setResourceQuery(event.target.value)}
                  />
                  <div className="mt-2 flex gap-1 overflow-x-auto lg:hidden">
                    {RESOURCE_VIEWS.map((view) => (
                      <button
                        key={view.value}
                        type="button"
                        className={cn(
                          "shrink-0 rounded-lg px-2 py-1 text-[11px]",
                          resourceView === view.value ? "bg-selected" : "text-muted-foreground",
                        )}
                        onClick={() => setResourceView(view.value)}
                      >
                        {view.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {inventoryIsPending ? (
                    <div className="flex h-32 items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Spinner className="size-4" /> Loading cloud inventory…
                    </div>
                  ) : resources.length === 0 ? (
                    <div className="p-5 text-center text-xs text-muted-foreground">
                      No matching resources. Inventory may be empty, incomplete, or unavailable in
                      the allowed regions.
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {resources.map((resource) => (
                        <ResourceRow
                          key={resource.key}
                          resource={resource.resource}
                          scopeLabel={
                            isAggregateInventory
                              ? bindingScopeLabels.get(resource.bindingId)
                              : undefined
                          }
                          selected={resource.key === selectedResourceKey}
                          onSelect={() => {
                            setSelectedResourceKey(resource.key);
                            setDetailTab("overview");
                            setSelectedLogIds(new Set());
                            resetLogsMutation();
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {!isAggregateInventory && inventoryQuery.hasNextPage ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="mt-2 w-full"
                      disabled={inventoryQuery.isFetchingNextPage}
                      onClick={() => void inventoryQuery.fetchNextPage()}
                    >
                      {inventoryQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                    </Button>
                  ) : null}
                </div>
              </aside>

              <main
                className={cn(
                  "min-w-0 flex-1 flex-col overflow-hidden",
                  selectedResource ? "flex" : "hidden md:flex",
                )}
              >
                {!selectedResource ? (
                  <div className="m-auto max-w-sm p-8 text-center text-xs text-muted-foreground">
                    <SearchIcon className="mx-auto size-6 opacity-50" />
                    <p className="mt-3">
                      Select a resource to inspect health, logs, activity, and source evidence.
                    </p>
                  </div>
                ) : detailQuery.isPending ? (
                  <div className="m-auto flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="size-4" /> Loading resource detail…
                  </div>
                ) : detail ? (
                  <>
                    <div className="border-b border-border/70 px-4 py-3 sm:px-5">
                      <div className="flex items-start gap-3">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="md:hidden"
                          aria-label="Back to cloud resources"
                          onClick={() => setSelectedResourceKey(null)}
                        >
                          <ArrowLeftIcon />
                        </Button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h1 className="truncate text-base font-semibold">
                              {detail.resource.name}
                            </h1>
                            <Badge variant={healthTone(detail.health.status)} size="sm">
                              {detail.health.status}
                            </Badge>
                            <Badge variant="outline" size="sm">
                              {detail.resource.ownership.confidence}
                            </Badge>
                          </div>
                          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                            {detail.resource.externalId}
                          </p>
                        </div>
                        <Button size="sm" onClick={() => void startInvestigation()}>
                          <SparklesIcon /> Investigate in thread
                        </Button>
                      </div>
                      <div className="mt-3 flex gap-1">
                        {(["overview", "logs", "activity", "code"] as const).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setDetailTab(tab)}
                            className={cn(
                              "rounded-lg px-2.5 py-1.5 text-[11px] capitalize",
                              detailTab === tab
                                ? "bg-selected text-foreground"
                                : "text-muted-foreground hover:bg-hover",
                            )}
                          >
                            {tab}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                      {detail.warnings.length > 0 ? (
                        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
                          <div className="flex items-start gap-2">
                            <TriangleAlertIcon className="mt-0.5 size-4 text-warning" />
                            <div>{detail.warnings.join(" ")}</div>
                          </div>
                        </div>
                      ) : null}

                      {detailTab === "overview" ? (
                        <div className="space-y-4">
                          <div
                            className={cn(
                              "rounded-xl border p-4",
                              detail.health.status === "unhealthy"
                                ? "border-destructive/30 bg-destructive/5"
                                : "border-border/70",
                            )}
                          >
                            <div className="flex items-start gap-3">
                              {detail.health.status === "healthy" ? (
                                <CheckCircle2Icon className="mt-0.5 size-5 text-success" />
                              ) : (
                                <CircleAlertIcon className="mt-0.5 size-5 text-warning" />
                              )}
                              <div>
                                <h2 className="text-sm font-semibold">{detail.health.summary}</h2>
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Observed {formatRelativeTime(detail.health.observedAt)}
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-border/70 p-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                                Identity
                              </p>
                              <p className="mt-2 text-xs">{cloudContextLabel(detail.context)}</p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {cloudBindingScopeLabel(detail.binding)}
                              </p>
                            </div>
                            <div className="rounded-xl border border-border/70 p-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                                Owner evidence
                              </p>
                              <p className="mt-2 text-xs capitalize">
                                {detail.resource.ownership.confidence}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {detail.resource.ownership.evidence[0]?.reason ??
                                  "No defensible source ownership link was found."}
                              </p>
                            </div>
                          </div>
                          {Object.keys(detail.health.facts).length > 0 ? (
                            <div className="rounded-xl border border-border/70 p-4">
                              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                                Allowlisted live facts
                              </p>
                              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                                {Object.entries(detail.health.facts).map(([key, value]) => (
                                  <div
                                    key={key}
                                    className="flex justify-between gap-4 border-b border-border/50 pb-2"
                                  >
                                    <dt className="text-muted-foreground">{key}</dt>
                                    <dd className="truncate text-right">{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            {detail.resource.consoleUrl ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  void ensureNativeApi().shell.openExternal(
                                    detail.resource.consoleUrl!,
                                  )
                                }
                              >
                                <ExternalLinkIcon /> Open {detail.resource.provider.toUpperCase()}
                              </Button>
                            ) : null}
                            {detail.resource.ownership.evidence.find((row) => row.path)?.path ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  void openEvidencePath(
                                    detail.resource.ownership.evidence.find((row) => row.path)!
                                      .path!,
                                  )
                                }
                              >
                                <FileIcon /> Open infrastructure source
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {detailTab === "logs" ? (
                        <div className="space-y-3">
                          <div className="rounded-xl border border-border/70 p-4">
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="grid min-w-48 flex-1 gap-1 text-[11px]">
                                <span className="font-medium">Literal message search</span>
                                <Input
                                  size="sm"
                                  value={logQuery}
                                  placeholder="Optional error text"
                                  onChange={(event) => setLogQuery(event.target.value)}
                                />
                              </label>
                              <label className="grid gap-1 text-[11px]">
                                <span className="font-medium">Time range</span>
                                <select
                                  className="h-7 rounded-lg border border-border bg-background px-2 text-xs"
                                  value={logRangeMinutes}
                                  onChange={(event) =>
                                    setLogRangeMinutes(Number(event.target.value))
                                  }
                                >
                                  <option value={15}>15 minutes</option>
                                  <option value={60}>1 hour</option>
                                  <option value={360}>6 hours</option>
                                  <option value={1440}>24 hours</option>
                                </select>
                              </label>
                              <Button
                                size="sm"
                                disabled={logsMutation.isPending}
                                onClick={() => void queryLogs()}
                              >
                                {logsMutation.isPending ? (
                                  <Spinner className="size-3" />
                                ) : (
                                  <SearchIcon />
                                )}
                                Query logs
                              </Button>
                            </div>
                            <p className="mt-2 text-[10px] text-muted-foreground">
                              Queries are resource-scoped, capped at 200 rows, and may incur
                              provider cost. Widening is always visible.
                            </p>
                          </div>
                          {logsMutation.data?.entries.length === 0 ? (
                            <div className="rounded-xl border border-border/70 p-5 text-center text-xs text-muted-foreground">
                              No matching log entries, or this resource type does not yet expose
                              bounded logs.
                            </div>
                          ) : null}
                          {(logsMutation.data?.entries ?? []).map((entry) => (
                            <label
                              key={entry.id}
                              className="flex gap-3 rounded-xl border border-border/70 p-3 text-xs"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={selectedLogIds.has(entry.id)}
                                onChange={(event) => {
                                  setSelectedLogIds((previous) => {
                                    const next = new Set(previous);
                                    if (event.target.checked) next.add(entry.id);
                                    else next.delete(entry.id);
                                    return next;
                                  });
                                }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex gap-2 text-[10px] text-muted-foreground">
                                  <span>{entry.severity ?? "DEFAULT"}</span>
                                  <span>{entry.source}</span>
                                  <span className="ml-auto">
                                    {formatRelativeTime(entry.timestamp)}
                                  </span>
                                </span>
                                <span className="mt-1 block whitespace-pre-wrap break-words font-mono text-[11px]">
                                  {entry.message}
                                </span>
                              </span>
                            </label>
                          ))}
                          {logsMutation.data?.entries.length ? (
                            <p className="text-[10px] text-muted-foreground">
                              Select only the log rows you want quoted in the investigation thread.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {detailTab === "activity" ? (
                        detail.activity.length > 0 ? (
                          <div className="space-y-2">
                            {detail.activity.map((activity) => (
                              <div
                                key={activity.id}
                                className="rounded-xl border border-border/70 p-3 text-xs"
                              >
                                <p className="font-medium">{activity.summary}</p>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {activity.kind} · {formatRelativeTime(activity.occurredAt)}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-border/70 p-5 text-center text-xs text-muted-foreground">
                            No allowlisted deployment or provider activity is available for this
                            resource.
                          </div>
                        )
                      ) : null}

                      {detailTab === "code" ? (
                        <div className="space-y-2">
                          {detail.resource.ownership.evidence.length > 0 ? (
                            detail.resource.ownership.evidence.map((evidence) => (
                              <div
                                key={`${evidence.source}:${evidence.path ?? "provider"}:${evidence.reason}`}
                                className="rounded-xl border border-border/70 p-4"
                              >
                                <div className="flex items-start gap-3">
                                  <FileIcon className="mt-0.5 size-4 text-muted-foreground" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-mono text-xs">
                                      {evidence.path ?? `${evidence.source} evidence`}
                                    </p>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      {evidence.reason}
                                    </p>
                                  </div>
                                  {evidence.path ? (
                                    <Button
                                      size="icon-xs"
                                      variant="ghost"
                                      aria-label="Open infrastructure source"
                                      onClick={() => void openEvidencePath(evidence.path!)}
                                    >
                                      <ArrowUpRightIcon />
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-xl border border-border/70 p-5 text-center text-xs text-muted-foreground">
                              This resource is visible but untracked. Investigate it without
                              assuming repository ownership.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="m-auto max-w-sm p-8 text-center text-xs text-muted-foreground">
                    Resource detail could not be loaded.
                  </div>
                )}
              </main>
            </div>
          )}
        </div>
      </RouteInsetSurface>
    </ProjectSurfaceFrame>
  );
}
