import {
  DEFAULT_CHAT_FONT_SIZE_PX,
  MAX_CHAT_FONT_SIZE_PX,
  normalizeChatFontSizePx,
} from "../appSettings";

export interface AppTypographyScale {
  basePx: number;
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

function clampTypographyPx(value: number, min: number, max = MAX_CHAT_FONT_SIZE_PX + 2): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function getAppTypographyScale(
  baseFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): AppTypographyScale {
  const basePx = normalizeChatFontSizePx(baseFontSizePx);

  return {
    basePx,
    uiPx: basePx,
    uiLgPx: clampTypographyPx(basePx * 1.08, basePx),
    uiSmPx: clampTypographyPx(basePx * 0.92, 11),
    uiXsPx: clampTypographyPx(basePx * 0.84, 11),
    ui2XsPx: clampTypographyPx(basePx * 0.76, 11),
    uiMetaPx: clampTypographyPx(basePx * 0.84, 11),
    uiTimestampPx: clampTypographyPx(basePx * 0.72, 11),
    chatPx: basePx,
    chatCodePx: clampTypographyPx(basePx * 0.95, 11),
    chatMetaPx: clampTypographyPx(basePx * 0.78, 11),
    chatTinyPx: clampTypographyPx(basePx * 0.72, 11),
  };
}
