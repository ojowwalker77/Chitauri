// FILE: appBackgrounds.ts
// Purpose: Resolve the optional decorative canvas image behind the main chat view.
// Layer: Web shell chrome
// Exports: APP_BACKGROUND_LABELS, appBackgroundImageCss
// Why: The images are imported as URL modules, so Vite emits each as its own
//      hashed asset and the browser only fetches one once it is actually applied
//      as a background-image. Selecting "none" downloads nothing.

import londonUrl from "~/assets/backgrounds/london.webp";
import rioUrl from "~/assets/backgrounds/rio.webp";
import sfUrl from "~/assets/backgrounds/sf.webp";
import tokyoUrl from "~/assets/backgrounds/tokyo.webp";

import type { AppBackground } from "~/appSettings";

const APP_BACKGROUND_URLS: Record<Exclude<AppBackground, "none">, string> = {
  london: londonUrl,
  rio: rioUrl,
  sf: sfUrl,
  tokyo: tokyoUrl,
};

export const APP_BACKGROUND_LABELS: Record<AppBackground, string> = {
  none: "None",
  london: "London",
  rio: "Rio",
  sf: "San Francisco",
  tokyo: "Tokyo",
};

/**
 * The `background-image` value for the canvas, or `null` for the flat surface.
 *
 * A scrim of the theme background is layered over the photo so foreground text
 * keeps its contrast in both light and dark mode — the image is chrome, and
 * chrome must never win against content (Design.md §1).
 */
export function appBackgroundImageCss(background: AppBackground): string | null {
  if (background === "none") return null;
  const url = APP_BACKGROUND_URLS[background];
  const scrim = "color-mix(in srgb, var(--background) 86%, transparent)";
  return `linear-gradient(${scrim}, ${scrim}), url("${url}")`;
}
