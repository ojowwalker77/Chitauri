import { describe, expect, it } from "vitest";

import { PerfCounters, ZERO_LATENCY } from "./perfCounters";

describe("PerfCounters", () => {
  it("records SQLite op latencies with count and bounded percentiles", () => {
    const counters = new PerfCounters();
    counters.recordSqlite("append", 5);
    counters.recordSqlite("append", 15);
    counters.recordSqlite("append", 10);

    const { append, project } = counters.snapshot().sqlite;
    expect(append.count).toBe(3);
    expect(append.maxMs).toBeGreaterThanOrEqual(14);
    expect(append.maxMs).toBeLessThanOrEqual(16);
    expect(append.meanMs).toBeGreaterThanOrEqual(5);
    expect(append.meanMs).toBeLessThanOrEqual(15);
    // Untouched ops stay at the shared zero.
    expect(project).toEqual(ZERO_LATENCY);
  });

  it("ignores non-finite and negative durations", () => {
    const counters = new PerfCounters();
    counters.recordSqlite("query", Number.NaN);
    counters.recordSqlite("query", -3);
    expect(counters.snapshot().sqlite.query).toEqual(ZERO_LATENCY);
  });

  it("tracks queue depth and lifecycle counts from the shadow FIFO", () => {
    const counters = new PerfCounters();
    counters.queueEnqueued("orchestration");
    counters.queueEnqueued("orchestration");
    counters.queueEnqueued("orchestration");
    counters.queueTaken("orchestration");
    counters.queueProcessed("orchestration", 2);

    const [queue] = counters.snapshot().queues;
    if (!queue) throw new Error("expected an orchestration queue snapshot");
    expect(queue.name).toBe("orchestration");
    expect(queue.depth).toBe(2);
    expect(queue.enqueuedTotal).toBe(3);
    expect(queue.processedTotal).toBe(1);
    expect(queue.oldestItemAgeMs).toBeGreaterThanOrEqual(0);
    expect(queue.processingLatency.count).toBe(1);
  });

  it("lets an explicit depth override the shadow FIFO length", () => {
    const counters = new PerfCounters();
    counters.queueEnqueued("orchestration");
    counters.setQueueDepth("orchestration", 7);
    expect(counters.snapshot().queues[0]?.depth).toBe(7);
  });

  it("counts coalesced and dropped items without going negative", () => {
    const counters = new PerfCounters();
    counters.queueEnqueued("events");
    counters.queueCoalesced("events");
    counters.queueDropped("events");

    const [queue] = counters.snapshot().queues;
    if (!queue) throw new Error("expected an events queue snapshot");
    expect(queue.coalescedTotal).toBe(1);
    expect(queue.droppedTotal).toBe(1);
    expect(queue.depth).toBe(0);
  });

  it("reset() clears every series", () => {
    const counters = new PerfCounters();
    counters.recordSqlite("append", 5);
    counters.queueEnqueued("orchestration");
    counters.reset();

    const snapshot = counters.snapshot();
    expect(snapshot.queues).toHaveLength(0);
    expect(snapshot.sqlite.append).toEqual(ZERO_LATENCY);
  });
});
