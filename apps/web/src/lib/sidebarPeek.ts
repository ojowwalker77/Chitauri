// FILE: sidebarPeek.ts
// Purpose: Timing rules for the collapsed-sidebar edge peek.
// Layer: Web UI logic (pure, no I/O)
// Exports: SIDEBAR_PEEK constants, resolvePeekHideDelayMs, shouldDismissPeek
//
// Ported from the native implementation in phibrowser-mac
// (WebContentContainerViewController+FloatingSidebar.swift). The values are its
// values; the reasons below are why each one exists, since a hover-open panel is
// almost entirely made of edge cases.

export const SIDEBAR_PEEK = {
  /**
   * Width of the invisible strip that opens the peek. Narrow enough that it is
   * not in the way, wide enough that a fast pointer cannot skip past it between
   * mouse-move samples.
   */
  triggerWidthPx: 10,
  /**
   * Delay before closing after the pointer leaves. Absorbs the moment where the
   * pointer is technically outside both the strip and the panel — crossing the
   * gap between them would otherwise close it mid-travel.
   */
  hideDelayMs: 120,
  /**
   * Floor on how long the panel stays up once shown. Without it, clipping the
   * edge in passing opens and closes the panel in one flick, which reads as a
   * glitch rather than an affordance.
   */
  minimumVisibleMs: 500,
  /**
   * Delay before arming the strip after the sidebar collapses. The collapse
   * animation moves the sidebar out from under the pointer; arming immediately
   * re-triggers the peek from the pointer that just clicked the collapse button.
   */
  armAfterCollapseMs: 350,
} as const;

/**
 * How long to wait before closing, honouring both the leave delay and the
 * remaining minimum visible time — whichever is longer.
 *
 * `shownAt` null means the panel is not currently up, so only the leave delay
 * applies.
 */
export function resolvePeekHideDelayMs(input: {
  readonly shownAt: number | null;
  readonly now: number;
}): number {
  if (input.shownAt === null) return SIDEBAR_PEEK.hideDelayMs;
  const visibleFor = input.now - input.shownAt;
  const minimumRemaining = Math.max(0, SIDEBAR_PEEK.minimumVisibleMs - visibleFor);
  return Math.max(SIDEBAR_PEEK.hideDelayMs, minimumRemaining);
}

/**
 * Whether the peek should actually close when its timer fires.
 *
 * Re-checked at fire time rather than trusted from the leave event, because the
 * pointer may have come back — including into a region that never emits an
 * enter event, such as the panel appearing beneath a stationary cursor.
 */
export function shouldDismissPeek(input: {
  readonly pointerInTrigger: boolean;
  readonly pointerInPanel: boolean;
  /** True while a surface inside the panel must not be dismissed under the user. */
  readonly pinnedOpen: boolean;
}): boolean {
  if (input.pinnedOpen) return false;
  return !input.pointerInTrigger && !input.pointerInPanel;
}
