import { describe, expect, it } from "vitest";

import { SIDEBAR_PEEK, resolvePeekHideDelayMs, shouldDismissPeek } from "./sidebarPeek";

describe("resolvePeekHideDelayMs", () => {
  it("uses the plain leave delay once the panel has been up long enough", () => {
    const now = 10_000;
    expect(resolvePeekHideDelayMs({ shownAt: now - SIDEBAR_PEEK.minimumVisibleMs - 1, now })).toBe(
      SIDEBAR_PEEK.hideDelayMs,
    );
  });

  // Clipping the edge in passing must not open and close the panel in one flick.
  it("holds a freshly shown panel up for the rest of its minimum visible time", () => {
    const now = 10_000;
    expect(resolvePeekHideDelayMs({ shownAt: now, now })).toBe(SIDEBAR_PEEK.minimumVisibleMs);
    expect(resolvePeekHideDelayMs({ shownAt: now - 100, now })).toBe(
      SIDEBAR_PEEK.minimumVisibleMs - 100,
    );
  });

  it("never returns less than the leave delay", () => {
    const now = 10_000;
    const almostElapsed = now - (SIDEBAR_PEEK.minimumVisibleMs - 10);
    expect(resolvePeekHideDelayMs({ shownAt: almostElapsed, now })).toBe(SIDEBAR_PEEK.hideDelayMs);
  });

  it("falls back to the leave delay when nothing is shown", () => {
    expect(resolvePeekHideDelayMs({ shownAt: null, now: 10_000 })).toBe(SIDEBAR_PEEK.hideDelayMs);
  });
});

describe("shouldDismissPeek", () => {
  it("dismisses only when the pointer has left both the strip and the panel", () => {
    expect(
      shouldDismissPeek({ pointerInTrigger: false, pointerInPanel: false, pinnedOpen: false }),
    ).toBe(true);
    expect(
      shouldDismissPeek({ pointerInTrigger: true, pointerInPanel: false, pinnedOpen: false }),
    ).toBe(false);
    expect(
      shouldDismissPeek({ pointerInTrigger: false, pointerInPanel: true, pinnedOpen: false }),
    ).toBe(false);
  });

  // An open menu or inline form inside the panel must not vanish under the user.
  it("never dismisses while pinned open", () => {
    expect(
      shouldDismissPeek({ pointerInTrigger: false, pointerInPanel: false, pinnedOpen: true }),
    ).toBe(false);
  });
});
