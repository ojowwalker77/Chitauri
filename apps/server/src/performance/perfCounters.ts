// FILE: perfCounters.ts
// Purpose: Process-wide, allocation-light performance counters for the backend
// hot paths the performance research identified — durable write amplification
// (SQLite append/project/receipt), and queue backpressure. Only series that MUST
// be observed over time live here (latency distributions, queue lifecycle);
// anything sampleable instantaneously (memory, cache occupancy, runtime set, file
// sizes) is pulled at snapshot time instead. Increments are synchronous and cheap
// so the counters can stay always-on.
// PRIVACY: only counts and latency samples are recorded here — never prompts,
// message text, arguments, tokens, or credentials.
// Layer: Server runtime observability

import { createHistogram, type RecordableHistogram } from "node:perf_hooks";

import type { PerfLatencyStats, PerfQueueStats } from "@t3tools/contracts";

// Native histograms record integer values; we store durations as microseconds so
// sub-millisecond latencies keep resolution, and convert back to ms on read.
const MS_TO_US = 1000;
// Safety cap on a queue's shadow timestamp FIFO. If enqueue/dequeue ever drift
// (e.g. a queue is torn down mid-flight) this bounds memory instead of leaking.
const MAX_QUEUE_SHADOW_ENTRIES = 100_000;

export const ZERO_LATENCY: PerfLatencyStats = {
  count: 0,
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  maxMs: 0,
  meanMs: 0,
};

export type SqliteOpKind = "append" | "project" | "receipt" | "query" | "checkpoint";

const SQLITE_OP_KINDS: readonly SqliteOpKind[] = [
  "append",
  "project",
  "receipt",
  "query",
  "checkpoint",
];

export interface PerfCountersSnapshot {
  readonly queues: readonly PerfQueueStats[];
  readonly sqlite: Readonly<Record<SqliteOpKind, PerfLatencyStats>>;
}

// Wraps a native perf_hooks histogram for one latency series. Kept tiny so
// recording a sample on a hot path is a single integer record().
class LatencyRecorder {
  private readonly histogram: RecordableHistogram = createHistogram();
  private sampleCount = 0;

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      return;
    }
    // record() requires an integer in [1, MAX_SAFE_INTEGER].
    const micros = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.round(ms * MS_TO_US)));
    this.histogram.record(micros);
    this.sampleCount += 1;
  }

  snapshot(): PerfLatencyStats {
    if (this.sampleCount === 0) {
      return ZERO_LATENCY;
    }
    const toMs = (micros: number): number =>
      Number.isFinite(micros) && micros > 0 ? micros / MS_TO_US : 0;
    return {
      count: this.sampleCount,
      p50Ms: toMs(Number(this.histogram.percentile(50))),
      p95Ms: toMs(Number(this.histogram.percentile(95))),
      p99Ms: toMs(Number(this.histogram.percentile(99))),
      maxMs: toMs(Number(this.histogram.max)),
      meanMs: toMs(Number(this.histogram.mean)),
    };
  }

  reset(): void {
    this.histogram.reset();
    this.sampleCount = 0;
  }
}

// Shadow model of one work queue. Enqueue pushes a timestamp; dequeue shifts the
// oldest, so `oldestItemAgeMs` is the true head-of-line age without peeking the
// real (Effect) queue. Explicit depth from the owning queue takes precedence when
// provided, since the shadow can drift on abnormal teardown.
class QueueShadow {
  private readonly enqueuedAtMs: number[] = [];
  private readonly processing = new LatencyRecorder();
  private explicitDepth: number | null = null;
  private enqueuedTotal = 0;
  private processedTotal = 0;
  private coalescedTotal = 0;
  private droppedTotal = 0;

  constructor(private readonly name: string) {}

  enqueued(nowMs: number): void {
    this.enqueuedTotal += 1;
    if (this.enqueuedAtMs.length >= MAX_QUEUE_SHADOW_ENTRIES) {
      this.enqueuedAtMs.shift();
    }
    this.enqueuedAtMs.push(nowMs);
  }

  // The item has left the wait queue (a worker took it). Shifting here keeps
  // depth/oldestItemAgeMs measuring only items still waiting, not the in-flight one.
  taken(): void {
    this.enqueuedAtMs.shift();
  }

  // The worker finished the item; record how long processing took.
  processed(processingMs?: number): void {
    this.processedTotal += 1;
    if (processingMs !== undefined) {
      this.processing.record(processingMs);
    }
  }

  coalesced(): void {
    this.coalescedTotal += 1;
  }

  dropped(): void {
    this.droppedTotal += 1;
    this.enqueuedAtMs.shift();
  }

  setDepth(depth: number): void {
    this.explicitDepth = Number.isFinite(depth) && depth >= 0 ? Math.round(depth) : null;
  }

  snapshotAt(nowMs: number): PerfQueueStats {
    const shadowDepth = this.enqueuedAtMs.length;
    const depth = this.explicitDepth ?? shadowDepth;
    const oldest = this.enqueuedAtMs[0];
    const oldestItemAgeMs = oldest === undefined ? 0 : Math.max(0, Math.round(nowMs - oldest));
    return {
      name: this.name,
      depth: Math.max(0, depth),
      oldestItemAgeMs,
      enqueuedTotal: this.enqueuedTotal,
      processedTotal: this.processedTotal,
      coalescedTotal: this.coalescedTotal,
      droppedTotal: this.droppedTotal,
      processingLatency: this.processing.snapshot(),
    };
  }

  reset(): void {
    this.enqueuedAtMs.length = 0;
    this.processing.reset();
    this.explicitDepth = null;
    this.enqueuedTotal = 0;
    this.processedTotal = 0;
    this.coalescedTotal = 0;
    this.droppedTotal = 0;
  }
}

// The registry. A single module-level instance is exported so any hot path can
// increment without threading a dependency through Effect layers. It holds no
// user content and never throws on the hot path.
export class PerfCounters {
  private readonly sqlite: Record<SqliteOpKind, LatencyRecorder> = {
    append: new LatencyRecorder(),
    project: new LatencyRecorder(),
    receipt: new LatencyRecorder(),
    query: new LatencyRecorder(),
    checkpoint: new LatencyRecorder(),
  };
  private readonly queues = new Map<string, QueueShadow>();

  private queueFor(name: string): QueueShadow {
    let shadow = this.queues.get(name);
    if (!shadow) {
      shadow = new QueueShadow(name);
      this.queues.set(name, shadow);
    }
    return shadow;
  }

  recordSqlite(op: SqliteOpKind, ms: number): void {
    this.sqlite[op].record(ms);
  }

  // Times a synchronous SQLite operation and records its duration. Returns the
  // callback's result so call sites can wrap inline.
  timeSqlite<T>(op: SqliteOpKind, run: () => T): T {
    const start = performance.now();
    try {
      return run();
    } finally {
      this.sqlite[op].record(performance.now() - start);
    }
  }

  queueEnqueued(name: string): void {
    this.queueFor(name).enqueued(Date.now());
  }

  // A worker pulled the head item off the wait queue.
  queueTaken(name: string): void {
    this.queueFor(name).taken();
  }

  // A worker finished processing an item; `processingMs` feeds the latency series.
  queueProcessed(name: string, processingMs?: number): void {
    this.queueFor(name).processed(processingMs);
  }

  queueCoalesced(name: string): void {
    this.queueFor(name).coalesced();
  }

  queueDropped(name: string): void {
    this.queueFor(name).dropped();
  }

  setQueueDepth(name: string, depth: number): void {
    this.queueFor(name).setDepth(depth);
  }

  snapshot(): PerfCountersSnapshot {
    const now = Date.now();
    return {
      queues: [...this.queues.values()].map((queue) => queue.snapshotAt(now)),
      sqlite: {
        append: this.sqlite.append.snapshot(),
        project: this.sqlite.project.snapshot(),
        receipt: this.sqlite.receipt.snapshot(),
        query: this.sqlite.query.snapshot(),
        checkpoint: this.sqlite.checkpoint.snapshot(),
      },
    };
  }

  // Test-only: clears all recorded state so suites do not bleed into each other.
  reset(): void {
    for (const op of SQLITE_OP_KINDS) {
      this.sqlite[op].reset();
    }
    this.queues.clear();
  }
}

// Process-wide singleton. Import this and call the increment methods directly.
export const perfCounters = new PerfCounters();
