// FILE: splitPanes.ts
// Purpose: The pane tree behind drag-to-split, and every rule for changing it.
// Layer: Web chat-surface logic (pure, no I/O)
// Exports: SplitNode plus the tree operations used by the store, surface, and tests

import type { ThreadId } from "@t3tools/contracts";

/**
 * Panes form a tree, not a list.
 *
 * A flat list can only ever have one axis, so splitting a pane inside a column
 * had to reorient every other pane to match. A tree lets each branch choose its
 * own axis, which is what "split this pane" actually means: one column holding
 * two side-by-side panes next to a column holding one.
 *
 * Every branch divides its space evenly among its children, at every depth.
 */
export type SplitNode =
  | { readonly kind: "pane"; readonly threadId: ThreadId }
  | {
      readonly kind: "branch";
      readonly orientation: SplitOrientation;
      readonly children: ReadonlyArray<SplitNode>;
    };

/** Which axis a branch lays its children along. */
export type SplitOrientation = "row" | "column";

/** Where a drop lands relative to the pane under the pointer. */
export type SplitDropEdge = "before" | "after" | "replace";

/**
 * A sanity bound, not a product one: below a readable size a pane stops being a
 * chat surface, so refusing the drop is kinder than producing slivers.
 */
export const MAX_SPLIT_PANES = 8;

export function paneNode(threadId: ThreadId): SplitNode {
  return { kind: "pane", threadId };
}

/** Every Thread in the tree, in visual order. */
export function treePaneIds(node: SplitNode): ThreadId[] {
  if (node.kind === "pane") return [node.threadId];
  return node.children.flatMap(treePaneIds);
}

export function treeContains(node: SplitNode, threadId: ThreadId): boolean {
  return treePaneIds(node).includes(threadId);
}

/** The Thread that owns the route: the first pane in visual order. */
export function firstPaneId(node: SplitNode): ThreadId | null {
  return treePaneIds(node)[0] ?? null;
}

/**
 * Collapses redundant structure: a branch with one child becomes that child, and
 * a branch nested inside a branch of the same axis is inlined.
 *
 * Without this, repeated splitting and closing leaves chains of single-child
 * branches that render as nothing but still divide the space.
 */
function normalizeNode(node: SplitNode): SplitNode {
  if (node.kind === "pane") return node;
  const children = node.children
    .map(normalizeNode)
    .flatMap((child) =>
      child.kind === "branch" && child.orientation === node.orientation ? child.children : [child],
    );
  if (children.length === 1) return children[0]!;
  return { kind: "branch", orientation: node.orientation, children };
}

/** Removes a Thread's pane, collapsing whatever structure that leaves behind. */
export function removePaneFromTree(node: SplitNode, threadId: ThreadId): SplitNode | null {
  if (node.kind === "pane") return node.threadId === threadId ? null : node;
  const children = node.children
    .map((child) => removePaneFromTree(child, threadId))
    .filter((child): child is SplitNode => child !== null);
  if (children.length === 0) return null;
  return normalizeNode({ kind: "branch", orientation: node.orientation, children });
}

/** Keeps only panes whose Thread still exists. */
export function pruneTree(
  node: SplitNode,
  knownThreadIds: ReadonlySet<ThreadId>,
): SplitNode | null {
  if (node.kind === "pane") return knownThreadIds.has(node.threadId) ? node : null;
  const children = node.children
    .map((child) => pruneTree(child, knownThreadIds))
    .filter((child): child is SplitNode => child !== null);
  if (children.length === 0) return null;
  return normalizeNode({ kind: "branch", orientation: node.orientation, children });
}

function replacePane(node: SplitNode, targetThreadId: ThreadId, replacement: SplitNode): SplitNode {
  if (node.kind === "pane") return node.threadId === targetThreadId ? replacement : node;
  return {
    kind: "branch",
    orientation: node.orientation,
    children: node.children.map((child) => replacePane(child, targetThreadId, replacement)),
  };
}

/**
 * Splits the pane showing `targetThreadId`, putting `threadId` on the given edge.
 *
 * When the target's parent branch already runs along the requested axis, the new
 * pane joins that branch as a sibling instead of nesting a new one. That keeps
 * sibling panes evenly sized — nesting would give the new pane half of one
 * sibling's space rather than an equal share of the whole branch.
 */
export function splitPaneInTree(input: {
  readonly tree: SplitNode;
  readonly targetThreadId: ThreadId;
  readonly threadId: ThreadId;
  readonly edge: SplitDropEdge;
  readonly orientation: SplitOrientation;
}): SplitNode {
  const { tree, targetThreadId, threadId, edge, orientation } = input;
  if (threadId === targetThreadId) return tree;

  // A Thread appears once. Two panes on one Thread would race on the same
  // composer draft and scroll position.
  const withoutMoved = treeContains(tree, threadId) ? removePaneFromTree(tree, threadId) : tree;
  if (!withoutMoved) return paneNode(threadId);
  if (!treeContains(withoutMoved, targetThreadId)) return withoutMoved;

  if (edge === "replace") {
    return normalizeNode(replacePane(withoutMoved, targetThreadId, paneNode(threadId)));
  }

  if (treePaneIds(withoutMoved).length >= MAX_SPLIT_PANES) return withoutMoved;

  const inserted = insertBesidePane({
    node: withoutMoved,
    targetThreadId,
    newPane: paneNode(threadId),
    edge,
    orientation,
  });
  return normalizeNode(inserted ?? withoutMoved);
}

// Walks to the branch owning the target pane so the new pane can join it when the
// axis matches; only nests a new branch when the axis differs.
function insertBesidePane(input: {
  readonly node: SplitNode;
  readonly targetThreadId: ThreadId;
  readonly newPane: SplitNode;
  readonly edge: "before" | "after";
  readonly orientation: SplitOrientation;
}): SplitNode | null {
  const { node, targetThreadId, newPane, edge, orientation } = input;

  if (node.kind === "pane") {
    if (node.threadId !== targetThreadId) return null;
    return {
      kind: "branch",
      orientation,
      children: edge === "before" ? [newPane, node] : [node, newPane],
    };
  }

  const index = node.children.findIndex(
    (child) => child.kind === "pane" && child.threadId === targetThreadId,
  );
  if (index !== -1 && node.orientation === orientation) {
    const children = [...node.children];
    children.splice(edge === "before" ? index : index + 1, 0, newPane);
    return { kind: "branch", orientation, children };
  }

  const children = [...node.children];
  for (let i = 0; i < children.length; i += 1) {
    const replaced = insertBesidePane({
      node: children[i]!,
      targetThreadId,
      newPane,
      edge,
      orientation,
    });
    if (replaced) {
      children[i] = replaced;
      return { kind: "branch", orientation: node.orientation, children };
    }
  }
  return null;
}

/**
 * Keeps the tree consistent with the routed Thread.
 *
 * A Thread already in the tree keeps the split it is part of; anything else
 * replaces the whole split, because the user asked for a different conversation,
 * not another pane.
 */
export function reconcileTree(input: {
  readonly tree: SplitNode | null;
  readonly routeThreadId: ThreadId;
}): SplitNode {
  const { tree, routeThreadId } = input;
  if (!tree) return paneNode(routeThreadId);
  return treeContains(tree, routeThreadId) ? tree : paneNode(routeThreadId);
}

export interface SplitDropZone {
  readonly edge: SplitDropEdge;
  /** Null for a replace, which does not change how panes are laid out. */
  readonly orientation: SplitOrientation | null;
}

/**
 * Which zone a pointer is in, given its position within the pane as ratios from
 * the top-left (0,0) to bottom-right (1,1).
 *
 * The four outer bands split — left/right along the row axis, top/bottom along
 * the column axis — and the middle replaces. Whichever edge the pointer is
 * nearest wins, so a corner resolves to one intent rather than flickering.
 */
export function resolveSplitDropZone(input: {
  readonly xRatio: number;
  readonly yRatio: number;
}): SplitDropZone {
  const { xRatio, yRatio } = input;
  const distances = [
    { edge: "before" as const, orientation: "row" as const, distance: xRatio },
    { edge: "after" as const, orientation: "row" as const, distance: 1 - xRatio },
    { edge: "before" as const, orientation: "column" as const, distance: yRatio },
    { edge: "after" as const, orientation: "column" as const, distance: 1 - yRatio },
  ];
  const nearest = distances.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  );
  if (nearest.distance > 0.33) return { edge: "replace", orientation: null };
  return { edge: nearest.edge, orientation: nearest.orientation };
}

/**
 * The tree to show for `routeThreadId`, given every tree we have stored.
 *
 * Trees are keyed by the Thread that owns the route, so returning to a Thread
 * restores the split it was in. Navigating to a Thread that is a pane of some
 * other tree keeps that tree, rather than collapsing the split the moment you
 * click a neighbour.
 */
export function adoptTreeForThread(input: {
  readonly trees: Readonly<Record<string, SplitNode>>;
  readonly routeThreadId: ThreadId;
}): SplitNode {
  const own = input.trees[input.routeThreadId];
  if (own) return reconcileTree({ tree: own, routeThreadId: input.routeThreadId });
  for (const tree of Object.values(input.trees)) {
    if (treeContains(tree, input.routeThreadId)) return tree;
  }
  return paneNode(input.routeThreadId);
}
