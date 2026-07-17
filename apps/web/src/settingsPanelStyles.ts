// FILE: settingsPanelStyles.ts
// Purpose: Shared layout tokens for the settings content panel (page bg, bordered cards, rows).
// Layer: Settings UI styling
// Exports: border, surface, card, row, and inset list class names

import { SIDEBAR_SECTION_LABEL_CLASS_NAME } from "./sidebarRowStyles";
import { PANEL_SURFACE_CLASS_NAME } from "./components/ui/surface";

/** Shared 14px corner radius for settings cards and dropdown panels. */
export const SETTINGS_RADIUS_CLASS_NAME = "rounded-xl";

/** Select triggers, segmented chips, inputs, and menu options (one step above app defaults). */
export const SETTINGS_CONTROL_RADIUS_CLASS_NAME = "!rounded-[10px]";

/** Same border token as Button `outline` / `chrome-outline` variants. */
export const SETTINGS_CONTROL_BORDER_CLASS_NAME = "border border-[color:var(--color-border)]";

/** Main settings shell — the same flat canvas as chat. */
export const SETTINGS_PAGE_BACKGROUND_CLASS_NAME = "app-settings-surface";

/** Section label above a settings card — same tone as sidebar "Threads"/"Pinned". */
export const SETTINGS_SECTION_LABEL_CLASS_NAME = `px-2 py-1 ${SIDEBAR_SECTION_LABEL_CLASS_NAME}`;

/** Vertical rhythm between stacked settings groups in the content panel. */
export const SETTINGS_PANEL_SECTION_CLASS_NAME = "flex flex-col gap-1.5 not-first:mt-4";

/** Grouped settings card: one defined panel layer over the flat page canvas. */
export const SETTINGS_CARD_CLASS_NAME = PANEL_SURFACE_CLASS_NAME;

/** Row padding inside a settings card. */
export const SETTINGS_CARD_ROW_CLASS_NAME =
  "px-3 py-[var(--app-density-settings-row-padding-y,0.625rem)]";

/** Row title — same UI font/size as the description; weight and color differ. */
export const SETTINGS_CARD_ROW_TITLE_CLASS_NAME =
  "text-[length:var(--app-font-size-ui,14px)] font-medium text-foreground";

/** Row description — standard app UI typography. */
export const SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME =
  "text-[length:var(--app-font-size-ui,14px)] text-muted-foreground";

/** Divider between stacked rows inside one card. */
export const SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME = "border-t border-[color:var(--color-border)]";

/** Nested list/table inside a row (provider installs, updates, etc.). */
export const SETTINGS_INSET_LIST_CLASS_NAME = SETTINGS_CARD_CLASS_NAME;

/** Empty / placeholder blocks. */
export const SETTINGS_EMPTY_STATE_CLASS_NAME = [
  PANEL_SURFACE_CLASS_NAME,
  "border-dashed",
].join(" ");
