import { useEffect } from "react";
import { useAppSettings } from "../appSettings";
import { getAppTypographyScale } from "../lib/appTypography";

/* Only the four blueprint steps are written to the document. Every role name the
   app styles against (`--app-font-size-ui-meta`, `--app-font-size-chat-code`, …)
   is declared in index.css as an alias of one of these, so a role can never be
   given a size of its own — there is exactly one place that decides pixels. */
const TYPOGRAPHY_CSS_VARIABLES = [
  "--app-font-size-base",
  "--app-font-size-caption",
  "--app-font-size-secondary",
  "--app-font-size-body",
  "--app-font-size-title",
  "--app-font-size-terminal",
] as const;

export function useAppTypography() {
  const { settings } = useAppSettings();

  useEffect(() => {
    const scale = getAppTypographyScale(settings.chatFontSizePx);
    const rootStyle = document.documentElement.style;
    const variableValues: Record<(typeof TYPOGRAPHY_CSS_VARIABLES)[number], string> = {
      "--app-font-size-base": `${scale.basePx}px`,
      "--app-font-size-caption": `${scale.captionPx}px`,
      "--app-font-size-secondary": `${scale.secondaryPx}px`,
      "--app-font-size-body": `${scale.bodyPx}px`,
      "--app-font-size-title": `${scale.titlePx}px`,
      "--app-font-size-terminal": `${settings.terminalFontSizePx}px`,
    };

    for (const cssVariable of TYPOGRAPHY_CSS_VARIABLES) {
      rootStyle.setProperty(cssVariable, variableValues[cssVariable]);
    }

    return () => {
      for (const cssVariable of TYPOGRAPHY_CSS_VARIABLES) {
        rootStyle.removeProperty(cssVariable);
      }
    };
  }, [settings.chatFontSizePx, settings.terminalFontSizePx]);
}
