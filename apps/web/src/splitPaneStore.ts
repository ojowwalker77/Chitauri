// FILE: splitPaneStore.ts
// Purpose: Persisted client state for the chat split — the pane tree per Thread.
// Layer: UI state store
// Exports: useSplitPaneStore, THREAD_DRAG_MIME

import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  adoptTreeForThread,
  paneNode,
  pruneTree,
  removePaneFromTree,
  splitPaneInTree,
  treeContains,
  treePaneIds,
  type SplitDropEdge,
  type SplitNode,
  type SplitOrientation,
} from "./splitPanes";

/**
 * Custom MIME type for a Thread dragged out of the sidebar.
 *
 * A custom type rather than `text/plain` so a drop target can tell a Thread from
 * arbitrary dragged text during `dragover` — the drag data itself is unreadable
 * until `drop`, but the type list is not.
 */
export const THREAD_DRAG_MIME = "application/x-teacode-thread";

const SPLIT_PANES_STORAGE_KEY = "teacode:split-panes:v2";

interface SplitPaneStoreState {
  /**
   * Pane trees keyed by the Thread that owns the route. Keyed rather than single
   * so returning to a Thread restores the split it was in, instead of whichever
   * split happened to be open most recently.
   */
  treesByThreadId: Record<string, SplitNode>;
  /** The pane the composer and shortcuts act on. Session-only, never persisted. */
  focusedThreadId: ThreadId | null;
  dropThread: (input: {
    routeThreadId: ThreadId;
    targetThreadId: ThreadId;
    threadId: ThreadId;
    edge: SplitDropEdge;
    orientation: SplitOrientation | null;
  }) => void;
  closePane: (routeThreadId: ThreadId, threadId: ThreadId) => void;
  focusPane: (threadId: ThreadId) => void;
  /** Drop panes and trees whose Threads no longer exist. */
  pruneSplits: (knownThreadIds: ReadonlyArray<ThreadId>) => void;
}

// A tree of one pane is just a Thread, so it is never stored — otherwise the
// record would grow an entry for every Thread ever visited.
function writeTree(
  trees: Record<string, SplitNode>,
  routeThreadId: ThreadId,
  tree: SplitNode,
): Record<string, SplitNode> {
  const next = { ...trees };
  if (tree.kind === "branch") next[routeThreadId] = tree;
  else delete next[routeThreadId];
  return next;
}

export const useSplitPaneStore = create<SplitPaneStoreState>()(
  persist(
    (set) => ({
      treesByThreadId: {},
      focusedThreadId: null,
      dropThread: ({ routeThreadId, targetThreadId, threadId, edge, orientation }) =>
        set((state) => {
          const current = adoptTreeForThread({ trees: state.treesByThreadId, routeThreadId });
          const tree = splitPaneInTree({
            tree: current,
            targetThreadId,
            threadId,
            edge,
            // A replace carries no axis; the value is unused on that path.
            orientation: orientation ?? "row",
          });
          return {
            treesByThreadId: writeTree(state.treesByThreadId, routeThreadId, tree),
            // A dropped Thread takes focus even when nothing moved, because the
            // drop is an explicit "work here now".
            focusedThreadId: threadId,
          };
        }),
      closePane: (routeThreadId, threadId) =>
        set((state) => {
          const current = adoptTreeForThread({ trees: state.treesByThreadId, routeThreadId });
          if (!treeContains(current, threadId)) return state;
          const tree = removePaneFromTree(current, threadId);
          // Closing the last pane would leave no chat surface.
          if (!tree) return state;
          const focusedThreadId =
            state.focusedThreadId === threadId
              ? (treePaneIds(tree)[0] ?? null)
              : state.focusedThreadId;
          return {
            treesByThreadId: writeTree(state.treesByThreadId, routeThreadId, tree),
            focusedThreadId,
          };
        }),
      focusPane: (threadId) =>
        set((state) =>
          state.focusedThreadId === threadId ? state : { ...state, focusedThreadId: threadId },
        ),
      pruneSplits: (knownThreadIds) =>
        set((state) => {
          const known = new Set(knownThreadIds);
          const next: Record<string, SplitNode> = {};
          let changed = false;
          for (const [key, tree] of Object.entries(state.treesByThreadId)) {
            const pruned = known.has(key as ThreadId) ? pruneTree(tree, known) : null;
            if (pruned && pruned.kind === "branch") {
              next[key] = pruned;
              if (treePaneIds(pruned).length !== treePaneIds(tree).length) changed = true;
            } else {
              changed = true;
            }
          }
          return changed ? { treesByThreadId: next } : state;
        }),
    }),
    {
      name: SPLIT_PANES_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Focus belongs to the session, not to the split.
      partialize: (state) => ({ treesByThreadId: state.treesByThreadId }),
    },
  ),
);

export { paneNode };
