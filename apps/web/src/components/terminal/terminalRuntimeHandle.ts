// FILE: terminalRuntimeHandle.ts
// Purpose: xterm-free entry point for terminal-runtime lifecycle calls made from
//          modules that must not pull the terminal stack into their chunk.
// Layer: Terminal runtime infrastructure
// Exports: disposeTerminalRuntime, disposeTerminalRuntimeThread, registerTerminalRuntimeRegistry
// Why: `terminalRuntimeRegistry` statically imports `@xterm/xterm` plus seven
//      addons (~867 kB raw / ~243 kB gzip, including the WebGL and image
//      addons). A single cleanup call in Sidebar.tsx was enough to pin all of it
//      into the chat layout chunk, so it downloaded and parsed on every chat
//      route even for users who never open a terminal.
//
//      The registry self-registers here on load. Callers that only need to tear
//      a thread's runtimes down can therefore go through this module: if the
//      registry was never loaded there are no runtimes to dispose and the call
//      is a correct no-op, and if it was loaded the real implementation is
//      already wired up.

import type { terminalRuntimeRegistry } from "./terminalRuntimeRegistry";

type TerminalRuntimeRegistry = typeof terminalRuntimeRegistry;

let loadedRegistry: TerminalRuntimeRegistry | null = null;

/**
 * Disposals requested while the registry chunk was still loading.
 *
 * "Nothing loaded means nothing to dispose" is only true if no attach can follow.
 * It can: the drawer is lazy now, so deleting a thread whose drawer chunk is
 * still in flight dropped the disposal, and when the chunk resolved the drawer
 * mounted and attached — spawning a fresh PTY for a thread that no longer
 * exists, with no way left to reap it. Replaying on registration closes that
 * window; the registry's own dispose calls are already no-ops for unknown ids.
 */
const pendingDisposals: Array<(registry: TerminalRuntimeRegistry) => void> = [];

/**
 * Threads torn down while the registry was unloaded.
 *
 * Replaying the queued disposal is not enough on its own: registration happens
 * at module-evaluation time, but the drawer attaches later in a React effect, so
 * the replay runs against an empty registry and the attach still spawns a PTY.
 * Thread ids are never reused, so refusing the attach outright is safe and is
 * the only thing that actually closes the window.
 */
const disposedThreadIds = new Set<string>();

/** True when this thread was torn down and must not attach a new runtime. */
export function isTerminalRuntimeThreadDisposed(threadId: string): boolean {
  return disposedThreadIds.has(threadId);
}

/** Called by the registry module itself as a side effect of being loaded. */
export function registerTerminalRuntimeRegistry(registry: TerminalRuntimeRegistry): void {
  loadedRegistry = registry;
  const replay = pendingDisposals.splice(0, pendingDisposals.length);
  for (const disposal of replay) {
    disposal(registry);
  }
}

/** Dispose a single terminal runtime, or queue it if the stack is still loading. */
export function disposeTerminalRuntime(threadId: string, terminalId: string): void {
  if (loadedRegistry) {
    loadedRegistry.disposeTerminal(threadId, terminalId);
    return;
  }
  pendingDisposals.push((registry) => registry.disposeTerminal(threadId, terminalId));
}

/**
 * Dispose every terminal runtime for a thread. Called when the thread itself is
 * deleted, so the id is also poisoned against any later attach.
 */
export function disposeTerminalRuntimeThread(threadId: string): void {
  disposedThreadIds.add(threadId);
  if (loadedRegistry) {
    loadedRegistry.disposeThread(threadId);
    return;
  }
  pendingDisposals.push((registry) => registry.disposeThread(threadId));
}
