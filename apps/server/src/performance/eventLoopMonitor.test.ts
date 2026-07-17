import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { PerfEventLoop } from "@t3tools/contracts";

import { EventLoopMonitor } from "./eventLoopMonitor";

describe("EventLoopMonitor", () => {
  it("produces a schema-valid snapshot after running", async () => {
    const monitor = new EventLoopMonitor(10);
    monitor.start();
    // Let the loop tick so the delay histogram can record intervals.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const snapshot = monitor.snapshot();
    monitor.stop();

    expect(() => Schema.decodeUnknownSync(PerfEventLoop)(snapshot)).not.toThrow();
    expect(snapshot.utilization).toBeGreaterThanOrEqual(0);
    expect(snapshot.utilization).toBeLessThanOrEqual(1);
    expect(snapshot.delay.count).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(snapshot.delay.maxMs)).toBe(true);
    expect(Number.isFinite(snapshot.delay.meanMs)).toBe(true);
  });

  it("does not throw and reports a zeroed delay before start()", () => {
    const monitor = new EventLoopMonitor();
    const snapshot = monitor.snapshot();
    expect(snapshot.delay.count).toBe(0);
    expect(snapshot.utilization).toBeGreaterThanOrEqual(0);
  });
});
