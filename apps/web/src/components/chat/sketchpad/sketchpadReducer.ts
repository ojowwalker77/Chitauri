import {
  SKETCHPAD_MAX_ELEMENTS,
  SKETCHPAD_MAX_POINTS_PER_STROKE,
  cloneSketchpadDocument,
  createEmptySketchpadDocument,
  type SketchpadDocument,
  type SketchpadEdge,
  type SketchpadFrame,
  type SketchpadNode,
  type SketchpadPoint,
} from "~/lib/composerSketchpad";

export type SketchpadTool =
  | "select"
  | "note"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "pen";

export interface SketchpadReducerState {
  document: SketchpadDocument;
  past: SketchpadDocument[];
  future: SketchpadDocument[];
  selectedElementId: string | null;
  tool: SketchpadTool;
}

export type SketchpadAction =
  | { type: "load-document"; document: SketchpadDocument | null }
  | { type: "select"; elementId: string | null }
  | { type: "set-tool"; tool: SketchpadTool }
  | { type: "add-node"; node: SketchpadNode }
  | { type: "add-edge"; edge: SketchpadEdge }
  | { type: "add-stroke"; id: string; points: SketchpadPoint[]; author?: "user" | "agent" }
  | { type: "move-element"; elementId: string; delta: SketchpadPoint }
  | { type: "resize-node"; nodeId: string; frame: SketchpadFrame }
  | { type: "update-node-text"; nodeId: string; text: string }
  | { type: "update-edge-label"; edgeId: string; label: string }
  | { type: "delete-selected" }
  | { type: "clear" }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 100;

export function createSketchpadReducerState(
  document: SketchpadDocument | null | undefined,
): SketchpadReducerState {
  return {
    document: cloneSketchpadDocument(document ?? createEmptySketchpadDocument()),
    past: [],
    future: [],
    selectedElementId: null,
    tool: "select",
  };
}

function elementsEqual(left: SketchpadDocument, right: SketchpadDocument): boolean {
  return (
    JSON.stringify({ nodes: left.nodes, edges: left.edges }) ===
    JSON.stringify({ nodes: right.nodes, edges: right.edges })
  );
}

function commit(
  state: SketchpadReducerState,
  document: SketchpadDocument,
  selectedElementId = state.selectedElementId,
): SketchpadReducerState {
  if (elementsEqual(state.document, document)) return state;
  return {
    ...state,
    document: { ...document, revision: state.document.revision + 1 },
    past: [...state.past.slice(-(HISTORY_LIMIT - 1)), cloneSketchpadDocument(state.document)],
    future: [],
    selectedElementId,
  };
}

function distanceToSegment(
  point: SketchpadPoint,
  start: SketchpadPoint,
  end: SketchpadPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function simplifyRdp(points: SketchpadPoint[], tolerance: number): SketchpadPoint[] {
  if (points.length <= 2) return points;
  let furthestDistance = 0;
  let furthestIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(points[index]!, points[0]!, points[points.length - 1]!);
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  if (furthestDistance <= tolerance) return [points[0]!, points[points.length - 1]!];
  const left = simplifyRdp(points.slice(0, furthestIndex + 1), tolerance);
  const right = simplifyRdp(points.slice(furthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function simplifySketchpadPoints(points: ReadonlyArray<SketchpadPoint>): SketchpadPoint[] {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length <= 2) return finite.map((point) => ({ ...point }));
  let simplified = simplifyRdp(
    finite.map((point) => ({ ...point })),
    1.5,
  );
  if (simplified.length > SKETCHPAD_MAX_POINTS_PER_STROKE) {
    const stride = (simplified.length - 1) / (SKETCHPAD_MAX_POINTS_PER_STROKE - 1);
    simplified = Array.from(
      { length: SKETCHPAD_MAX_POINTS_PER_STROKE },
      (_, index) => simplified[Math.round(index * stride)]!,
    );
  }
  return simplified;
}

export function frameForPoints(points: ReadonlyArray<SketchpadPoint>): SketchpadFrame {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(8, Math.max(...xs) - x),
    height: Math.max(8, Math.max(...ys) - y),
  };
}

function moveElement(
  document: SketchpadDocument,
  elementId: string,
  delta: SketchpadPoint,
): SketchpadDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== elementId) return node;
      if (node.kind === "stroke") {
        return {
          ...node,
          frame: { ...node.frame, x: node.frame.x + delta.x, y: node.frame.y + delta.y },
          points: node.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
        };
      }
      return {
        ...node,
        frame: { ...node.frame, x: node.frame.x + delta.x, y: node.frame.y + delta.y },
      };
    }),
  };
}

export function sketchpadReducer(
  state: SketchpadReducerState,
  action: SketchpadAction,
): SketchpadReducerState {
  switch (action.type) {
    case "load-document": {
      const document = action.document ?? createEmptySketchpadDocument();
      if (
        elementsEqual(state.document, document) &&
        state.document.revision === document.revision
      ) {
        return state;
      }
      return createSketchpadReducerState(document);
    }
    case "select":
      return state.selectedElementId === action.elementId
        ? state
        : { ...state, selectedElementId: action.elementId };
    case "set-tool":
      return state.tool === action.tool ? state : { ...state, tool: action.tool };
    case "add-node": {
      if (state.document.nodes.length + state.document.edges.length >= SKETCHPAD_MAX_ELEMENTS)
        return state;
      return commit(
        state,
        { ...state.document, nodes: [...state.document.nodes, action.node] },
        action.node.id,
      );
    }
    case "add-edge": {
      if (state.document.nodes.length + state.document.edges.length >= SKETCHPAD_MAX_ELEMENTS)
        return state;
      if (
        action.edge.from.nodeId === action.edge.to.nodeId ||
        !state.document.nodes.some((node) => node.id === action.edge.from.nodeId) ||
        !state.document.nodes.some((node) => node.id === action.edge.to.nodeId)
      )
        return state;
      return commit(
        state,
        { ...state.document, edges: [...state.document.edges, action.edge] },
        action.edge.id,
      );
    }
    case "add-stroke": {
      if (state.document.nodes.length + state.document.edges.length >= SKETCHPAD_MAX_ELEMENTS)
        return state;
      const points = simplifySketchpadPoints(action.points);
      if (points.length < 2) return state;
      const node: SketchpadNode = {
        id: action.id,
        kind: "stroke",
        points,
        frame: frameForPoints(points),
        author: action.author ?? "user",
      };
      return commit(state, { ...state.document, nodes: [...state.document.nodes, node] }, node.id);
    }
    case "move-element":
      return commit(state, moveElement(state.document, action.elementId, action.delta));
    case "resize-node":
      return commit(state, {
        ...state.document,
        nodes: state.document.nodes.map((node) =>
          node.id === action.nodeId && node.kind !== "stroke"
            ? { ...node, frame: action.frame }
            : node,
        ),
      });
    case "update-node-text":
      return commit(state, {
        ...state.document,
        nodes: state.document.nodes.map((node) => {
          if (node.id !== action.nodeId || node.kind === "stroke") return node;
          return node.kind === "note"
            ? { ...node, text: action.text }
            : { ...node, label: action.text };
        }),
      });
    case "update-edge-label":
      return commit(state, {
        ...state.document,
        edges: state.document.edges.map((edge) =>
          edge.id === action.edgeId ? { ...edge, label: action.label } : edge,
        ),
      });
    case "delete-selected": {
      if (!state.selectedElementId) return state;
      const selectedId = state.selectedElementId;
      return commit(
        state,
        {
          ...state.document,
          nodes: state.document.nodes.filter((node) => node.id !== selectedId),
          edges: state.document.edges.filter(
            (edge) =>
              edge.id !== selectedId &&
              edge.from.nodeId !== selectedId &&
              edge.to.nodeId !== selectedId,
          ),
        },
        null,
      );
    }
    case "clear":
      return commit(state, { ...state.document, nodes: [], edges: [] }, null);
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        document: { ...cloneSketchpadDocument(previous), revision: state.document.revision + 1 },
        past: state.past.slice(0, -1),
        future: [cloneSketchpadDocument(state.document), ...state.future].slice(0, HISTORY_LIMIT),
        selectedElementId: null,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        document: { ...cloneSketchpadDocument(next), revision: state.document.revision + 1 },
        past: [...state.past, cloneSketchpadDocument(state.document)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selectedElementId: null,
      };
    }
  }
}
