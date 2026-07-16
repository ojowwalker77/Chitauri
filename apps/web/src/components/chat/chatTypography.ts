// FILE: chatTypography.ts
// Purpose: Centralizes transcript typography tokens shared by chat message renderers.
// Layer: Web chat presentation constants
// Exports: transcript measurement helpers and inline styles for chat text

import type { CSSProperties } from "react";
import {
  DEFAULT_CHAT_FONT_SIZE_PX,
  MAX_CHAT_FONT_SIZE_PX,
  normalizeChatFontSizePx,
} from "../../appSettings";

export const USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME = "rounded-[var(--radius-user-message)]";
export const USER_MESSAGE_BUBBLE_SHELL_PADDING_CLASS_NAME = "py-2.5";
export const USER_MESSAGE_BUBBLE_SHELL_HORIZONTAL_PADDING_CLASS_NAME = "px-4";
export const USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME = [
  USER_MESSAGE_BUBBLE_SHELL_HORIZONTAL_PADDING_CLASS_NAME,
  USER_MESSAGE_BUBBLE_SHELL_PADDING_CLASS_NAME,
].join(" ");

const CHAT_TRANSCRIPT_USER_CHAR_WIDTH_RATIO = 0.48;
const CHAT_TRANSCRIPT_ASSISTANT_CHAR_WIDTH_RATIO = 0.52;
const CHAT_TRANSCRIPT_ASSISTANT_FONT_OFFSET_PX = 0.5;
const CHAT_TRANSCRIPT_ASSISTANT_LINE_HEIGHT_RATIO = 1.65;
const CHAT_TRANSCRIPT_USER_LINE_HEIGHT_RATIO = 1.625;

function getChatTranscriptAssistantFontSizePx(chatFontSizePx: number): number {
  return Math.min(
    MAX_CHAT_FONT_SIZE_PX,
    normalizeChatFontSizePx(chatFontSizePx) + CHAT_TRANSCRIPT_ASSISTANT_FONT_OFFSET_PX,
  );
}

export function getChatTranscriptLineHeightPx(chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX): number {
  return (
    getChatTranscriptAssistantFontSizePx(chatFontSizePx) *
    CHAT_TRANSCRIPT_ASSISTANT_LINE_HEIGHT_RATIO
  );
}

export function getChatTranscriptUserMessageLineHeightPx(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): number {
  return normalizeChatFontSizePx(chatFontSizePx) * CHAT_TRANSCRIPT_USER_LINE_HEIGHT_RATIO;
}

export function getChatTranscriptUserCharWidthPx(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): number {
  return normalizeChatFontSizePx(chatFontSizePx) * CHAT_TRANSCRIPT_USER_CHAR_WIDTH_RATIO;
}

export function getChatTranscriptAssistantCharWidthPx(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): number {
  return (
    getChatTranscriptAssistantFontSizePx(chatFontSizePx) *
    CHAT_TRANSCRIPT_ASSISTANT_CHAR_WIDTH_RATIO
  );
}

function buildChatTextStyle(fontSizePx: number, lineHeightPx: number): CSSProperties {
  return {
    fontSize: `${fontSizePx}px`,
    lineHeight: `${lineHeightPx}px`,
  };
}

export function getChatTranscriptTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  const assistantFontSizePx = getChatTranscriptAssistantFontSizePx(chatFontSizePx);
  return buildChatTextStyle(
    assistantFontSizePx,
    assistantFontSizePx * CHAT_TRANSCRIPT_ASSISTANT_LINE_HEIGHT_RATIO,
  );
}

export function getChatTranscriptUserMessageTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  const normalizedChatFontSizePx = normalizeChatFontSizePx(chatFontSizePx);
  return buildChatTextStyle(
    normalizedChatFontSizePx,
    getChatTranscriptUserMessageLineHeightPx(normalizedChatFontSizePx),
  );
}

export function getChatMessageFooterTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  const normalizedChatFontSizePx = normalizeChatFontSizePx(chatFontSizePx);
  const footerFontSizePx = Math.max(11, normalizedChatFontSizePx - 2);
  return buildChatTextStyle(
    footerFontSizePx,
    footerFontSizePx * CHAT_TRANSCRIPT_USER_LINE_HEIGHT_RATIO,
  );
}
