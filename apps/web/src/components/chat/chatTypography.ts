// FILE: chatTypography.ts
// Purpose: Centralizes transcript typography tokens shared by chat message renderers.
// Layer: Web chat presentation constants
// Exports: transcript measurement helpers and inline styles for chat text

import type { CSSProperties } from "react";
import { DEFAULT_CHAT_FONT_SIZE_PX } from "../../appSettings";
import { getAppTypographyScale } from "../../lib/appTypography";

export const USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME = "rounded-[var(--radius-user-message)]";
export const USER_MESSAGE_BUBBLE_SHELL_PADDING_CLASS_NAME = "py-2.5";
export const USER_MESSAGE_BUBBLE_SHELL_HORIZONTAL_PADDING_CLASS_NAME = "px-4";
export const USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME = [
  USER_MESSAGE_BUBBLE_SHELL_HORIZONTAL_PADDING_CLASS_NAME,
  USER_MESSAGE_BUBBLE_SHELL_PADDING_CLASS_NAME,
].join(" ");

/* ─── Transcript type ─────────────────────────────────────────────────────────
   The transcript is the most-read surface in the app, so it gets the plainest
   treatment: assistant and user messages are BOTH the body step, on ONE line
   height. Two things were quietly costing legibility here.

   1. Assistant text rendered at `base + 0.5px` — 14.5px at the default. A
      fractional font-size makes the rasterizer land glyph stems between device
      pixels, and on a non-Retina display that is the difference between crisp
      text and text that looks slightly smeared. Half a pixel also is not a size
      difference anyone can perceive as hierarchy, so it bought nothing.
   2. Assistant line-height was 1.65 and user 1.625 — a 0.4px difference that
      made the two bubbles fail to share a rhythm without ever looking
      deliberately different.

   Both are now one value. Line height stays generous (1.6) because transcript
   text is long-form and read top-to-bottom, unlike the dense UI chrome around
   it. Everything is rounded to whole pixels — see `buildChatTextStyle`. */
const CHAT_TRANSCRIPT_LINE_HEIGHT_RATIO = 1.6;

// Average glyph advance as a fraction of font size, used only to estimate how
// many characters fit on a line when the virtualizer pre-measures a row. SF Pro
// runs slightly narrower than the Inter this was tuned against.
const CHAT_TRANSCRIPT_CHAR_WIDTH_RATIO = 0.5;

function getTranscriptFontSizePx(chatFontSizePx: number): number {
  return getAppTypographyScale(chatFontSizePx).bodyPx;
}

export function getChatTranscriptLineHeightPx(chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX): number {
  return Math.round(getTranscriptFontSizePx(chatFontSizePx) * CHAT_TRANSCRIPT_LINE_HEIGHT_RATIO);
}

export function getChatTranscriptUserMessageLineHeightPx(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): number {
  return getChatTranscriptLineHeightPx(chatFontSizePx);
}

export function getChatTranscriptUserCharWidthPx(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): number {
  return getTranscriptFontSizePx(chatFontSizePx) * CHAT_TRANSCRIPT_CHAR_WIDTH_RATIO;
}

export function getChatTranscriptAssistantCharWidthPx(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): number {
  return getChatTranscriptUserCharWidthPx(chatFontSizePx);
}

// Whole pixels only: a fractional size or leading is what puts glyph stems and
// baselines between device pixels, which reads as soft text rather than as a
// smaller size.
function buildChatTextStyle(fontSizePx: number, lineHeightPx: number): CSSProperties {
  return {
    fontSize: `${Math.round(fontSizePx)}px`,
    lineHeight: `${Math.round(lineHeightPx)}px`,
  };
}

export function getChatTranscriptTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  return buildChatTextStyle(
    getTranscriptFontSizePx(chatFontSizePx),
    getChatTranscriptLineHeightPx(chatFontSizePx),
  );
}

export function getChatTranscriptUserMessageTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  return getChatTranscriptTextStyle(chatFontSizePx);
}

/** Timestamps and token counts under a message — the caption step. */
export function getChatMessageFooterTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  const captionPx = getAppTypographyScale(chatFontSizePx).captionPx;
  return buildChatTextStyle(captionPx, captionPx * CHAT_TRANSCRIPT_LINE_HEIGHT_RATIO);
}
