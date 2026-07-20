// FILE: composerMessageContext.ts
// Purpose: Own canonical composer metadata block ordering, display stripping, and edit reattachment.
// Layer: Web composer domain logic

import type { ComposerAssistantSelectionAttachment } from "~/composerDraftStore";
import {
  appendAssistantSelectionsToPrompt,
  extractTrailingAssistantSelections,
  type ParsedAssistantSelectionEntry,
} from "./assistantSelections";
import {
  appendPastedTextsToPrompt,
  extractTrailingPastedTexts,
  type ParsedPastedTextEntry,
  type PastedTextDraft,
} from "./composerPastedText";
import {
  appendFileCommentsToPrompt,
  extractTrailingFileComments,
  type FileCommentDraft,
  type ParsedFileCommentEntry,
} from "./fileComments";
import {
  appendTerminalContextsToPrompt,
  extractTrailingTerminalContexts,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  IMAGE_ONLY_VISIBLE_PLACEHOLDER,
  type ParsedTerminalContextEntry,
  type TerminalContextDraft,
} from "./terminalContext";

const TRAILING_SERIALIZED_COMPOSER_BLOCK_PATTERNS = [
  /\n*(<pasted_text>\n[\s\S]*?\n<\/pasted_text>)\s*$/u,
  /\n*(<file_comments>\n[\s\S]*?\n<\/file_comments>)\s*$/u,
  /\n*(<terminal_context>\n[\s\S]*?\n<\/terminal_context>)\s*$/u,
  /\n*(<assistant_selection>\n[\s\S]*?\n<\/assistant_selection>)\s*$/u,
] as const;

export interface DisplayedUserMessageState {
  visibleText: string;
  copyText: string;
  contextCount: number;
  previewTitle: string | null;
  contexts: ParsedTerminalContextEntry[];
  assistantSelections: ParsedAssistantSelectionEntry[];
  fileComments: ParsedFileCommentEntry[];
  pastedTexts: ParsedPastedTextEntry[];
}

export function appendComposerMessageContext(input: {
  prompt: string;
  assistantSelections: ReadonlyArray<ComposerAssistantSelectionAttachment>;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  fileComments: ReadonlyArray<FileCommentDraft>;
  pastedTexts: ReadonlyArray<PastedTextDraft>;
}): string {
  return appendPastedTextsToPrompt(
    appendFileCommentsToPrompt(
      appendTerminalContextsToPrompt(
        appendAssistantSelectionsToPrompt(input.prompt, input.assistantSelections),
        input.terminalContexts,
      ),
      input.fileComments,
    ),
    input.pastedTexts,
  );
}

export function appendOriginalComposerPromptBlocks(input: {
  editedPrompt: string;
  originalPrompt: string;
}): string {
  let remainingPrompt = input.originalPrompt;
  const originalBlocks: string[] = [];
  let strippedBlock = true;
  while (strippedBlock) {
    strippedBlock = false;
    for (const pattern of TRAILING_SERIALIZED_COMPOSER_BLOCK_PATTERNS) {
      const match = pattern.exec(remainingPrompt);
      const rawBlock = match?.[1];
      if (!match || !rawBlock) continue;
      originalBlocks.unshift(rawBlock.trim());
      remainingPrompt = remainingPrompt.slice(0, match.index).replace(/\n+$/u, "");
      strippedBlock = true;
      break;
    }
  }
  const editedPrompt = input.editedPrompt.trim();
  if (originalBlocks.length === 0) return editedPrompt;
  const serializedBlocks = originalBlocks.join("\n\n");
  return editedPrompt.length > 0 ? `${editedPrompt}\n\n${serializedBlocks}` : serializedBlocks;
}

export function deriveDisplayedUserMessageState(
  prompt: string,
  options?: { hideImageOnlyBootstrapPrompt?: boolean },
): DisplayedUserMessageState {
  const extractedPastedTexts = extractTrailingPastedTexts(prompt);
  const extractedFileComments = extractTrailingFileComments(extractedPastedTexts.promptText);
  const extractedContexts = extractTrailingTerminalContexts(extractedFileComments.promptText);
  const extractedAssistantSelections = extractTrailingAssistantSelections(
    extractedContexts.promptText,
  );
  const hidePrompt =
    options?.hideImageOnlyBootstrapPrompt === true &&
    extractedAssistantSelections.promptText.trim() === IMAGE_ONLY_BOOTSTRAP_PROMPT;
  return {
    visibleText: hidePrompt
      ? IMAGE_ONLY_VISIBLE_PLACEHOLDER
      : extractedAssistantSelections.promptText,
    copyText: hidePrompt ? "" : extractedAssistantSelections.promptText,
    contextCount: extractedContexts.contextCount,
    previewTitle: extractedContexts.previewTitle,
    contexts: extractedContexts.contexts,
    assistantSelections: extractedAssistantSelections.selections,
    fileComments: extractedFileComments.comments,
    pastedTexts: extractedPastedTexts.pastedTexts,
  };
}
