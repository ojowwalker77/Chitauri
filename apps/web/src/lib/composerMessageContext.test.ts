import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { SketchpadDocument } from "./composerSketchpad";
import {
  appendComposerMessageContext,
  appendOriginalComposerPromptBlocks,
  deriveDisplayedUserMessageState,
} from "./composerMessageContext";

const sketchpad: SketchpadDocument = {
  version: 1,
  revision: 1,
  nodes: [
    {
      id: "n",
      kind: "note",
      text: "Flow",
      frame: { x: 0, y: 0, width: 100, height: 80 },
      author: "user",
    },
  ],
  edges: [],
};

describe("composerMessageContext", () => {
  it("appends and strips sketch context in the canonical outermost position", () => {
    const serialized = appendComposerMessageContext({
      prompt: "Build this",
      assistantSelections: [],
      terminalContexts: [],
      fileComments: [],
      pastedTexts: [],
      sketchpad,
    });
    expect(serialized).toContain("<sketchpad_context");
    expect(deriveDisplayedUserMessageState(serialized)).toMatchObject({
      visibleText: "Build this",
      copyText: "Build this",
      sketchpad: { version: 1 },
    });
  });

  it("round-trips every composer block in one canonical nesting order", () => {
    const serialized = appendComposerMessageContext({
      prompt: "Build this",
      assistantSelections: [
        {
          type: "assistant-selection",
          id: "selection",
          assistantMessageId: "assistant-message",
          text: "Selected answer",
        },
      ],
      terminalContexts: [
        {
          id: "terminal",
          threadId: ThreadId.makeUnsafe("thread-context-order"),
          terminalId: "default",
          terminalLabel: "Terminal",
          lineStart: 1,
          lineEnd: 1,
          text: "bun lint",
          createdAt: "2026-07-17T00:00:00.000Z",
        },
      ],
      fileComments: [
        {
          id: "comment",
          path: "src/app.ts",
          startLine: 1,
          endLine: 2,
          text: "Keep this typed.",
        },
      ],
      pastedTexts: [
        {
          id: "paste",
          text: "large pasted text",
          createdAt: "2026-07-17T00:00:00.000Z",
          lineCount: 1,
          charCount: 17,
        },
      ],
      sketchpad,
    });
    const blockNames = [
      "assistant_selection",
      "terminal_context",
      "file_comments",
      "pasted_text",
      "sketchpad_context",
    ];
    const blockPositions = blockNames.map((name) => serialized.indexOf(`<${name}`));
    expect(blockPositions).toEqual(blockPositions.toSorted((left, right) => left - right));
    expect(deriveDisplayedUserMessageState(serialized)).toMatchObject({
      visibleText: "Build this",
      copyText: "Build this",
      contextCount: 1,
      assistantSelections: [{ text: "Selected answer" }],
      fileComments: [{ text: "Keep this typed." }],
      pastedTexts: [{ text: "large pasted text" }],
      sketchpad: { version: 1 },
    });
  });

  it("reattaches sketch metadata after a visible-message edit", () => {
    const originalPrompt = appendComposerMessageContext({
      prompt: "Before",
      assistantSelections: [],
      terminalContexts: [],
      fileComments: [],
      pastedTexts: [],
      sketchpad,
    });
    const edited = appendOriginalComposerPromptBlocks({ editedPrompt: "After", originalPrompt });
    expect(edited.startsWith("After\n\n<sketchpad_context")).toBe(true);
    expect(deriveDisplayedUserMessageState(edited).visibleText).toBe("After");
  });
});
