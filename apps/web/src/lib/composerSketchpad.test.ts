import { describe, expect, it } from "vitest";

import {
  SKETCHPAD_MAX_ELEMENTS,
  SKETCHPAD_MAX_POINTS_PER_STROKE,
  SKETCHPAD_MAX_TEXT_CHARS,
  createEmptySketchpadDocument,
  normalizeSketchpadDocument,
  serializeSketchpadContext,
  sketchpadReadingOrder,
  type SketchpadDocument,
} from "./composerSketchpad";

const documentFixture = (): SketchpadDocument => ({
  version: 1,
  revision: 3,
  nodes: [
    {
      id: "database",
      kind: "shape",
      shape: "ellipse",
      label: "SQLite",
      frame: { x: 300, y: 120, width: 140, height: 80 },
      author: "user",
    },
    {
      id: "request",
      kind: "note",
      text: "Current <request>",
      frame: { x: 20, y: 20, width: 180, height: 100 },
      author: "user",
    },
    {
      id: "client",
      kind: "shape",
      shape: "rectangle",
      label: "Web client",
      frame: { x: 20, y: 120, width: 160, height: 80 },
      author: "user",
    },
    {
      id: "stroke",
      kind: "stroke",
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 30 },
      ],
      frame: { x: 10, y: 10, width: 10, height: 20 },
      author: "user",
    },
  ],
  edges: [
    {
      id: "edge",
      kind: "arrow",
      from: { nodeId: "client", anchor: { x: 1, y: 0.5 } },
      to: { nodeId: "database", anchor: { x: 0, y: 0.5 } },
      label: "persists state",
      author: "user",
    },
  ],
});

describe("composerSketchpad", () => {
  it("creates a versioned empty document and rejects unknown versions", () => {
    expect(createEmptySketchpadDocument()).toEqual({
      version: 1,
      revision: 0,
      nodes: [],
      edges: [],
    });
    expect(
      normalizeSketchpadDocument({ version: 2, revision: 0, nodes: [], edges: [] }),
    ).toBeNull();
  });

  it("drops malformed and dangling elements while enforcing the total cap", () => {
    const document = documentFixture();
    const normalized = normalizeSketchpadDocument({
      ...document,
      nodes: [
        ...Array.from({ length: SKETCHPAD_MAX_ELEMENTS + 5 }, (_, index) => ({
          id: `note-${index}`,
          kind: "note",
          text: "ok",
          frame: { x: index, y: 0, width: 100, height: 80 },
          author: "user",
        })),
        { id: "broken", kind: "note", frame: null },
      ],
      edges: document.edges,
    });
    expect(normalized?.nodes).toHaveLength(SKETCHPAD_MAX_ELEMENTS);
    expect(normalized?.edges).toHaveLength(0);
  });

  it("caps node text and freehand points and rejects oversized serialized input", () => {
    const normalized = normalizeSketchpadDocument({
      version: 1,
      revision: 1,
      nodes: [
        {
          id: "long-note",
          kind: "note",
          text: "x".repeat(SKETCHPAD_MAX_TEXT_CHARS + 100),
          frame: { x: 0, y: 0, width: 100, height: 80 },
          author: "user",
        },
        {
          id: "long-stroke",
          kind: "stroke",
          points: Array.from({ length: SKETCHPAD_MAX_POINTS_PER_STROKE + 100 }, (_, index) => ({
            x: index,
            y: index,
          })),
          frame: { x: 0, y: 0, width: 100, height: 80 },
          author: "user",
        },
      ],
      edges: [],
    });
    expect(normalized?.nodes[0]).toMatchObject({ text: "x".repeat(SKETCHPAD_MAX_TEXT_CHARS) });
    expect(normalized?.nodes[1]).toMatchObject({
      points: expect.arrayContaining([{ x: 0, y: 0 }]),
    });
    expect(normalized?.nodes[1]?.kind === "stroke" ? normalized.nodes[1].points : []).toHaveLength(
      SKETCHPAD_MAX_POINTS_PER_STROKE,
    );
    expect(
      normalizeSketchpadDocument({
        version: 1,
        revision: 1,
        nodes: [],
        edges: [],
        padding: "x".repeat(512 * 1024),
      }),
    ).toBeNull();
  });

  it("uses deterministic top-to-bottom, left-to-right reading order", () => {
    expect(sketchpadReadingOrder(documentFixture()).map((node) => node.id)).toEqual([
      "request",
      "client",
      "database",
    ]);
  });

  it("serializes semantic context without raw points or markup injection", () => {
    const context = serializeSketchpadContext(documentFixture());
    expect(context).toContain("1. [note] Current &lt;request&gt;");
    expect(context).toContain("Web client -> SQLite: persists state");
    expect(context).toContain("Freehand strokes: 1");
    expect(context).not.toContain('"points"');
    expect(serializeSketchpadContext(documentFixture())).toBe(context);
  });

  it("fails rather than silently truncating semantic context", () => {
    const oversizedContext: SketchpadDocument = {
      version: 1,
      revision: 1,
      nodes: Array.from({ length: 20 }, (_, index) => ({
        id: `note-${index}`,
        kind: "note" as const,
        text: `${index}-${"x".repeat(1_000)}`,
        frame: { x: 0, y: index * 100, width: 160, height: 80 },
        author: "user" as const,
      })),
      edges: [],
    };
    expect(() => serializeSketchpadContext(oversizedContext)).toThrow("too large to send");
  });
});
