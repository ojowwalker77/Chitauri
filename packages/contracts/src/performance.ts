// FILE: performance.ts
// Purpose: Privacy-safe, aggregate performance-snapshot schemas for Chitauri's
// measurement foundation (research Phase 0). These carry ONLY aggregate numbers
// — never prompts, message text, command arguments, file contents, tokens, or
// credentials — so a snapshot can be surfaced in diagnostics without leaking
// user content. The snapshot is composed across process boundaries:
//   * `backend`  — produced by the Node server (perf_hooks + hot-path counters),
//                  returned by the `performance.getSnapshot` RPC.
//   * `electron` — produced by the Electron main process via app.getAppMetrics()
//                  over the whole owned process tree (delivered over desktop IPC).
//   * `renderer` — assembled locally in the web app (PerformanceObserver, Markdown
//                  counters, hydrated-detail weight); never round-trips content.
// Layer: shared contracts (schema-only, no runtime logic)

import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";
import { ServerDiagnosticsChildProcess, ServerDiagnosticsMemory } from "./server";

// A non-negative float, used for latency milliseconds and rates where integer
// rounding would lose meaning (e.g. sub-millisecond p50). Kept local to this
// module so the diagnostics surface owns its own numeric constraints.
const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

// ── Building blocks ──────────────────────────────────────────────────

// Latency/duration distribution for a hot-path operation, in milliseconds.
// Percentiles are computed from a native perf_hooks histogram on read; `count`
// is the number of samples recorded since process start (monotonic).
export const PerfLatencyStats = Schema.Struct({
  count: NonNegativeInt,
  p50Ms: NonNegativeNumber,
  p95Ms: NonNegativeNumber,
  p99Ms: NonNegativeNumber,
  maxMs: NonNegativeNumber,
  meanMs: NonNegativeNumber,
});
export type PerfLatencyStats = typeof PerfLatencyStats.Type;

// Node event-loop health. `utilization` is the 0..1 fraction from
// performance.eventLoopUtilization over the sampling window; `delay` is the
// monitorEventLoopDelay histogram. Responsiveness is not inferable from CPU alone.
export const PerfEventLoop = Schema.Struct({
  utilization: NonNegativeNumber,
  delay: PerfLatencyStats,
});
export type PerfEventLoop = typeof PerfEventLoop.Type;

// One named work queue (orchestration command queue, event PubSub bridge, …).
// `coalescedTotal`/`droppedTotal` are 0 until the bounded/coalescing lanes of a
// later phase land; they are part of the contract now so the diagnostics shape
// does not churn when overload handling is added.
export const PerfQueueStats = Schema.Struct({
  name: TrimmedNonEmptyString,
  depth: NonNegativeInt,
  oldestItemAgeMs: NonNegativeInt,
  enqueuedTotal: NonNegativeInt,
  processedTotal: NonNegativeInt,
  coalescedTotal: NonNegativeInt,
  droppedTotal: NonNegativeInt,
  processingLatency: PerfLatencyStats,
});
export type PerfQueueStats = typeof PerfQueueStats.Type;

// Aggregate warm/active provider runtime footprint. Provider runtimes are
// process trees, so their RSS is a material part of application memory that a
// backend-only heap number misses.
export const PerfProviderRuntimeGroup = Schema.Struct({
  provider: Schema.Union([ProviderKind, Schema.Literal("unknown")]),
  count: NonNegativeInt,
  rssBytes: NonNegativeInt,
});
export type PerfProviderRuntimeGroup = typeof PerfProviderRuntimeGroup.Type;

export const PerfProviderRuntimes = Schema.Struct({
  total: NonNegativeInt,
  // Runtimes with an active turn in flight.
  active: NonNegativeInt,
  // Ready, resumable runtimes kept warm with no active turn.
  warmIdle: NonNegativeInt,
  aggregateRssBytes: NonNegativeInt,
  byProvider: Schema.Array(PerfProviderRuntimeGroup),
});
export type PerfProviderRuntimes = typeof PerfProviderRuntimes.Type;

// Envelope for a bounded ingestion cache (assistant text, proposed plans, tool
// output). Entry count is exact; byte size is a conservative UTF-16/length-based
// estimate for ordering and budget enforcement, not a heap measurement.
export const PerfCacheOccupancy = Schema.Struct({
  entries: NonNegativeInt,
  estimatedBytes: NonNegativeInt,
});
export type PerfCacheOccupancy = typeof PerfCacheOccupancy.Type;

// SQLite hot-path latency and on-disk footprint. Latencies isolate the durable
// write-amplification the research identified (append/project/receipt) from
// reads and checkpoints.
export const PerfSqlite = Schema.Struct({
  append: PerfLatencyStats,
  project: PerfLatencyStats,
  receipt: PerfLatencyStats,
  query: PerfLatencyStats,
  checkpoint: PerfLatencyStats,
  dbFileBytes: NonNegativeInt,
  walFileBytes: NonNegativeInt,
});
export type PerfSqlite = typeof PerfSqlite.Type;

// Live-tail lane throughput. Null until the Phase 1 live lane exists; present in
// the contract so its arrival does not reshape the snapshot.
export const PerfLiveLane = Schema.Struct({
  updatesPerSecond: NonNegativeNumber,
  durableSegmentsPerSecond: NonNegativeNumber,
  coalescedPerSecond: NonNegativeNumber,
});
export type PerfLiveLane = typeof PerfLiveLane.Type;

// ── Backend section (RPC result) ─────────────────────────────────────

export const BackendPerformanceSnapshot = Schema.Struct({
  generatedAt: IsoDateTime,
  process: Schema.Struct({
    pid: NonNegativeInt,
    uptimeSeconds: NonNegativeInt,
    memory: ServerDiagnosticsMemory,
  }),
  eventLoop: PerfEventLoop,
  queues: Schema.Array(PerfQueueStats),
  providerRuntimes: PerfProviderRuntimes,
  ingestionCaches: PerfCacheOccupancy,
  sqlite: PerfSqlite,
  liveLane: Schema.NullOr(PerfLiveLane),
  childProcesses: Schema.Array(ServerDiagnosticsChildProcess),
  childProcessTotalRssBytes: NonNegativeInt,
});
export type BackendPerformanceSnapshot = typeof BackendPerformanceSnapshot.Type;

// ── Electron section (desktop main, over IPC) ────────────────────────

// One Electron-owned process from app.getAppMetrics(). `type` is Electron's
// process type string (Browser, Tab, Utility, GPU, …); working-set values are
// normalized to bytes (Electron reports kilobytes).
export const ElectronProcessMetric = Schema.Struct({
  pid: NonNegativeInt,
  type: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  cpuPercent: NonNegativeNumber,
  workingSetBytes: NonNegativeInt,
  peakWorkingSetBytes: NonNegativeInt,
});
export type ElectronProcessMetric = typeof ElectronProcessMetric.Type;

export const ElectronPerformanceMetrics = Schema.Struct({
  generatedAt: IsoDateTime,
  processes: Schema.Array(ElectronProcessMetric),
  totalWorkingSetBytes: NonNegativeInt,
});
export type ElectronPerformanceMetrics = typeof ElectronPerformanceMetrics.Type;

// ── Renderer section (web app, local) ────────────────────────────────

export const RendererPerformanceMetrics = Schema.Struct({
  generatedAt: IsoDateTime,
  // Long tasks observed via PerformanceObserver over the sampling window.
  longTasks: PerfLatencyStats,
  // Markdown/highlight work counted at the parse boundary.
  markdownParses: NonNegativeInt,
  markdownParseMs: NonNegativeNumber,
  syntaxHighlights: NonNegativeInt,
  // Hydrated thread-detail residency the renderer is holding in the store.
  hydratedThreadDetailCount: NonNegativeInt,
  hydratedThreadDetailEstimatedBytes: NonNegativeInt,
});
export type RendererPerformanceMetrics = typeof RendererPerformanceMetrics.Type;

// ── Unified snapshot (diagnostics composition) ───────────────────────

// Composed view for a diagnostics surface. `electron`/`renderer` are null when
// that producer is unavailable (e.g. web build without desktop IPC, or before
// the renderer collector has sampled).
export const PerformanceSnapshot = Schema.Struct({
  generatedAt: IsoDateTime,
  backend: BackendPerformanceSnapshot,
  electron: Schema.NullOr(ElectronPerformanceMetrics),
  renderer: Schema.NullOr(RendererPerformanceMetrics),
});
export type PerformanceSnapshot = typeof PerformanceSnapshot.Type;

// ── RPC input/result ─────────────────────────────────────────────────

export const PerformanceGetSnapshotInput = Schema.Struct({
  // When true, the server includes the per-child-process table (a `ps`-backed
  // read); when false, only aggregate child RSS/count are populated to keep the
  // snapshot cheap for high-frequency sampling.
  includeChildProcesses: Schema.optional(Schema.Boolean),
});
export type PerformanceGetSnapshotInput = typeof PerformanceGetSnapshotInput.Type;

export const PerformanceGetSnapshotResult = BackendPerformanceSnapshot;
export type PerformanceGetSnapshotResult = typeof PerformanceGetSnapshotResult.Type;
