// FILE: appTypography.ts
// Purpose: The app's single type scale — four steps, no drift.
// Layer: Shared UI styling helper
// Exports: The blueprint scale and the role aliases that map onto it.

import {
  DEFAULT_CHAT_FONT_SIZE_PX,
  MAX_CHAT_FONT_SIZE_PX,
  normalizeChatFontSizePx,
} from "../appSettings";

/* ─── The scale ───────────────────────────────────────────────────────────────
   Four sizes, and only four: 12 / 13 / 14 / 24 at the default base.

     caption   12px  meta, timestamps, badges, counts
     secondary 13px  dense rows, code, supporting labels
     body      14px  the default — every primary UI string and chat message
     title     24px  page and dialog headings

   This replaced a multiplicative ladder (base * 0.72 … base * 1.08) that emitted
   seven distinct UI sizes — 11, 11, 11, 12, 12, 13, 14, 15 — most of them a single
   pixel apart and therefore invisible as hierarchy but very visible as sloppiness.
   Steps are now fixed OFFSETS from the base rather than ratios, so the blueprint
   lands exactly on 12/13/14/24 at the default and the gaps stay legible (never
   collapsing to 0px) when a user rescales the base. */
const CAPTION_OFFSET_PX = -2;
const SECONDARY_OFFSET_PX = -1;
const TITLE_OFFSET_PX = 10;
const MIN_TYPOGRAPHY_PX = 10;

export interface AppTypographyScale {
  /** The user-controlled anchor. `body` is this value verbatim. */
  basePx: number;

  // ── The four blueprint steps ──
  captionPx: number;
  secondaryPx: number;
  bodyPx: number;
  titlePx: number;

  /* ── Role aliases ──
     Named for where they are used, valued from the four steps above. Call sites
     keep asking for the role they mean; the scale decides what that costs in
     pixels, so a size can never drift on its own. */
  uiPx: number;
  uiLgPx: number;
  uiSmPx: number;
  uiXsPx: number;
  ui2XsPx: number;
  uiMetaPx: number;
  uiTimestampPx: number;
  chatPx: number;
  chatCodePx: number;
  chatMetaPx: number;
  chatTinyPx: number;
}

function clampTypographyPx(value: number): number {
  return Math.min(MAX_CHAT_FONT_SIZE_PX + TITLE_OFFSET_PX, Math.max(MIN_TYPOGRAPHY_PX, value));
}

export function getAppTypographyScale(
  baseFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): AppTypographyScale {
  const basePx = normalizeChatFontSizePx(baseFontSizePx);

  const captionPx = clampTypographyPx(basePx + CAPTION_OFFSET_PX);
  const secondaryPx = clampTypographyPx(basePx + SECONDARY_OFFSET_PX);
  const bodyPx = clampTypographyPx(basePx);
  const titlePx = clampTypographyPx(basePx + TITLE_OFFSET_PX);

  return {
    basePx,

    captionPx,
    secondaryPx,
    bodyPx,
    titlePx,

    // Body — primary UI text and chat messages.
    uiPx: bodyPx,
    // `lg` predates the four-step scale and used to sit at base * 1.08 (15px). There
    // is nothing between body and title in this system, so the large button resolves
    // to body and reads as scale through its height and padding instead.
    uiLgPx: bodyPx,
    chatPx: bodyPx,

    // Secondary — dense rows and code.
    uiSmPx: secondaryPx,
    chatCodePx: secondaryPx,

    // Caption — meta, timestamps, counts.
    uiXsPx: captionPx,
    ui2XsPx: captionPx,
    uiMetaPx: captionPx,
    uiTimestampPx: captionPx,
    chatMetaPx: captionPx,
    chatTinyPx: captionPx,
  };
}
