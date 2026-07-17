// FILE: eventLoopMonitor.ts
// Purpose: Backend event-loop health via Node perf_hooks. Responsiveness cannot
// be inferred from CPU alone, so we track two orthogonal signals: event-loop
// utilization (the 0..1 fraction of time the loop was active, over the window
// since the previous snapshot) and event-loop delay (a cumulative latency
// histogram of scheduling lag since the monitor started).
// Layer: Server runtime observability

import {
  monitorEventLoopDelay,
  performance,
  type EventLoopUtilization,
  type IntervalHistogram,
} from "node:perf_hooks";

import type { PerfEventLoop, PerfLatencyStats } from "@t3tools/contracts";

import { ZERO_LATENCY } from "./perfCounters";

const NS_TO_MS = 1_000_000;
const DEFAULT_RESOLUTION_MS = 20;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export class EventLoopMonitor {
  private readonly delay: IntervalHistogram;
  private lastUtilization: EventLoopUtilization;
  private started = false;

  constructor(resolutionMs: number = DEFAULT_RESOLUTION_MS) {
    this.delay = monitorEventLoopDelay({ resolution: resolutionMs });
    this.lastUtilization = performance.eventLoopUtilization();
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.delay.enable();
    this.lastUtilization = performance.eventLoopUtilization();
    this.started = true;
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.delay.disable();
    this.started = false;
  }

  snapshot(): PerfEventLoop {
    // Single ELU read used both as the delta endpoint and the next baseline, so
    // utilization reflects exactly the window between successive snapshots.
    const current = performance.eventLoopUtilization();
    const delta = performance.eventLoopUtilization(current, this.lastUtilization);
    this.lastUtilization = current;
    return {
      utilization: clamp01(delta.utilization),
      delay: this.delaySnapshot(),
    };
  }

  private delaySnapshot(): PerfLatencyStats {
    const count = Number(this.delay.count);
    if (!Number.isFinite(count) || count <= 0) {
      return ZERO_LATENCY;
    }
    const toMs = (ns: number): number => (Number.isFinite(ns) && ns > 0 ? ns / NS_TO_MS : 0);
    return {
      count: Math.max(0, Math.round(count)),
      p50Ms: toMs(Number(this.delay.percentile(50))),
      p95Ms: toMs(Number(this.delay.percentile(95))),
      p99Ms: toMs(Number(this.delay.percentile(99))),
      maxMs: toMs(Number(this.delay.max)),
      meanMs: toMs(Number(this.delay.mean)),
    };
  }
}

// Process-wide singleton; started by the server bootstrap.
export const eventLoopMonitor = new EventLoopMonitor();
