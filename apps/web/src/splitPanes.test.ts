import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  MAX_SPLIT_PANES,
  adoptTreeForThread,
  firstPaneId,
  paneNode,
  pruneTree,
  reconcileTree,
  removePaneFromTree,
  resolveSplitDropZone,
  splitPaneInTree,
  treeContains,
  treePaneIds,
  type SplitNode,
} from "./splitPanes";

const t = (name: string) => ThreadId.makeUnsafe(name);
const [a, b, c, d] = [t("a"), t("b"), t("c"), t("d")];

const row = (...children: SplitNode[]): SplitNode => ({
  kind: "branch",
  orientation: "row",
  children,
});
const column = (...children: SplitNode[]): SplitNode => ({
  kind: "branch",
  orientation: "column",
  children,
});

describe("splitPaneInTree", () => {
  it("splits a single pane into a branch on the requested axis", () => {
    expect(
      splitPaneInTree({
        tree: paneNode(a),
        targetThreadId: a,
        threadId: b,
        edge: "after",
        orientation: "row",
      }),
    ).toEqual(row(paneNode(a), paneNode(b)));
  });

  // The bug this tree replaced: with one global axis, splitting a pane inside a
  // column reoriented every other pane. Each branch must keep its own axis.
  it("splits one pane of a column horizontally, leaving its sibling alone", () => {
    const tree = column(paneNode(a), paneNode(b));
    expect(
      splitPaneInTree({
        tree,
        targetThreadId: a,
        threadId: c,
        edge: "after",
        orientation: "row",
      }),
    ).toEqual(column(row(paneNode(a), paneNode(c)), paneNode(b)));
  });

  it("splits one pane of a row vertically, leaving its sibling alone", () => {
    const tree = row(paneNode(a), paneNode(b));
    expect(
      splitPaneInTree({
        tree,
        targetThreadId: b,
        threadId: c,
        edge: "after",
        orientation: "column",
      }),
    ).toEqual(row(paneNode(a), column(paneNode(b), paneNode(c))));
  });

  // Nesting here would give the new pane half of one sibling's space instead of
  // an equal share, which breaks the "always even" rule.
  it("joins the existing branch when the axis already matches", () => {
    const tree = row(paneNode(a), paneNode(b));
    expect(
      splitPaneInTree({
        tree,
        targetThreadId: b,
        threadId: c,
        edge: "after",
        orientation: "row",
      }),
    ).toEqual(row(paneNode(a), paneNode(b), paneNode(c)));
  });

  it("honours the leading edge", () => {
    expect(
      splitPaneInTree({
        tree: row(paneNode(a), paneNode(b)),
        targetThreadId: a,
        threadId: c,
        edge: "before",
        orientation: "row",
      }),
    ).toEqual(row(paneNode(c), paneNode(a), paneNode(b)));
  });

  it("replaces the target pane in place", () => {
    expect(
      splitPaneInTree({
        tree: row(paneNode(a), paneNode(b)),
        targetThreadId: b,
        threadId: c,
        edge: "replace",
        orientation: "row",
      }),
    ).toEqual(row(paneNode(a), paneNode(c)));
  });

  // Two panes on one Thread would race on the same draft and scroll position.
  it("moves an already-open Thread rather than duplicating it", () => {
    const tree = row(paneNode(a), paneNode(b), paneNode(c));
    const next = splitPaneInTree({
      tree,
      targetThreadId: a,
      threadId: c,
      edge: "before",
      orientation: "row",
    });
    expect(treePaneIds(next)).toEqual([c, a, b]);
  });

  it("is a no-op when dropped onto itself", () => {
    const tree = row(paneNode(a), paneNode(b));
    expect(
      splitPaneInTree({
        tree,
        targetThreadId: a,
        threadId: a,
        edge: "after",
        orientation: "column",
      }),
    ).toEqual(tree);
  });

  it("refuses a new pane once the cap is reached", () => {
    let tree: SplitNode = paneNode(t("t0"));
    for (let i = 1; i < MAX_SPLIT_PANES; i += 1) {
      tree = splitPaneInTree({
        tree,
        targetThreadId: t(`t${i - 1}`),
        threadId: t(`t${i}`),
        edge: "after",
        orientation: "row",
      });
    }
    expect(treePaneIds(tree)).toHaveLength(MAX_SPLIT_PANES);
    const overflowed = splitPaneInTree({
      tree,
      targetThreadId: t("t0"),
      threadId: t("extra"),
      edge: "after",
      orientation: "row",
    });
    expect(treePaneIds(overflowed)).toHaveLength(MAX_SPLIT_PANES);
  });
});

describe("removePaneFromTree", () => {
  it("collapses a branch left with one child", () => {
    expect(removePaneFromTree(row(paneNode(a), paneNode(b)), b)).toEqual(paneNode(a));
  });

  // Repeated split/close would otherwise leave chains of single-child branches
  // that render as nothing but still divide the space.
  it("collapses nested structure down to the surviving pane", () => {
    const tree = column(row(paneNode(a), paneNode(c)), paneNode(b));
    expect(removePaneFromTree(tree, c)).toEqual(column(paneNode(a), paneNode(b)));
    expect(removePaneFromTree(removePaneFromTree(tree, c)!, a)).toEqual(paneNode(b));
  });

  it("returns null when the last pane goes, so callers can refuse it", () => {
    expect(removePaneFromTree(paneNode(a), a)).toBeNull();
  });

  it("leaves the tree alone for a Thread it does not hold", () => {
    const tree = row(paneNode(a), paneNode(b));
    expect(removePaneFromTree(tree, d)).toEqual(tree);
  });
});

describe("tree queries", () => {
  it("reads panes in visual order", () => {
    expect(treePaneIds(column(row(paneNode(a), paneNode(c)), paneNode(b)))).toEqual([a, c, b]);
  });

  it("reports the first pane as the route owner", () => {
    expect(firstPaneId(column(row(paneNode(a), paneNode(c)), paneNode(b)))).toBe(a);
  });

  it("knows which Threads it holds", () => {
    const tree = row(paneNode(a), paneNode(b));
    expect(treeContains(tree, b)).toBe(true);
    expect(treeContains(tree, d)).toBe(false);
  });
});

describe("pruneTree", () => {
  // A persisted split outlives its Threads; a deleted one must not come back.
  it("drops panes whose Thread no longer exists and collapses what is left", () => {
    const tree = column(row(paneNode(a), paneNode(c)), paneNode(b));
    expect(pruneTree(tree, new Set([a, b]))).toEqual(column(paneNode(a), paneNode(b)));
  });

  it("returns null when nothing survives", () => {
    expect(pruneTree(row(paneNode(a), paneNode(b)), new Set([d]))).toBeNull();
  });
});

describe("reconcileTree", () => {
  it("keeps the split when the routed Thread is in it", () => {
    const tree = row(paneNode(a), paneNode(b));
    expect(reconcileTree({ tree, routeThreadId: b })).toEqual(tree);
  });

  it("replaces the split when navigating outside it", () => {
    expect(reconcileTree({ tree: row(paneNode(a), paneNode(b)), routeThreadId: d })).toEqual(
      paneNode(d),
    );
  });

  it("adopts the routed Thread when there is no tree", () => {
    expect(reconcileTree({ tree: null, routeThreadId: a })).toEqual(paneNode(a));
  });
});

describe("adoptTreeForThread", () => {
  const tree = column(row(paneNode(a), paneNode(c)), paneNode(b));

  it("restores the tree stored for the routed Thread", () => {
    expect(adoptTreeForThread({ trees: { [a]: tree }, routeThreadId: a })).toEqual(tree);
  });

  // Clicking a neighbouring pane must not collapse the split you are working in.
  it("keeps the tree when routing to one of its panes", () => {
    expect(adoptTreeForThread({ trees: { [a]: tree }, routeThreadId: b })).toEqual(tree);
  });

  it("falls back to a single pane for a Thread in no tree", () => {
    expect(adoptTreeForThread({ trees: { [a]: tree }, routeThreadId: d })).toEqual(paneNode(d));
    expect(adoptTreeForThread({ trees: {}, routeThreadId: a })).toEqual(paneNode(a));
  });
});

describe("resolveSplitDropZone", () => {
  const zone = (xRatio: number, yRatio: number) => resolveSplitDropZone({ xRatio, yRatio });

  it("splits along the row axis on the left and right bands", () => {
    expect(zone(0.05, 0.5)).toEqual({ edge: "before", orientation: "row" });
    expect(zone(0.95, 0.5)).toEqual({ edge: "after", orientation: "row" });
  });

  it("splits along the column axis on the top and bottom bands", () => {
    expect(zone(0.5, 0.05)).toEqual({ edge: "before", orientation: "column" });
    expect(zone(0.5, 0.95)).toEqual({ edge: "after", orientation: "column" });
  });

  it("replaces in the middle, which carries no axis", () => {
    expect(zone(0.5, 0.5)).toEqual({ edge: "replace", orientation: null });
  });

  // A corner is near two edges; nearest wins so the affordance cannot flicker.
  it("resolves a corner to the single nearest edge", () => {
    expect(zone(0.1, 0.2)).toEqual({ edge: "before", orientation: "row" });
    expect(zone(0.2, 0.1)).toEqual({ edge: "before", orientation: "column" });
    expect(zone(0.9, 0.95)).toEqual({ edge: "after", orientation: "column" });
  });
});
