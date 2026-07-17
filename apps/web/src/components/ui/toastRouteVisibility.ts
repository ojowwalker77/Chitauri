// FILE: toastRouteVisibility.ts
// Purpose: Keeps thread-scoped toasts visible for the active chat route.
// Layer: UI helpers
// Exports: visible-thread resolver shared by toast containers and tests

import type { ThreadId } from "@t3tools/contracts";
export function resolveVisibleToastThreadIds(input: {
  activeThreadId: ThreadId | null;
}): ReadonlySet<ThreadId> {
  return input.activeThreadId ? new Set([input.activeThreadId]) : new Set<ThreadId>();
}

export function shouldRenderToastForVisibleThreads(input: {
  allowCrossThreadVisibility?: boolean | undefined;
  toastThreadId?: ThreadId | null | undefined;
  visibleThreadIds: ReadonlySet<ThreadId>;
}): boolean {
  if (input.allowCrossThreadVisibility) {
    return true;
  }
  const toastThreadId = input.toastThreadId;
  if (!toastThreadId) {
    return true;
  }
  return input.visibleThreadIds.has(toastThreadId);
}
