// FILE: childProcessTreeTerminator.ts
// Purpose: Terminates a spawned agent child AND its descendant process tree
//          (e.g. MCP servers launched by the agent CLI) so nothing outlives the
//          session that owns it. Graceful SIGTERM first, forced SIGKILL after a
//          bounded grace window.
// Layer: Server process-lifecycle utility
// Depends on: node child_process signals + the shared process-tree killer.
import { spawnSync } from "node:child_process";

import {
  defaultProcessTreeKiller,
  type ProcessTreeKiller,
  type TerminalKillSignal,
} from "./terminal/processTreeKiller.ts";

export const DEFAULT_CHILD_TREE_TERMINATION_GRACE_MS = 2_000;

// The minimal surface we need from a Node ChildProcess. Keeping it structural
// lets callers pass real children and tests pass lightweight doubles.
export interface TerminableChildProcess {
  readonly pid?: number | undefined;
  readonly killed?: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit", listener: () => void): unknown;
}

export interface ChildTreeTerminationEvent {
  readonly phase: "terminate" | "escalate" | "skip" | "error";
  readonly signal: string;
  readonly pid: number | undefined;
  // On POSIX the child is spawned detached, so its process-group id equals its
  // pid at spawn time; we surface it so operators can correlate group kills.
  readonly pgid: number | undefined;
  readonly descendantPids: readonly number[];
  readonly graceMs: number;
  readonly detail?: string;
}

export interface ChildTreeTerminatorOptions {
  readonly graceMs?: number;
  readonly log?: (event: ChildTreeTerminationEvent) => void;
  readonly killer?: ProcessTreeKiller;
  readonly platform?: NodeJS.Platform;
  readonly signalProcessGroup?: (pgid: number, signal: TerminalKillSignal) => Error | null;
  readonly runWindowsTreeKill?: (pid: number) => void;
  readonly scheduleEscalation?: (fn: () => void, ms: number) => { cancel: () => void };
}

function signalProcessGroupDefault(pgid: number, signal: TerminalKillSignal): Error | null {
  try {
    // Negative pid targets the whole process group. Because agent children are
    // spawned detached (their own group leader), this reaches every descendant
    // still in the group in a single call — including any spawned during the
    // window between capture and signal.
    globalThis.process.kill(-pgid, signal);
    return null;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    // Group already gone — success. EPERM means we do not own the group (child
    // was not detached); the captured-descendant sweep below still covers it.
    if (errno?.code === "ESRCH" || errno?.code === "EPERM") {
      return null;
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function runWindowsTreeKillDefault(pid: number): void {
  try {
    // `.cmd` shims run under a cmd.exe wrapper; taskkill /T /F tears down the
    // whole tree so cancellation never leaves the real provider process behind.
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // Best effort — nothing else we can do if taskkill itself fails to launch.
  }
}

function scheduleEscalationDefault(fn: () => void, ms: number): { cancel: () => void } {
  const timer = setTimeout(fn, ms);
  // Never keep the event loop (or a shutting-down server) alive for the timer.
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}

// Terminates `child` and its descendant process tree. Returns immediately after
// the graceful signal; the forced SIGKILL escalation runs asynchronously if the
// tree has not exited within the grace window. Safe to describe as fire-and-
// forget: the escalation timer is unref'd and idempotent.
export function terminateChildProcessTree(
  child: TerminableChildProcess,
  options: ChildTreeTerminatorOptions = {},
): void {
  const platform = options.platform ?? globalThis.process.platform;
  const graceMs = options.graceMs ?? DEFAULT_CHILD_TREE_TERMINATION_GRACE_MS;
  const log = options.log;
  const pid = child.pid;

  if (platform === "win32") {
    if (pid === undefined) {
      log?.({
        phase: "skip",
        signal: "none",
        pid,
        pgid: undefined,
        descendantPids: [],
        graceMs: 0,
        detail: "no-pid",
      });
      return;
    }
    (options.runWindowsTreeKill ?? runWindowsTreeKillDefault)(pid);
    log?.({
      phase: "terminate",
      signal: "taskkill",
      pid,
      pgid: undefined,
      descendantPids: [],
      graceMs: 0,
    });
    return;
  }

  if (pid === undefined) {
    log?.({
      phase: "skip",
      signal: "none",
      pid,
      pgid: undefined,
      descendantPids: [],
      graceMs,
      detail: "no-pid",
    });
    return;
  }

  const killer = options.killer ?? defaultProcessTreeKiller;
  const signalProcessGroup = options.signalProcessGroup ?? signalProcessGroupDefault;

  // Capture descendants BEFORE signaling: once the root dies its grandchildren
  // may be reparented to init and become invisible to a ppid walk.
  const tree = killer.capture(pid);
  const descendantPids = tree.descendants.map((descendant) => descendant.pid);

  const emitError = (detail: string, atPid: number | undefined) => {
    log?.({
      phase: "error",
      signal: "SIGTERM",
      pid: atPid,
      pgid: pid,
      descendantPids,
      graceMs,
      detail,
    });
  };

  const signalGroup = (signal: TerminalKillSignal) => {
    const error = signalProcessGroup(pid, signal);
    if (error) {
      emitError(`process-group ${signal}: ${error.message}`, pid);
    }
  };

  // Graceful phase: group + tree + direct handle. Redundant on purpose so a
  // single reparented or race-spawned descendant still receives the signal.
  signalGroup("SIGTERM");
  killer.signal({
    rootPid: pid,
    signal: "SIGTERM",
    tree,
    includeRootTree: true,
    onError: (error, context) =>
      emitError(`${context.source} SIGTERM: ${error.message}`, context.pid),
  });
  try {
    child.kill("SIGTERM");
  } catch {
    // Handle already reaped — group/tree signals above still applied.
  }
  log?.({ phase: "terminate", signal: "SIGTERM", pid, pgid: pid, descendantPids, graceMs });

  const schedule = options.scheduleEscalation ?? scheduleEscalationDefault;
  let rootExited = false;
  let escalated = false;

  const escalation = schedule(() => {
    if (escalated) return;
    escalated = true;
    // Force phase: SIGKILL survivors. The killer re-verifies each captured pid's
    // command before SIGKILL to avoid killing a reused pid. Once the root has
    // exited we skip its pid/group (pgid may be reused) and only reap the
    // command-verified captured descendants.
    if (!rootExited) {
      signalGroup("SIGKILL");
    }
    killer.signal({
      rootPid: pid,
      signal: "SIGKILL",
      tree,
      includeRootTree: !rootExited,
      onError: (error, context) =>
        emitError(`${context.source} SIGKILL: ${error.message}`, context.pid),
    });
    if (!rootExited) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
    log?.({ phase: "escalate", signal: "SIGKILL", pid, pgid: pid, descendantPids, graceMs });
  }, graceMs);

  child.once("exit", () => {
    rootExited = true;
    // If the root leaves no descendants behind, there is nothing to escalate
    // against — cancel the timer and avoid a needless post-exit process scan.
    if (descendantPids.length === 0) {
      escalation.cancel();
    }
  });
}
