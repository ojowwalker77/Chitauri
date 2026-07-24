// FILE: childProcessTreeTerminator.test.ts
// Purpose: Verifies graceful->forced teardown of an agent child and its tree.
// Layer: Server process-lifecycle tests
// Depends on: Vitest, injectable terminator dependencies, and a real child tree.
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  terminateChildProcessTree,
  type ChildTreeTerminationEvent,
  type TerminableChildProcess,
} from "./childProcessTreeTerminator.ts";
import type {
  CapturedProcess,
  ProcessTreeKiller,
  TerminalKillSignal,
} from "./terminal/processTreeKiller.ts";

interface FakeChild extends TerminableChildProcess {
  readonly kills: Array<NodeJS.Signals | number | undefined>;
  emitExit(): void;
}

function fakeChild(pid: number | undefined): FakeChild {
  const exitListeners: Array<() => void> = [];
  const kills: Array<NodeJS.Signals | number | undefined> = [];
  return {
    pid,
    killed: false,
    kills,
    kill(signal) {
      kills.push(signal);
      return true;
    },
    once(_event, listener) {
      exitListeners.push(listener);
      return this;
    },
    emitExit() {
      for (const listener of exitListeners) listener();
    },
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but we may not signal it — still alive.
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    return false;
  }
}

function recordingKiller(descendants: CapturedProcess[]) {
  const signals: Array<{ rootPid: number; signal: TerminalKillSignal; includeRootTree: boolean }> =
    [];
  const killer: ProcessTreeKiller = {
    capture: () => ({ descendants }),
    signal: ({ rootPid, signal, includeRootTree = true }) => {
      signals.push({ rootPid, signal, includeRootTree });
    },
  };
  return { killer, signals };
}

function makeHarness(input: {
  pid: number | undefined;
  descendants?: CapturedProcess[];
  platform?: NodeJS.Platform;
}) {
  const child = fakeChild(input.pid);
  const { killer, signals } = recordingKiller(input.descendants ?? []);
  const groupSignals: Array<{ pgid: number; signal: TerminalKillSignal }> = [];
  const windowsKills: number[] = [];
  const events: ChildTreeTerminationEvent[] = [];
  let escalate: (() => void) | null = null;
  let cancelled = false;

  terminateChildProcessTree(child, {
    graceMs: 500,
    platform: input.platform ?? "linux",
    killer,
    signalProcessGroup: (pgid, signal) => {
      groupSignals.push({ pgid, signal });
      return null;
    },
    runWindowsTreeKill: (pid) => windowsKills.push(pid),
    scheduleEscalation: (fn) => {
      escalate = fn;
      return {
        cancel: () => {
          cancelled = true;
        },
      };
    },
    log: (event) => events.push(event),
  });

  return {
    child,
    signals,
    groupSignals,
    windowsKills,
    events,
    runEscalation: () => escalate?.(),
    wasCancelled: () => cancelled,
  };
}

describe("terminateChildProcessTree", () => {
  it("sends graceful SIGTERM to the process group, tree, and handle", () => {
    const h = makeHarness({ pid: 1000, descendants: [{ pid: 2000, command: "mcp-server" }] });

    expect(h.groupSignals).toEqual([{ pgid: 1000, signal: "SIGTERM" }]);
    expect(h.signals).toEqual([{ rootPid: 1000, signal: "SIGTERM", includeRootTree: true }]);
    expect(h.child.kills).toEqual(["SIGTERM"]);
    const terminate = h.events.find((event) => event.phase === "terminate");
    expect(terminate).toMatchObject({ signal: "SIGTERM", pid: 1000, descendantPids: [2000] });
  });

  it("escalates to SIGKILL of the full tree when the root ignores SIGTERM", () => {
    const h = makeHarness({ pid: 1000, descendants: [{ pid: 2000, command: "mcp-server" }] });

    h.runEscalation();

    expect(h.groupSignals).toContainEqual({ pgid: 1000, signal: "SIGKILL" });
    expect(h.signals).toContainEqual({ rootPid: 1000, signal: "SIGKILL", includeRootTree: true });
    expect(h.child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(h.events.some((event) => event.phase === "escalate")).toBe(true);
  });

  it("after root exit, escalation reaps only captured descendants (never the reused root pid)", () => {
    const h = makeHarness({ pid: 1000, descendants: [{ pid: 2000, command: "mcp-server" }] });

    h.child.emitExit();
    expect(h.wasCancelled()).toBe(false);

    h.runEscalation();

    // No SIGKILL to the root pid/group — its pid may have been reused.
    expect(h.groupSignals).toEqual([{ pgid: 1000, signal: "SIGTERM" }]);
    expect(h.child.kills).toEqual(["SIGTERM"]);
    // Captured descendants are still swept (killer verifies commands internally).
    expect(h.signals).toContainEqual({ rootPid: 1000, signal: "SIGKILL", includeRootTree: false });
  });

  it("cancels escalation when the root exits leaving no descendants", () => {
    const h = makeHarness({ pid: 1000, descendants: [] });

    h.child.emitExit();

    expect(h.wasCancelled()).toBe(true);
  });

  it("skips a child with no pid", () => {
    const h = makeHarness({ pid: undefined });

    expect(h.groupSignals).toEqual([]);
    expect(h.signals).toEqual([]);
    expect(h.child.kills).toEqual([]);
    expect(h.events).toEqual([expect.objectContaining({ phase: "skip", detail: "no-pid" })]);
  });

  it("uses taskkill on Windows and skips POSIX signaling", () => {
    const h = makeHarness({ pid: 42, platform: "win32" });

    expect(h.windowsKills).toEqual([42]);
    expect(h.groupSignals).toEqual([]);
    expect(h.signals).toEqual([]);
    expect(h.child.kills).toEqual([]);
    expect(h.events).toEqual([expect.objectContaining({ phase: "terminate", signal: "taskkill" })]);
  });

  it.skipIf(process.platform === "win32")(
    "terminates a real detached child process tree",
    async () => {
      // sh (group leader) forks a long sleep grandchild and prints its pid.
      const child = spawn("sh", ["-c", "sleep 30 & echo $!; wait"], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      });

      const grandchildPid = await new Promise<number>((resolve, reject) => {
        child.stdout.once("data", (chunk: Buffer) => {
          const pid = Number.parseInt(chunk.toString().trim(), 10);
          if (Number.isInteger(pid) && pid > 0) resolve(pid);
          else reject(new Error(`unexpected grandchild pid output: ${chunk.toString()}`));
        });
        child.once("error", reject);
      });

      expect(isProcessAlive(child.pid ?? -1)).toBe(true);
      expect(isProcessAlive(grandchildPid)).toBe(true);

      terminateChildProcessTree(child, { graceMs: 150 });

      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(isProcessAlive(child.pid ?? -1)).toBe(false);
      expect(isProcessAlive(grandchildPid)).toBe(false);
    },
  );
});
