// FILE: typography.ts
// Purpose: Canonical text recipes — the counterpart to surface.ts for type.
// Layer: Shared UI styling helper

/* Titles and descriptions were being spelled out at each overlay primitive, which
   produced four different recipes for one role: `text-lg leading-tight`,
   `text-xl leading-none`, `text-lg leading-none`, `text-xl`. A dialog title and a
   card title are the same thing and must look it, so the recipe lives here and
   the primitives import it.

   All of these use the ink ladder and the four-step scale — see theme.logic.ts
   and lib/appTypography.ts. Weight is the only emphasis tool: there is no size
   between body and the display step. */

/** Titles on overlays and cards: dialogs, sheets, popovers, panels, empty states. */
export const SURFACE_TITLE_CLASS_NAME = "font-medium text-base leading-tight text-foreground";

/** The display step. Page heroes and landing headlines only — never a dialog. */
export const PAGE_TITLE_CLASS_NAME = "font-medium text-2xl leading-tight text-foreground";

/** Supporting copy under a title. */
export const SURFACE_DESCRIPTION_CLASS_NAME = "text-sm leading-snug text-muted-foreground";

/** Metadata: timestamps, counts, hints. The quietest rung of the ladder. */
export const META_TEXT_CLASS_NAME = "text-xs text-[var(--color-text-foreground-tertiary)]";
