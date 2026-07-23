// FILE: useMeasuredHeight.ts
// Purpose: Track an element's rendered height via ResizeObserver.
// Layer: Web UI hook
// Exports: useMeasuredHeight

import { useCallback, useRef, useState } from "react";

/**
 * Returns the element's current height and the callback ref to attach.
 *
 * Used where a floating element overlaps a scrolling surface and that surface has
 * to reserve matching room — the height is only knowable after layout, so it has
 * to be measured rather than assumed.
 */
export function useMeasuredHeight(): [number, (element: HTMLElement | null) => void] {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const measure = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) {
      setHeight(0);
      return;
    }

    const update = () => setHeight(Math.ceil(element.getBoundingClientRect().height));
    update();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(update);
    observer.observe(element);
    observerRef.current = observer;
    // React invokes a callback ref with null on unmount (and re-attaches if the node
    // changes), so the disconnect above is the single teardown path.
  }, []);

  return [height, measure];
}
