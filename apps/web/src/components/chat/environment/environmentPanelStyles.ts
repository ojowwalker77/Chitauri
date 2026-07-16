// FILE: environmentPanelStyles.ts
// Purpose: Shared Environment panel typography tokens. Section labels and the panel
//          title reuse the composer placeholder color so secondary chrome reads
//          consistently; the recap body uses a readable secondary tone since it is
//          content the user actually reads.
// Layer: Environment panel design tokens

import {
  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
  COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import { cn } from "~/lib/utils";

/** Panel title ("Environment") and section labels ("Editor", "Recap"). */
export const ENVIRONMENT_PANEL_LABEL_CLASS_NAME = cn(
  "font-normal",
  COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME,
);

/** Top-of-card title row. */
export const ENVIRONMENT_PANEL_TITLE_CLASS_NAME = cn(
  ENVIRONMENT_PANEL_LABEL_CLASS_NAME,
  "text-[length:var(--app-font-size-ui,14px)]",
);

/**
 * Section-heading typography without row padding — used inline inside the collapsible
 * section header (which owns the padding alongside its chevron).
 */
export const ENVIRONMENT_PANEL_SECTION_LABEL_INLINE_CLASS_NAME = cn(
  ENVIRONMENT_PANEL_LABEL_CLASS_NAME,
  "text-[length:var(--app-font-size-ui-sm,13px)] font-[550] uppercase tracking-[0.07em] text-muted-foreground",
);

/**
 * Section headings inside the card (standalone label row). Shares the collapsible-section
 * header's `px-2 py-1` box so static labels (e.g. "Repository", "Editor") line up on the same
 * vertical rhythm as the expand/collapse section headers.
 */
export const ENVIRONMENT_PANEL_SECTION_LABEL_CLASS_NAME = cn(
  ENVIRONMENT_PANEL_SECTION_LABEL_INLINE_CLASS_NAME,
  "px-2 py-1",
);

/**
 * Recap markdown — the recap is real content the user reads, not placeholder
 * chrome, so it uses the standard readable secondary tone (`text-muted-foreground`)
 * instead of the faint placeholder color, with strong text lifted to full foreground.
 */
export const ENVIRONMENT_PANEL_RECAP_MARKDOWN_CLASS_NAME = cn(
  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
  "!text-muted-foreground",
  "[&_strong]:font-medium [&_strong]:text-foreground",
  "[&_:not(pre)>code]:!text-muted-foreground",
  "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_ul]:my-1.5 [&_ol]:my-1.5",
  "[&_li]:my-0.5",
  "[&_pre]:my-2",
);
