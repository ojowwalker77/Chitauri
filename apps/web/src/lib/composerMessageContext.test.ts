import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  appendComposerMessageContext,
  appendOriginalComposerPromptBlocks,
  deriveDisplayedUserMessageState,
} from "./composerMessageContext";

describe("composerMessageContext", () => {
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
    });
    const blockNames = ["assistant_selection", "terminal_context", "file_comments", "pasted_text"];
    const blockPositions = blockNames.map((name) => serialized.indexOf(`<${name}`));
    expect(blockPositions).toEqual(blockPositions.toSorted((left, right) => left - right));
    expect(deriveDisplayedUserMessageState(serialized)).toMatchObject({
      visibleText: "Build this",
      copyText: "Build this",
      contextCount: 1,
      assistantSelections: [{ text: "Selected answer" }],
      fileComments: [{ text: "Keep this typed." }],
      pastedTexts: [{ text: "large pasted text" }],
    });
  });

  it("reattaches composer blocks after a visible-message edit", () => {
    const originalPrompt = appendComposerMessageContext({
      prompt: "Before",
      assistantSelections: [],
      terminalContexts: [],
      fileComments: [],
      pastedTexts: [
        {
          id: "paste",
          text: "large pasted text",
          createdAt: "2026-07-17T00:00:00.000Z",
          lineCount: 1,
          charCount: 17,
        },
      ],
    });
    const edited = appendOriginalComposerPromptBlocks({ editedPrompt: "After", originalPrompt });
    expect(edited.startsWith("After\n\n<pasted_text")).toBe(true);
    expect(deriveDisplayedUserMessageState(edited).visibleText).toBe("After");
  });
});
