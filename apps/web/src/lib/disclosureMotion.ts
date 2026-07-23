// FILE: disclosureMotion.ts
// Purpose: Shared open/close motion tokens for collapsible UI (sidebar lists, transcript panels, etc.).
// Layer: Web UI motion primitive
// Exports: class-name helpers + Collapsible panel tokens
// Why: Sidebar project/thread expand and chat disclosures reused the same grid/opacity
//      timing in multiple places; centralize it so new expand/collapse surfaces stay consistent.

import { cn } from "~/lib/utils";

/** Shell grid that animates height via grid-template-rows + fade. */
export const DISCLOSURE_SHELL_MOTION_CLASS =
  "grid transition-[grid-template-rows,opacity] duration-disclosure ease-out motion-reduce:transition-none";

export const DISCLOSURE_SHELL_OPEN_CLASS = "grid-rows-[1fr] opacity-100";
export const DISCLOSURE_SHELL_CLOSED_CLASS = "grid-rows-[0fr] opacity-0";

/** Required inner wrapper so grid-row collapse measures correctly. */
export const DISCLOSURE_INNER_CLASS = "min-h-0 overflow-hidden";

/** Optional content drift/fade layered on top of the shell animation.
 *  Names `translate`, NOT `transform`: the open/closed classes below drift via
 *  `translate-y-*`, which Tailwind v4 compiles to the standalone `translate:` property.
 *  `transition-property: transform` does not cover it, so the drift used to snap while
 *  only the opacity faded. */
export const DISCLOSURE_CONTENT_MOTION_CLASS =
  "transition-[opacity,translate] duration-disclosure ease-out motion-reduce:transition-none";

export const DISCLOSURE_CONTENT_OPEN_CLASS = "translate-y-0 opacity-100";
export const DISCLOSURE_CONTENT_CLOSED_CLASS = "-translate-y-1 opacity-0 pointer-events-none";

/** Chevron rotation paired with the shell motion. */
export const DISCLOSURE_CHEVRON_MOTION_CLASS =
  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-disclosure ease-out motion-reduce:transition-none";

/** Base-ui Collapsible panel height animation using the same timing curve. */
export const DISCLOSURE_COLLAPSIBLE_PANEL_CLASS =
  "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-disclosure ease-out motion-reduce:transition-none data-ending-style:h-0 data-starting-style:h-0 data-open:data-ending-style:[height:var(--collapsible-panel-height)]";

/**
 * Inline-axis (width) reveal for side panels that open/close along the
 * horizontal axis. Same timing curve as the vertical disclosures so every
 * toggle in the app stays consistent. Pair `open ? openWidthClassName : "w-0"`.
 */
export const DISCLOSURE_WIDTH_MOTION_CLASS =
  "overflow-hidden transition-[width] duration-disclosure ease-out motion-reduce:transition-none";

/**
 * Inline-axis slide for a panel that peeks in over content rather than pushing
 * it — the collapsed-sidebar edge peek. Same timing curve as every other
 * open/close in the app, so a peek feels like the rest of the chrome.
 *
 * Translation, not `left`/`width`: the panel keeps its laid-out geometry, so
 * nothing reflows behind it and the slide stays on the compositor.
 */
export const DISCLOSURE_PEEK_MOTION_CLASS =
  "transition-[translate] duration-disclosure ease-out motion-reduce:transition-none";

/**
 * At rest the panel sits wherever layout put it — for the collapsed sidebar,
 * off-canvas. Peeking translates it back into view, so `peekedTranslateClassName`
 * is the visible state and the resting state is no translation at all.
 */
/**
 * Fade + scale for something that appears or disappears in place rather than
 * pushing layout — the icon a collapsed composer leaves behind. Same timing
 * curve as every other toggle, so it reads as part of the same motion system.
 */
export const DISCLOSURE_POP_MOTION_CLASS =
  "transition-[opacity,scale] duration-disclosure ease-out motion-reduce:transition-none";

export function disclosurePopClassName(shown: boolean, className?: string) {
  return cn(
    DISCLOSURE_POP_MOTION_CLASS,
    shown ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0",
    className,
  );
}

export function disclosurePeekClassName(
  peeking: boolean,
  peekedTranslateClassName: string,
  className?: string,
) {
  return cn(
    DISCLOSURE_PEEK_MOTION_CLASS,
    peeking ? peekedTranslateClassName : "translate-x-0",
    className,
  );
}

export function disclosureWidthClassName(
  open: boolean,
  openWidthClassName: string,
  className?: string,
) {
  return cn(DISCLOSURE_WIDTH_MOTION_CLASS, open ? openWidthClassName : "w-0", className);
}

export function disclosureShellClassName(open: boolean, className?: string) {
  return cn(
    DISCLOSURE_SHELL_MOTION_CLASS,
    open ? DISCLOSURE_SHELL_OPEN_CLASS : DISCLOSURE_SHELL_CLOSED_CLASS,
    className,
  );
}

export function disclosureContentClassName(open: boolean, className?: string) {
  return cn(
    DISCLOSURE_CONTENT_MOTION_CLASS,
    open ? DISCLOSURE_CONTENT_OPEN_CLASS : DISCLOSURE_CONTENT_CLOSED_CLASS,
    className,
  );
}

export function disclosureChevronClassName(open: boolean, className?: string) {
  return cn(DISCLOSURE_CHEVRON_MOTION_CLASS, open && "rotate-90", className);
}
