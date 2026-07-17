// FILE: MessageTrail.tsx
// Purpose: Quiet, explicit previous/next navigation between sent messages.
// Layer: Chat transcript shell (presentation)
// Depends on: the existing active trail store and timeline scroll controller.

import { type MessageId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ChevronDownIcon, ChevronUpIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { type ActiveTrailStore, type MessageTrailItem } from "./messageTrail.logic";

interface MessageTrailProps {
  items: readonly MessageTrailItem[];
  /** Stable holder for current + visible highlights; only this control re-renders on change. */
  activeStore: ActiveTrailStore;
  onSelect: (messageId: MessageId) => void;
}

// Only render beside a transcript column with enough left gutter to avoid covering copy.
const MIN_PANE_WIDTH_PX = 864;

export function MessageTrail({ items, activeStore, onSelect }: MessageTrailProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [hasGutter, setHasGutter] = useState(false);
  const trailSnapshot = useSyncExternalStore(
    activeStore.subscribe,
    activeStore.get,
    activeStore.get,
  );
  const currentIndex = useMemo(() => {
    const directIndex = items.findIndex((item) => item.id === trailSnapshot.currentId);
    if (directIndex >= 0) return directIndex;
    const firstVisibleId = trailSnapshot.visibleIds[0];
    const visibleIndex = items.findIndex((item) => item.id === firstVisibleId);
    return visibleIndex >= 0 ? visibleIndex : 0;
  }, [items, trailSnapshot.currentId, trailSnapshot.visibleIds]);

  useEffect(() => {
    const pane = rootRef.current?.parentElement;
    if (!pane || typeof ResizeObserver === "undefined") return;

    let frameId: number | null = null;
    const measure = () => {
      frameId = null;
      setHasGutter(pane.clientWidth >= MIN_PANE_WIDTH_PX);
    };
    const scheduleMeasure = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(measure);
    };
    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(pane);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  const visible = hasGutter && items.length > 1;
  const previous = currentIndex > 0 ? items[currentIndex - 1] : undefined;
  const next = currentIndex < items.length - 1 ? items[currentIndex + 1] : undefined;

  return (
    <nav
      ref={rootRef}
      aria-label="Jump between sent messages"
      aria-hidden={!visible}
      data-message-jump-navigation="true"
      className={cn(
        "absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center rounded-lg border border-panel-border bg-panel p-0.5 text-muted-foreground transition-opacity duration-menu ease-out sm:flex motion-reduce:transition-none",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <button
        type="button"
        tabIndex={visible ? 0 : -1}
        disabled={!previous}
        aria-label={
          previous ? `Jump to previous message: ${previous.preview}` : "No previous message"
        }
        className="flex size-7 items-center justify-center rounded-md transition-[background-color,color,scale] duration-press ease-out hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-25 active:scale-[0.96] motion-reduce:active:scale-100"
        onClick={() => previous && onSelect(previous.id)}
      >
        <ChevronUpIcon className="size-3.5" />
      </button>
      <span
        aria-label={`Message ${currentIndex + 1} of ${items.length}`}
        className="min-w-7 py-0.5 text-center text-[11px] tabular-nums text-muted-foreground"
      >
        {currentIndex + 1}/{items.length}
      </span>
      <button
        type="button"
        tabIndex={visible ? 0 : -1}
        disabled={!next}
        aria-label={next ? `Jump to next message: ${next.preview}` : "No next message"}
        className="flex size-7 items-center justify-center rounded-md transition-[background-color,color,scale] duration-press ease-out hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-25 active:scale-[0.96] motion-reduce:active:scale-100"
        onClick={() => next && onSelect(next.id)}
      >
        <ChevronDownIcon className="size-3.5" />
      </button>
    </nav>
  );
}
