// FILE: useSidebarEdgePeek.ts
// Purpose: Drive the collapsed-sidebar edge peek — open on edge hover, close on leave.
// Layer: Web UI hook
// Exports: useSidebarEdgePeek

import { useCallback, useEffect, useRef, useState } from "react";

import { SIDEBAR_PEEK, resolvePeekHideDelayMs, shouldDismissPeek } from "~/lib/sidebarPeek";

export interface SidebarEdgePeekHandles {
  /** True while the panel is peeked out over the content. */
  readonly peeking: boolean;
  /** True once the edge strip is armed — it should not render before then. */
  readonly armed: boolean;
  readonly triggerProps: {
    readonly onPointerEnter: () => void;
    readonly onPointerLeave: () => void;
  };
  readonly panelProps: {
    readonly onPointerEnter: () => void;
    readonly onPointerLeave: () => void;
  };
  /** Ref for the peeked panel, used to re-check hover the pointer never reported. */
  readonly panelRef: React.RefObject<HTMLDivElement | null>;
  /** Close immediately, e.g. after navigating from inside the peeked panel. */
  readonly dismiss: () => void;
}

export function useSidebarEdgePeek(input: {
  /** Peeking only makes sense while the sidebar is collapsed. */
  readonly enabled: boolean;
  /** Holds the panel open regardless of pointer position (menus, inline forms). */
  readonly pinnedOpen?: boolean;
}): SidebarEdgePeekHandles {
  const [peeking, setPeeking] = useState(false);
  const [armed, setArmed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shownAtRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const pointerInTriggerRef = useRef(false);
  const pointerInPanelRef = useRef(false);
  const pinnedOpenRef = useRef(input.pinnedOpen ?? false);
  pinnedOpenRef.current = input.pinnedOpen ?? false;

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    cancelHide();
    shownAtRef.current = null;
    pointerInTriggerRef.current = false;
    pointerInPanelRef.current = false;
    setPeeking(false);
  }, [cancelHide]);

  const scheduleHide = useCallback(() => {
    cancelHide();
    const delay = resolvePeekHideDelayMs({ shownAt: shownAtRef.current, now: Date.now() });
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      // Re-sample instead of trusting the leave event: the pointer may be back
      // inside the panel without having emitted an enter, which happens when the
      // panel animates out from under a stationary cursor.
      const hoveringPanel = panelRef.current?.matches(":hover") ?? false;
      if (hoveringPanel) pointerInPanelRef.current = true;
      if (
        shouldDismissPeek({
          pointerInTrigger: pointerInTriggerRef.current,
          pointerInPanel: pointerInPanelRef.current,
          pinnedOpen: pinnedOpenRef.current,
        })
      ) {
        close();
      }
    }, delay);
  }, [cancelHide, close]);

  const open = useCallback(() => {
    cancelHide();
    setPeeking((current) => {
      if (!current) shownAtRef.current = Date.now();
      return true;
    });
  }, [cancelHide]);

  // Arming is delayed so the collapse animation cannot immediately re-trigger the
  // peek under the pointer that just clicked the collapse control.
  useEffect(() => {
    if (!input.enabled) {
      setArmed(false);
      close();
      return;
    }
    const timer = window.setTimeout(() => setArmed(true), SIDEBAR_PEEK.armAfterCollapseMs);
    return () => window.clearTimeout(timer);
  }, [input.enabled, close]);

  // A backgrounded or hidden window never delivers the pointer-leave that would
  // close the panel, so it would still be peeked on return.
  useEffect(() => {
    if (!peeking) return;
    const dismissIfHidden = () => {
      if (document.visibilityState === "hidden") close();
    };
    window.addEventListener("blur", close);
    document.addEventListener("visibilitychange", dismissIfHidden);
    return () => {
      window.removeEventListener("blur", close);
      document.removeEventListener("visibilitychange", dismissIfHidden);
    };
  }, [peeking, close]);

  // A pinned panel that becomes unpinned while the pointer is elsewhere has no
  // pending timer to close it, because the pin suppressed the earlier one.
  useEffect(() => {
    if (peeking && !(input.pinnedOpen ?? false)) {
      if (!pointerInTriggerRef.current && !pointerInPanelRef.current) scheduleHide();
    }
  }, [input.pinnedOpen, peeking, scheduleHide]);

  useEffect(() => cancelHide, [cancelHide]);

  return {
    peeking,
    armed,
    panelRef,
    dismiss: close,
    triggerProps: {
      onPointerEnter: () => {
        pointerInTriggerRef.current = true;
        open();
      },
      onPointerLeave: () => {
        pointerInTriggerRef.current = false;
        scheduleHide();
      },
    },
    panelProps: {
      onPointerEnter: () => {
        pointerInPanelRef.current = true;
        cancelHide();
      },
      onPointerLeave: () => {
        pointerInPanelRef.current = false;
        scheduleHide();
      },
    },
  };
}
