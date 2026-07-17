// FILE: performanceSnapshot.ts
// Purpose: Pure assembler that composes a BackendPerformanceSnapshot from injected
// inputs sampled at snapshot time (memory, child processes, DB file sizes, per-pid
// RSS, ingestion-cache occupancy, current provider runtime set, live-lane rates)
// plus the always-on counter and event-loop snapshots. Kept free of I/O so it is
// fully unit testable; the RPC handler gathers the inputs and calls this.
// Layer: Server runtime observability

import type {
  BackendPerformanceSnapshot,
  PerfCacheOccupancy,
  PerfEventLoop,
  PerfLiveLane,
  PerfProviderRuntimeGroup,
  PerfProviderRuntimes,
  ProviderKind,
  ServerDiagnosticsChildProcess,
  ServerDiagnosticsMemory,
} from "@t3tools/contracts";

import type { PerfCountersSnapshot } from "./perfCounters";

// A provider runtime the backend currently owns, sampled at snapshot time. RSS is
// joined in from a process-table sample, so this descriptor only needs identity,
// liveness, and (when known) the OS pid.
export interface ProviderRuntimeDescriptor {
  readonly provider: ProviderKind | "unknown";
  readonly pid: number | null;
  readonly hasActiveTurn: boolean;
  readonly warmIdle: boolean;
}

export interface BackendPerformanceSnapshotInputs {
  readonly now: Date;
  readonly pid: number;
  readonly uptimeSeconds: number;
  readonly memory: ServerDiagnosticsMemory;
  readonly childProcesses: readonly ServerDiagnosticsChildProcess[];
  readonly childProcessTotalRssBytes: number;
  // RSS by pid from a process-table sample, used to attribute memory to provider
  // runtimes. Missing pids contribute 0 rather than failing.
  readonly rssByPid: ReadonlyMap<number, number>;
  readonly dbFileBytes: number;
  readonly walFileBytes: number;
  readonly ingestion: PerfCacheOccupancy;
  readonly providerRuntimes: readonly ProviderRuntimeDescriptor[];
  // Null until the Phase 1 live lane exists.
  readonly liveLane: PerfLiveLane | null;
}

function nonNegativeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function summarizeProviderRuntimes(
  descriptors: readonly ProviderRuntimeDescriptor[],
  rssByPid: ReadonlyMap<number, number>,
): PerfProviderRuntimes {
  const byProvider = new Map<ProviderKind | "unknown", { count: number; rssBytes: number }>();
  let active = 0;
  let warmIdle = 0;
  let aggregateRssBytes = 0;

  for (const descriptor of descriptors) {
    const rss = descriptor.pid === null ? 0 : (rssByPid.get(descriptor.pid) ?? 0);
    aggregateRssBytes += rss;
    if (descriptor.hasActiveTurn) {
      active += 1;
    } else if (descriptor.warmIdle) {
      warmIdle += 1;
    }
    const group = byProvider.get(descriptor.provider) ?? { count: 0, rssBytes: 0 };
    group.count += 1;
    group.rssBytes += rss;
    byProvider.set(descriptor.provider, group);
  }

  const groups: PerfProviderRuntimeGroup[] = [...byProvider.entries()].map(([provider, group]) => ({
    provider,
    count: group.count,
    rssBytes: nonNegativeInt(group.rssBytes),
  }));

  return {
    total: descriptors.length,
    active,
    warmIdle,
    aggregateRssBytes: nonNegativeInt(aggregateRssBytes),
    byProvider: groups,
  };
}

function sanitizeOccupancy(occupancy: PerfCacheOccupancy): PerfCacheOccupancy {
  return {
    entries: nonNegativeInt(occupancy.entries),
    estimatedBytes: nonNegativeInt(occupancy.estimatedBytes),
  };
}

export function buildBackendPerformanceSnapshot(
  inputs: BackendPerformanceSnapshotInputs,
  counters: PerfCountersSnapshot,
  eventLoop: PerfEventLoop,
): BackendPerformanceSnapshot {
  return {
    generatedAt: inputs.now.toISOString(),
    process: {
      pid: nonNegativeInt(inputs.pid),
      uptimeSeconds: nonNegativeInt(inputs.uptimeSeconds),
      memory: inputs.memory,
    },
    eventLoop,
    queues: counters.queues,
    providerRuntimes: summarizeProviderRuntimes(inputs.providerRuntimes, inputs.rssByPid),
    ingestionCaches: sanitizeOccupancy(inputs.ingestion),
    sqlite: {
      append: counters.sqlite.append,
      project: counters.sqlite.project,
      receipt: counters.sqlite.receipt,
      query: counters.sqlite.query,
      checkpoint: counters.sqlite.checkpoint,
      dbFileBytes: nonNegativeInt(inputs.dbFileBytes),
      walFileBytes: nonNegativeInt(inputs.walFileBytes),
    },
    liveLane: inputs.liveLane,
    childProcesses: inputs.childProcesses,
    childProcessTotalRssBytes: nonNegativeInt(inputs.childProcessTotalRssBytes),
  };
}
