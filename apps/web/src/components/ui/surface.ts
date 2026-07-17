// FILE: surface.ts
// Purpose: Canonical structural surface recipes for the application shell.
// Layer: Shared UI styling helper

/** Flat application canvas. Never receives persistent elevation. */
export const CANVAS_SURFACE_CLASS_NAME = "bg-background text-foreground";

/** The single persistent elevated role: opaque panel, real border, no shadow. */
export const PANEL_SURFACE_CLASS_NAME =
  "overflow-hidden rounded-xl border border-panel-border bg-panel text-foreground shadow-none";

/** Hairline used only to separate sections inside a persistent panel. */
export const PANEL_SECTION_DIVIDER_CLASS_NAME = "border-panel-border";

/** Inset content well used by diffs, code, and grouped content inside a panel. */
export const INSET_WELL_SURFACE_CLASS_NAME =
  "overflow-hidden rounded-[11px] border border-panel-border bg-[var(--well)]";

/** Transient elevation role. Shadows are reserved for overlays only. */
export const OVERLAY_SURFACE_CLASS_NAME =
  "overflow-hidden rounded-xl border border-panel-border bg-panel text-foreground shadow-[0_16px_44px_rgba(0,0,0,0.5)]";
