// FILE: useWindowTransparency.ts
// Purpose: Publishes the window-transparency setting as a CSS variable on the root.
// Layer: Web appearance hook
// Exports: useWindowTransparency

import { useEffect } from "react";
import { normalizeWindowTransparency, useAppSettings } from "../appSettings";

const WINDOW_TRANSPARENCY_CSS_VARIABLE = "--app-window-transparency";

/**
 * The glass canvas reads `--app-window-transparency` as the share of the desktop
 * that shows through (see the liquid-glass block in index.css). It only has an
 * effect while the window material is translucent; on an opaque window the shell
 * paints a solid canvas and the variable is inert.
 */
export function useWindowTransparency() {
  const { settings } = useAppSettings();

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty(
      WINDOW_TRANSPARENCY_CSS_VARIABLE,
      `${normalizeWindowTransparency(settings.windowTransparency)}%`,
    );

    return () => {
      rootStyle.removeProperty(WINDOW_TRANSPARENCY_CSS_VARIABLE);
    };
  }, [settings.windowTransparency]);
}
