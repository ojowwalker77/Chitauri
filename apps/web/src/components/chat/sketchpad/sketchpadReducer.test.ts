import { describe, expect, it } from "vitest";

import type { SketchpadEdge, SketchpadNode } from "~/lib/composerSketchpad";
import {
  createSketchpadReducerState,
  sketchpadReducer,
  simplifySketchpadPoints,
} from "./sketchpadReducer";

const note = (id: string, x = 0): SketchpadNode => ({
  id,
  kind: "note",
  text: id,
  frame: { x, y: 0, width: 100, height: 80 },
  author: "user",
});

describe("sketchpadReducer", () => {
  it("increments revision once per committed intention", () => {
    const initial = createSketchpadReducerState(null);
    const added = sketchpadReducer(initial, { type: "add-node", node: note("one") });
    const moved = sketchpadReducer(added, {
      type: "move-element",
      elementId: "one",
      delta: { x: 20, y: 10 },
    });
    expect(added.document.revision).toBe(1);
    expect(moved.document.revision).toBe(2);
    expect(moved.document.nodes[0]?.frame).toMatchObject({ x: 20, y: 10 });
  });

  it("keeps bound arrows stable when a node moves and removes them with the node", () => {
    let state = createSketchpadReducerState(null);
    state = sketchpadReducer(state, { type: "add-node", node: note("one") });
    state = sketchpadReducer(state, { type: "add-node", node: note("two", 200) });
    const edge: SketchpadEdge = {
      id: "arrow",
      kind: "arrow",
      from: { nodeId: "one", anchor: { x: 1, y: 0.5 } },
      to: { nodeId: "two", anchor: { x: 0, y: 0.5 } },
      label: "next",
      author: "user",
    };
    state = sketchpadReducer(state, { type: "add-edge", edge });
    state = sketchpadReducer(state, {
      type: "move-element",
      elementId: "one",
      delta: { x: 40, y: 0 },
    });
    expect(state.document.edges[0]).toEqual(edge);
    state = sketchpadReducer(state, { type: "select", elementId: "one" });
    state = sketchpadReducer(state, { type: "delete-selected" });
    expect(state.document.edges).toEqual([]);
  });

  it("supports undo and redo without rewinding the revision", () => {
    let state = createSketchpadReducerState(null);
    state = sketchpadReducer(state, { type: "add-node", node: note("one") });
    state = sketchpadReducer(state, { type: "undo" });
    expect(state.document.nodes).toEqual([]);
    expect(state.document.revision).toBe(2);
    state = sketchpadReducer(state, { type: "redo" });
    expect(state.document.nodes).toHaveLength(1);
    expect(state.document.revision).toBe(3);
  });

  it("simplifies pathological freehand input", () => {
    const points = Array.from({ length: 2_000 }, (_, index) => ({
      x: index,
      y: Math.sin(index / 8) * 20,
    }));
    expect(simplifySketchpadPoints(points).length).toBeLessThanOrEqual(512);
  });
});
