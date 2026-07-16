import type {
  ComputerScriptCandidate,
  ComputerScriptCandidateId,
  ComputerScriptDescriptor,
  ComputerScriptId,
  ComputerScriptsAnalysisSnapshot,
  ComputerScriptsRunSnapshot,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import {
  analysisForUtility,
  applyComputerScriptsEvent,
  emptyComputerScriptsViewState,
  runForUtility,
} from "~/computerScriptsState";
import {
  CheckCircle2Icon,
  HammerIcon,
  PlayIcon,
  RefreshCwIcon,
  StopIcon,
  Trash2,
  TriangleAlertIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

export const Route = createFileRoute("/_chat/computer-scripts")({
  component: ComputerScriptsRoute,
});

const DEFAULT_OPTIONS = {
  roots: [] as string[],
  minAgeDays: 30,
  minBytes: 100 * 1024 * 1024,
  includeProtected: false,
};
const EMPTY_UTILITIES: readonly ComputerScriptDescriptor[] = [];
const EMPTY_CANDIDATES: ReadonlySet<ComputerScriptCandidateId> = new Set();

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function utilityTone(utility: ComputerScriptDescriptor): string {
  if (utility.risk === "low") return "Low risk";
  if (utility.risk === "redownload") return "Re-download";
  return "Disruptive";
}

function terminalState(
  snapshot: ComputerScriptsAnalysisSnapshot | ComputerScriptsRunSnapshot | null,
) {
  if (!snapshot) return false;
  return ["completed", "partial", "failed", "cancelled", "interrupted", "review"].includes(
    snapshot.state,
  );
}

function CandidateRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: ComputerScriptCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-background/50 p-3 text-left",
        candidate.protectedReason && "opacity-70",
      )}
    >
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={Boolean(candidate.protectedReason)}
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{candidate.label}</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatBytes(candidate.bytes)}
          </span>
        </span>
        {candidate.path ? (
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {candidate.path}
          </span>
        ) : null}
        {candidate.protectedReason ? (
          <span className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <TriangleAlertIcon className="size-3.5" />
            {candidate.protectedReason}
          </span>
        ) : null}
        <span className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(candidate.metadata)
            .slice(0, 4)
            .map(([key, value]) => (
              <span
                key={key}
                className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {key}: {value}
              </span>
            ))}
        </span>
      </span>
    </label>
  );
}

function ComputerScriptsRoute() {
  const queryClient = useQueryClient();
  const [selectedUtilityId, setSelectedUtilityId] = useState<ComputerScriptId | null>(null);
  const [viewState, setViewState] = useState(emptyComputerScriptsViewState);
  const [selectedCandidatesByAnalysis, setSelectedCandidatesByAnalysis] = useState<
    ReadonlyMap<ComputerScriptsAnalysisSnapshot["id"], ReadonlySet<ComputerScriptCandidateId>>
  >(new Map());
  const [rootInput, setRootInput] = useState("");

  const catalogQuery = useQuery({
    queryKey: ["computerScripts", "catalog"],
    queryFn: () => ensureNativeApi().computerScripts.catalog(),
  });
  const historyQuery = useQuery({
    queryKey: ["computerScripts", "history"],
    queryFn: () => ensureNativeApi().computerScripts.listHistory({ limit: 10 }),
  });

  const utilities = catalogQuery.data?.utilities ?? EMPTY_UTILITIES;
  const selectedUtility =
    utilities.find((utility) => utility.id === selectedUtilityId) ?? utilities[0] ?? null;
  const analysis = analysisForUtility(viewState, selectedUtility?.id);
  const run = runForUtility(viewState, selectedUtility?.id);
  const selectedCandidates = analysis
    ? (selectedCandidatesByAnalysis.get(analysis.id) ?? EMPTY_CANDIDATES)
    : EMPTY_CANDIDATES;

  useEffect(() => {
    if (!selectedUtilityId && utilities[0]) setSelectedUtilityId(utilities[0].id);
  }, [selectedUtilityId, utilities]);

  useEffect(() => {
    const api = ensureNativeApi();
    return api.computerScripts.onEvent((event) => {
      setViewState((current) => applyComputerScriptsEvent(current, event));
      if (event.type === "analysis") {
        if (event.snapshot.state === "review") {
          setSelectedCandidatesByAnalysis((current) => {
            if (current.has(event.snapshot.id)) return current;
            const next = new Map(current);
            next.set(
              event.snapshot.id,
              new Set<ComputerScriptCandidateId>(
                event.snapshot.candidates
                  .filter((candidate) => candidate.selectedByDefault && !candidate.protectedReason)
                  .map((candidate) => candidate.id),
              ),
            );
            return next;
          });
        }
      } else {
        if (terminalState(event.snapshot)) {
          void queryClient.invalidateQueries({ queryKey: ["computerScripts", "history"] });
        }
      }
    });
  }, [queryClient]);

  const startAnalysis = useMutation({
    mutationFn: async () => {
      if (!selectedUtility) throw new Error("Select a utility first.");
      const roots = rootInput
        .split("\n")
        .map((root) => root.trim())
        .filter(Boolean);
      return ensureNativeApi().computerScripts.startAnalysis({
        utilityId: selectedUtility.id,
        options: { ...DEFAULT_OPTIONS, roots },
      });
    },
    onSuccess: (result) => {
      setViewState((current) =>
        applyComputerScriptsEvent(current, { type: "analysis", snapshot: result.snapshot }),
      );
      setSelectedCandidatesByAnalysis((current) => {
        if (current.has(result.snapshot.id)) return current;
        const next = new Map(current);
        next.set(result.snapshot.id, new Set<ComputerScriptCandidateId>());
        return next;
      });
    },
  });

  const startRun = useMutation({
    mutationFn: async () => {
      if (!analysis || !selectedUtility) throw new Error("Analyze before running.");
      return ensureNativeApi().computerScripts.startRun({
        analysisId: analysis.id,
        utilityId: selectedUtility.id,
        candidateIds: [...selectedCandidates],
      });
    },
    onSuccess: (result) =>
      setViewState((current) =>
        applyComputerScriptsEvent(current, { type: "run", snapshot: result.snapshot }),
      ),
  });

  const selectedBytes = useMemo(
    () =>
      (analysis?.candidates ?? [])
        .filter((candidate) => selectedCandidates.has(candidate.id))
        .reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0),
    [analysis, selectedCandidates],
  );

  const lastRunByUtility = new Map(
    (historyQuery.data?.runs ?? []).map((entry) => [entry.utilityId, entry] as const),
  );

  return (
    <RouteInsetSurface>
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        <header
          className={cn(
            "flex shrink-0 items-center gap-3",
            CHAT_SURFACE_HEADER_HEIGHT_CLASS,
            CHAT_SURFACE_HEADER_PADDING_X_CLASS,
            CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
          )}
        >
          <SidebarHeaderNavigationControls />
          <div className="flex min-w-0 items-center gap-2">
            <HammerIcon className="size-4 text-muted-foreground" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Computer Scripts</h1>
              <p className="truncate text-xs text-muted-foreground">
                Analyze, review exact impact, run, receive a durable result
              </p>
            </div>
          </div>
          <Button
            className="ml-auto"
            size="sm"
            onClick={() => startAnalysis.mutate()}
            disabled={
              !selectedUtility || startAnalysis.isPending || analysis?.state === "analyzing"
            }
          >
            {analysis?.state === "analyzing" ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            Analyze computer
          </Button>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-border/70 p-3 md:border-r md:border-b-0">
            <div className="space-y-2">
              {utilities.map((utility) => {
                const lastRun = lastRunByUtility.get(utility.id);
                const selected = selectedUtility?.id === utility.id;
                return (
                  <button
                    key={utility.id}
                    type="button"
                    onClick={() => setSelectedUtilityId(utility.id)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors",
                      selected
                        ? "border-primary/40 bg-primary/8"
                        : "border-border/70 bg-background/50 hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{utility.title}</span>
                      <span className="ml-auto rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {utilityTone(utility)}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {utility.summary}
                    </span>
                    {lastRun ? (
                      <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2Icon className="size-3.5" />
                        Last reclaimed {formatBytes(lastRun.reclaimedBytes)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-h-0 overflow-auto p-4">
            {selectedUtility ? (
              <div className="mx-auto flex max-w-5xl flex-col gap-4">
                <div className="rounded-lg border border-border/70 bg-background/60 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg border border-border/70 bg-muted/40 p-2">
                      <Trash2 className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold">{selectedUtility.title}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedUtility.consequence}
                      </p>
                      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                        <Input
                          value={rootInput}
                          onChange={(event) => setRootInput(event.target.value)}
                          placeholder="Optional scan root path, one per line"
                        />
                        <Button
                          variant="outline"
                          onClick={() => startAnalysis.mutate()}
                          disabled={startAnalysis.isPending || analysis?.state === "analyzing"}
                        >
                          <RefreshCwIcon className="size-3.5" />
                          Analyze
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {analysis ? (
                  <div className="rounded-lg border border-border/70 bg-background/60 p-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">
                        {analysis.state === "analyzing" ? "Analyzing" : "Review impact"}
                      </h3>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatBytes(analysis.estimatedBytes)} found
                      </span>
                    </div>
                    {analysis.state === "analyzing" ? (
                      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="size-4" />
                        {analysis.progress.label ?? "Scanning selected roots"}
                      </div>
                    ) : null}
                    {analysis.error ? (
                      <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive">
                        {analysis.error}
                      </div>
                    ) : null}
                    <div className="mt-4 space-y-2">
                      {analysis.candidates.map((candidate) => (
                        <CandidateRow
                          key={candidate.id}
                          candidate={candidate}
                          checked={selectedCandidates.has(candidate.id)}
                          onToggle={() => {
                            setSelectedCandidatesByAnalysis((current) => {
                              const nextCandidates = new Set(current.get(analysis.id) ?? []);
                              if (nextCandidates.has(candidate.id))
                                nextCandidates.delete(candidate.id);
                              else nextCandidates.add(candidate.id);
                              const next = new Map(current);
                              next.set(analysis.id, nextCandidates);
                              return next;
                            });
                          }}
                        />
                      ))}
                    </div>
                    {analysis.state === "review" ? (
                      <div className="mt-4 flex items-center gap-2">
                        <Button
                          onClick={() => startRun.mutate()}
                          disabled={
                            selectedCandidates.size === 0 ||
                            startRun.isPending ||
                            run?.state === "running"
                          }
                        >
                          <PlayIcon className="size-3.5" />
                          Remove {selectedCandidates.size} targets · reclaim about{" "}
                          {formatBytes(selectedBytes)}
                        </Button>
                        {run?.state === "running" ? (
                          <Button
                            variant="outline"
                            onClick={() =>
                              void ensureNativeApi().computerScripts.cancelRun({ runId: run.id })
                            }
                          >
                            <StopIcon className="size-3.5" />
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {run ? (
                  <div className="rounded-lg border border-border/70 bg-background/60 p-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">Run receipt</h3>
                      <span className="ml-auto text-xs capitalize text-muted-foreground">
                        {run.state}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
                      <div>Reclaimed: {formatBytes(run.reclaimedBytes)}</div>
                      <div>Removed: {run.removedCount}</div>
                      <div>Skipped: {run.skippedCount}</div>
                      <div>Failed: {run.failedCount}</div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {run.results.map((result) => (
                        <div
                          key={result.candidateId}
                          className="rounded-lg border border-border/70 p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{result.label}</span>
                            <span className="ml-auto text-xs capitalize text-muted-foreground">
                              {result.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{result.message}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No Computer Scripts utilities are available.
              </div>
            )}
          </section>
        </main>
      </div>
    </RouteInsetSurface>
  );
}
