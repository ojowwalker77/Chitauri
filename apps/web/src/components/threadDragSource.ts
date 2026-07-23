// FILE: threadDragSource.ts
// Purpose: Make a sidebar Thread row draggable into the chat split, from one place.
// Layer: Web UI helper
// Exports: threadDragSourceProps

import type { DragEvent } from "react";
import type { ThreadId } from "@t3tools/contracts";

import { THREAD_DRAG_MIME } from "~/splitPaneStore";

/**
 * Drag props for a sidebar Thread row.
 *
 * Native HTML5 drag rather than the dnd-kit context the sidebar already uses for
 * reordering: this drag ends outside that context, on the chat surface, and
 * nesting a second sensor context inside the sortable one makes both fight for
 * the same pointer stream.
 */
export function threadDragSourceProps(threadId: ThreadId) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(THREAD_DRAG_MIME, threadId);
      // Some targets only ever see `text/plain`; carrying the id there too keeps
      // a drop onto an external editor or terminal meaningful rather than empty.
      event.dataTransfer.setData("text/plain", threadId);
      event.dataTransfer.effectAllowed = "move";
      // Stops the row's own drag from also being read as a sortable reorder.
      event.stopPropagation();
    },
  } as const;
}
