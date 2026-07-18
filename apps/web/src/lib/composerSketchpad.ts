// FILE: composerSketchpad.ts
// Purpose: Define, sanitize, and serialize the canonical composer sketchpad document.
// Layer: Web composer domain logic
// Depends on: Effect Schema for persisted draft validation.

import * as Schema from "effect/Schema";

export const SKETCHPAD_DOCUMENT_VERSION = 1 as const;
export const SKETCHPAD_MAX_ELEMENTS = 200;
export const SKETCHPAD_MAX_POINTS_PER_STROKE = 512;
export const SKETCHPAD_MAX_TEXT_CHARS = 2_000;
export const SKETCHPAD_MAX_SERIALIZED_BYTES = 512 * 1024;
export const SKETCHPAD_MAX_CONTEXT_CHARS = 12_000;

const SKETCHPAD_MAX_COORDINATE = 100_000;
const SKETCHPAD_MAX_FRAME_SIZE = 10_000;
const SKETCHPAD_MIN_FRAME_SIZE = 8;

export interface SketchpadPoint {
  x: number;
  y: number;
}

export interface SketchpadFrame extends SketchpadPoint {
  width: number;
  height: number;
}

export type SketchpadAuthor = "user" | "agent";

export type SketchpadNode =
  | {
      id: string;
      kind: "note";
      text: string;
      frame: SketchpadFrame;
      author: SketchpadAuthor;
    }
  | {
      id: string;
      kind: "shape";
      shape: "rectangle" | "ellipse" | "diamond";
      label: string;
      frame: SketchpadFrame;
      author: SketchpadAuthor;
    }
  | {
      id: string;
      kind: "stroke";
      points: SketchpadPoint[];
      frame: SketchpadFrame;
      author: SketchpadAuthor;
    };

export interface SketchpadEdgeEndpoint {
  nodeId: string;
  /** Normalized position within the bound node frame. */
  anchor: SketchpadPoint;
}

export interface SketchpadEdge {
  id: string;
  kind: "arrow";
  from: SketchpadEdgeEndpoint;
  to: SketchpadEdgeEndpoint;
  label: string;
  author: SketchpadAuthor;
}

export interface SketchpadDocument {
  version: typeof SKETCHPAD_DOCUMENT_VERSION;
  revision: number;
  nodes: SketchpadNode[];
  edges: SketchpadEdge[];
}

const SketchpadPointSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

const SketchpadFrameSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

const SketchpadAuthorSchema = Schema.Literals(["user", "agent"]);

const SketchpadNoteNodeSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("note"),
  text: Schema.String,
  frame: SketchpadFrameSchema,
  author: SketchpadAuthorSchema,
});

const SketchpadShapeNodeSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("shape"),
  shape: Schema.Literals(["rectangle", "ellipse", "diamond"]),
  label: Schema.String,
  frame: SketchpadFrameSchema,
  author: SketchpadAuthorSchema,
});

const SketchpadStrokeNodeSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("stroke"),
  points: Schema.Array(SketchpadPointSchema),
  frame: SketchpadFrameSchema,
  author: SketchpadAuthorSchema,
});

export const SketchpadNodeSchema = Schema.Union([
  SketchpadNoteNodeSchema,
  SketchpadShapeNodeSchema,
  SketchpadStrokeNodeSchema,
]);

export const SketchpadEdgeSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("arrow"),
  from: Schema.Struct({ nodeId: Schema.String, anchor: SketchpadPointSchema }),
  to: Schema.Struct({ nodeId: Schema.String, anchor: SketchpadPointSchema }),
  label: Schema.String,
  author: SketchpadAuthorSchema,
});

export const SketchpadDocumentSchema = Schema.Struct({
  version: Schema.Literal(SKETCHPAD_DOCUMENT_VERSION),
  revision: Schema.Number,
  nodes: Schema.Array(SketchpadNodeSchema),
  edges: Schema.Array(SketchpadEdgeSchema),
});

type DecodedSketchpadDocument = Schema.Schema.Type<typeof SketchpadDocumentSchema>;

export function createEmptySketchpadDocument(): SketchpadDocument {
  return { version: SKETCHPAD_DOCUMENT_VERSION, revision: 0, nodes: [], edges: [] };
}

export function cloneSketchpadDocument(
  document: SketchpadDocument | DecodedSketchpadDocument,
): SketchpadDocument {
  return {
    version: SKETCHPAD_DOCUMENT_VERSION,
    revision: document.revision,
    nodes: document.nodes.map((node) =>
      node.kind === "stroke"
        ? {
            ...node,
            frame: { ...node.frame },
            points: node.points.map((point) => ({ ...point })),
          }
        : { ...node, frame: { ...node.frame } },
    ),
    edges: document.edges.map((edge) => ({
      ...edge,
      from: { nodeId: edge.from.nodeId, anchor: { ...edge.from.anchor } },
      to: { nodeId: edge.to.nodeId, anchor: { ...edge.to.anchor } },
    })),
  };
}

export function hasSketchpadContent(
  document: SketchpadDocument | null | undefined,
): document is SketchpadDocument {
  return Boolean(document && document.nodes.length + document.edges.length > 0);
}

export function sketchpadElementCount(document: SketchpadDocument | null | undefined): number {
  return document ? document.nodes.length + document.edges.length : 0;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizePoint(value: unknown, normalized = false): SketchpadPoint | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const x = finiteNumber(candidate.x);
  const y = finiteNumber(candidate.y);
  if (x === null || y === null) return null;
  const limit = normalized ? 1 : SKETCHPAD_MAX_COORDINATE;
  const minimum = normalized ? 0 : -SKETCHPAD_MAX_COORDINATE;
  return { x: clamp(x, minimum, limit), y: clamp(y, minimum, limit) };
}

function normalizeFrame(value: unknown): SketchpadFrame | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const point = normalizePoint(candidate);
  const width = finiteNumber(candidate.width);
  const height = finiteNumber(candidate.height);
  if (!point || width === null || height === null || width <= 0 || height <= 0) return null;
  return {
    ...point,
    width: clamp(width, SKETCHPAD_MIN_FRAME_SIZE, SKETCHPAD_MAX_FRAME_SIZE),
    height: clamp(height, SKETCHPAD_MIN_FRAME_SIZE, SKETCHPAD_MAX_FRAME_SIZE),
  };
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 && id.length <= 128 ? id : null;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, SKETCHPAD_MAX_TEXT_CHARS) : "";
}

function normalizeAuthor(value: unknown): SketchpadAuthor {
  return value === "agent" ? "agent" : "user";
}

function normalizeNode(value: unknown): SketchpadNode | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = normalizeId(candidate.id);
  const frame = normalizeFrame(candidate.frame);
  if (!id || !frame) return null;
  const author = normalizeAuthor(candidate.author);
  if (candidate.kind === "note") {
    return { id, kind: "note", text: normalizeText(candidate.text), frame, author };
  }
  if (
    candidate.kind === "shape" &&
    (candidate.shape === "rectangle" ||
      candidate.shape === "ellipse" ||
      candidate.shape === "diamond")
  ) {
    return {
      id,
      kind: "shape",
      shape: candidate.shape,
      label: normalizeText(candidate.label),
      frame,
      author,
    };
  }
  if (candidate.kind === "stroke" && Array.isArray(candidate.points)) {
    const points = candidate.points.slice(0, SKETCHPAD_MAX_POINTS_PER_STROKE).flatMap((point) => {
      const normalized = normalizePoint(point);
      return normalized ? [normalized] : [];
    });
    if (points.length < 2) return null;
    return { id, kind: "stroke", points, frame, author };
  }
  return null;
}

function normalizeEdge(value: unknown, nodeIds: ReadonlySet<string>): SketchpadEdge | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = normalizeId(candidate.id);
  if (!id || candidate.kind !== "arrow") return null;
  const normalizeEndpoint = (endpoint: unknown): SketchpadEdgeEndpoint | null => {
    if (!endpoint || typeof endpoint !== "object") return null;
    const endpointCandidate = endpoint as Record<string, unknown>;
    const nodeId = normalizeId(endpointCandidate.nodeId);
    const anchor = normalizePoint(endpointCandidate.anchor, true);
    return nodeId && nodeIds.has(nodeId) && anchor ? { nodeId, anchor } : null;
  };
  const from = normalizeEndpoint(candidate.from);
  const to = normalizeEndpoint(candidate.to);
  if (!from || !to || from.nodeId === to.nodeId) return null;
  return {
    id,
    kind: "arrow",
    from,
    to,
    label: normalizeText(candidate.label),
    author: normalizeAuthor(candidate.author),
  };
}

/** Sanitizes persisted or externally supplied data. Invalid elements are dropped atomically. */
export function normalizeSketchpadDocument(value: unknown): SketchpadDocument | null {
  if (!value || typeof value !== "object") return null;
  try {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength > SKETCHPAD_MAX_SERIALIZED_BYTES
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== SKETCHPAD_DOCUMENT_VERSION) return null;
  const revision = finiteNumber(candidate.revision);
  if (revision === null || revision < 0) return null;

  const nodes: SketchpadNode[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(candidate.nodes)) {
    for (const valueNode of candidate.nodes) {
      if (nodes.length >= SKETCHPAD_MAX_ELEMENTS) break;
      const node = normalizeNode(valueNode);
      if (!node || seenIds.has(node.id)) continue;
      seenIds.add(node.id);
      nodes.push(node);
    }
  }

  const edges: SketchpadEdge[] = [];
  if (Array.isArray(candidate.edges)) {
    for (const valueEdge of candidate.edges) {
      if (nodes.length + edges.length >= SKETCHPAD_MAX_ELEMENTS) break;
      const edge = normalizeEdge(valueEdge, seenIds);
      if (!edge || seenIds.has(edge.id)) continue;
      seenIds.add(edge.id);
      edges.push(edge);
    }
  }

  return {
    version: SKETCHPAD_DOCUMENT_VERSION,
    revision: Math.floor(revision),
    nodes,
    edges,
  };
}

export function sketchpadReadingOrder(
  document: SketchpadDocument,
): Array<Exclude<SketchpadNode, { kind: "stroke" }>> {
  return document.nodes
    .filter((node): node is Exclude<SketchpadNode, { kind: "stroke" }> => node.kind !== "stroke")
    .toSorted((left, right) => {
      const vertical = left.frame.y - right.frame.y;
      return Math.abs(vertical) > 12
        ? vertical
        : left.frame.x - right.frame.x || left.id.localeCompare(right.id);
    });
}

function semanticNodeText(node: Exclude<SketchpadNode, { kind: "stroke" }>): string {
  const value = node.kind === "note" ? node.text : node.label;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0
    ? normalized
    : `Untitled ${node.kind === "note" ? "note" : node.shape}`;
}

function escapeSemanticText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function serializeSketchpadContext(document: SketchpadDocument): string {
  const normalized = normalizeSketchpadDocument(document);
  if (!normalized || !hasSketchpadContent(normalized)) {
    throw new Error("The sketchpad is empty or invalid.");
  }
  const nodesById = new Map(normalized.nodes.map((node) => [node.id, node]));
  const orderedNodes = sketchpadReadingOrder(normalized);
  const lines = [
    '<sketchpad_context version="1">',
    'The attached image "sketchpad.png" is the visual rendering of this sketch.',
  ];
  if (orderedNodes.length > 0) {
    lines.push("Reading order:");
    orderedNodes.forEach((node, index) => {
      const kind = node.kind === "shape" ? node.shape : node.kind;
      lines.push(`${index + 1}. [${kind}] ${escapeSemanticText(semanticNodeText(node))}`);
    });
  }
  if (normalized.edges.length > 0) {
    lines.push("Relationships:");
    for (const edge of normalized.edges) {
      const from = nodesById.get(edge.from.nodeId);
      const to = nodesById.get(edge.to.nodeId);
      if (!from || from.kind === "stroke") continue;
      if (!to || to.kind === "stroke") continue;
      const label = edge.label.replace(/\s+/gu, " ").trim();
      lines.push(
        `- ${escapeSemanticText(semanticNodeText(from))} -> ${escapeSemanticText(
          semanticNodeText(to),
        )}${label ? `: ${escapeSemanticText(label)}` : ""}`,
      );
    }
  }
  const strokeCount = normalized.nodes.filter((node) => node.kind === "stroke").length;
  if (strokeCount > 0) {
    lines.push(`Freehand strokes: ${strokeCount}; inspect the image for their visual meaning.`);
  }
  lines.push("</sketchpad_context>");
  const context = lines.join("\n");
  if (context.length > SKETCHPAD_MAX_CONTEXT_CHARS) {
    throw new Error("The sketchpad labels are too large to send. Shorten some labels and retry.");
  }
  return context;
}

export function appendSketchpadContextToPrompt(
  prompt: string,
  document: SketchpadDocument | null | undefined,
): string {
  const trimmedPrompt = prompt.trim();
  if (!hasSketchpadContent(document)) return trimmedPrompt;
  const block = serializeSketchpadContext(document);
  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${block}` : block;
}
