import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { BackendPerformanceSnapshot, type ServerDiagnosticsMemory } from "@t3tools/contracts";

import { ZERO_LATENCY, type PerfCountersSnapshot } from "./perfCounters";
import { buildBackendPerformanceSnapshot } from "./performanceSnapshot";

const MEMORY: ServerDiagnosticsMemory = {
  rssBytes: 200_000_000,
  heapTotalBytes: 80_000_000,
  heapUsedBytes: 60_000_000,
  externalBytes: 5_000_000,
  arrayBuffersBytes: 1_000_000,
};

const EMPTY_COUNTERS: PerfCountersSnapshot = {
  queues: [],
  sqlite: {
    append: ZERO_LATENCY,
    project: ZERO_LATENCY,
    receipt: ZERO_LATENCY,
    query: ZERO_LATENCY,
    checkpoint: ZERO_LATENCY,
  },
};

const EMPTY_OCCUPANCY = { entries: 0, estimatedBytes: 0 };

describe("buildBackendPerformanceSnapshot", () => {
  it("summarizes provider runtimes and joins RSS by pid", () => {
    const snapshot = buildBackendPerformanceSnapshot(
      {
        now: new Date("2026-07-16T12:00:00.000Z"),
        pid: 42,
        uptimeSeconds: 123,
        memory: MEMORY,
        childProcesses: [],
        childProcessTotalRssBytes: 3_000,
        rssByPid: new Map([
          [100, 1_000],
          [101, 2_000],
        ]),
        dbFileBytes: 249_122_816,
        walFileBytes: 21_185_072,
        ingestion: EMPTY_OCCUPANCY,
        providerRuntimes: [
          { provider: "codex", pid: 100, hasActiveTurn: true, warmIdle: false },
          { provider: "codex", pid: 101, hasActiveTurn: false, warmIdle: true },
          { provider: "claudeAgent", pid: null, hasActiveTurn: false, warmIdle: false },
        ],
        liveLane: null,
      },
      EMPTY_COUNTERS,
      { utilization: 0.3, delay: ZERO_LATENCY },
    );

    expect(snapshot.providerRuntimes.total).toBe(3);
    expect(snapshot.providerRuntimes.active).toBe(1);
    expect(snapshot.providerRuntimes.warmIdle).toBe(1);
    expect(snapshot.providerRuntimes.aggregateRssBytes).toBe(3_000);

    const codex = snapshot.providerRuntimes.byProvider.find((g) => g.provider === "codex");
    const claude = snapshot.providerRuntimes.byProvider.find((g) => g.provider === "claudeAgent");
    expect(codex).toEqual({ provider: "codex", count: 2, rssBytes: 3_000 });
    expect(claude).toEqual({ provider: "claudeAgent", count: 1, rssBytes: 0 });
  });

  it("injects SQLite file sizes and stamps generatedAt from now", () => {
    const snapshot = buildBackendPerformanceSnapshot(
      {
        now: new Date("2026-07-16T12:00:00.000Z"),
        pid: 42,
        uptimeSeconds: 5,
        memory: MEMORY,
        childProcesses: [],
        childProcessTotalRssBytes: 0,
        rssByPid: new Map(),
        dbFileBytes: 249_122_816,
        walFileBytes: 21_185_072,
        ingestion: EMPTY_OCCUPANCY,
        providerRuntimes: [],
        liveLane: null,
      },
      EMPTY_COUNTERS,
      { utilization: 0, delay: ZERO_LATENCY },
    );

    expect(snapshot.generatedAt).toBe("2026-07-16T12:00:00.000Z");
    expect(snapshot.sqlite.dbFileBytes).toBe(249_122_816);
    expect(snapshot.sqlite.walFileBytes).toBe(21_185_072);
    expect(snapshot.liveLane).toBeNull();
  });

  it("produces a value that satisfies the BackendPerformanceSnapshot schema", () => {
    const snapshot = buildBackendPerformanceSnapshot(
      {
        now: new Date("2026-07-16T12:00:00.000Z"),
        pid: 42,
        uptimeSeconds: 5,
        memory: MEMORY,
        childProcesses: [
          {
            pid: 100,
            ppid: 42,
            rssBytes: 1_000,
            virtualSizeBytes: 2_000,
            command: "codex",
            args: "app-server",
          },
        ],
        childProcessTotalRssBytes: 1_000,
        rssByPid: new Map([[100, 1_000]]),
        dbFileBytes: 1_024,
        walFileBytes: 512,
        ingestion: { entries: 4, estimatedBytes: 8_192 },
        providerRuntimes: [{ provider: "codex", pid: 100, hasActiveTurn: true, warmIdle: false }],
        liveLane: { updatesPerSecond: 12, durableSegmentsPerSecond: 0.5, coalescedPerSecond: 8 },
      },
      EMPTY_COUNTERS,
      { utilization: 0, delay: ZERO_LATENCY },
    );

    expect(() => Schema.decodeUnknownSync(BackendPerformanceSnapshot)(snapshot)).not.toThrow();
  });
});
