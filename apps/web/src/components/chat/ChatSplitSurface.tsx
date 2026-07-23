// FILE: ChatSplitSurface.tsx
// Purpose: Render the chat split — a pane tree, with drag-to-split drops.
// Layer: Chat presentation
// Exports: ChatSplitSurface

import type { ThreadId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import ChatView from "~/components/ChatView";
import { ProjectSurfaceFrame } from "~/components/ProjectSurfaceFrame";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { cn } from "~/lib/utils";
import { THREAD_DRAG_MIME, useSplitPaneStore } from "~/splitPaneStore";
import {
  adoptTreeForThread,
  resolveSplitDropZone,
  treePaneIds,
  type SplitDropZone,
  type SplitNode,
} from "~/splitPanes";
import {
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
  CHAT_SURFACE_TRANSPARENT_CLASS_NAME,
} from "./composerPickerStyles";

interface HoverState extends SplitDropZone {
  readonly threadId: ThreadId;
}

// Pointer position inside a pane, as ratios, which is what the drop rules take.
function paneRatios(event: React.DragEvent): { xRatio: number; yRatio: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    xRatio: bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5,
    yRatio: bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5,
  };
}

export function ChatSplitSurface({ routeThreadId }: { routeThreadId: ThreadId }) {
  const treesByThreadId = useSplitPaneStore((store) => store.treesByThreadId);
  const focusedThreadId = useSplitPaneStore((store) => store.focusedThreadId);
  const dropThread = useSplitPaneStore((store) => store.dropThread);
  const closePane = useSplitPaneStore((store) => store.closePane);
  const focusPane = useSplitPaneStore((store) => store.focusPane);
  const [hover, setHover] = useState<HoverState | null>(null);

  // Derived rather than held in state so the first paint after a reload already
  // shows the persisted split, with no frame of single pane.
  const tree = useMemo(
    () => adoptTreeForThread({ trees: treesByThreadId, routeThreadId }),
    [treesByThreadId, routeThreadId],
  );
  const paneIds = useMemo(() => treePaneIds(tree), [tree]);
  const split = paneIds.length > 1;

  const handleDragOver = useCallback((threadId: ThreadId, event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(THREAD_DRAG_MIME)) return;
    // Claiming the event is what makes the browser show a drop cursor at all.
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setHover({ threadId, ...resolveSplitDropZone(paneRatios(event)) });
  }, []);

  const handleDrop = useCallback(
    (targetThreadId: ThreadId, event: React.DragEvent) => {
      const raw = event.dataTransfer.getData(THREAD_DRAG_MIME);
      setHover(null);
      if (!raw) return;
      event.preventDefault();
      event.stopPropagation();
      const zone = resolveSplitDropZone(paneRatios(event));
      dropThread({
        routeThreadId,
        targetThreadId,
        threadId: raw as ThreadId,
        edge: zone.edge,
        orientation: zone.orientation,
      });
    },
    [dropThread, routeThreadId],
  );

  const renderNode = useCallback(
    (node: SplitNode): React.ReactNode => {
      if (node.kind === "branch") {
        return (
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1",
              node.orientation === "column" && "flex-col",
            )}
          >
            {node.children.map((child, index) => (
              <div
                // Keyed on the child's first pane, not its index: stable while that
                // subtree lives, so panes are not torn down and remounted on every
                // reshape. Never empty — branches always hold at least one pane.
                key={treePaneIds(child)[0]}
                className={cn(
                  "flex min-h-0 min-w-0 flex-1",
                  // Every branch divides its space evenly among its children.
                  index > 0 &&
                    (node.orientation === "row"
                      ? "border-l border-border"
                      : "border-t border-border"),
                )}
              >
                {renderNode(child)}
              </div>
            ))}
          </div>
        );
      }

      const threadId = node.threadId;
      const focused = split ? threadId === focusedThreadId : true;
      const hovered = hover?.threadId === threadId ? hover : null;
      const paneIndex = paneIds.indexOf(threadId);

      return (
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-split-pane-thread={threadId}
          data-split-pane-focused={focused ? "true" : undefined}
          onDragOver={(event) => handleDragOver(threadId, event)}
          onDragLeave={() => setHover(null)}
          onDrop={(event) => handleDrop(threadId, event)}
          onPointerDownCapture={() => {
            if (split) focusPane(threadId);
          }}
        >
          <ChatView
            threadId={threadId}
            paneScopeId={split ? `split-${paneIndex}` : "single"}
            surfaceMode={split ? "split" : "single"}
            isFocusedPane={focused}
            onClosePane={split ? () => closePane(routeThreadId, threadId) : undefined}
          />

          {/* Drop affordance. Pointer-events off so it never eats the dragover
              events that keep it alive. */}
          {hovered ? (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute z-30 bg-foreground/12",
                hovered.edge === "replace" && "inset-0 border-2 border-foreground",
                hovered.orientation === "row" &&
                  hovered.edge === "before" &&
                  "inset-y-0 left-0 w-1/3 border-l-2 border-foreground",
                hovered.orientation === "row" &&
                  hovered.edge === "after" &&
                  "inset-y-0 right-0 w-1/3 border-r-2 border-foreground",
                hovered.orientation === "column" &&
                  hovered.edge === "before" &&
                  "inset-x-0 top-0 h-1/3 border-t-2 border-foreground",
                hovered.orientation === "column" &&
                  hovered.edge === "after" &&
                  "inset-x-0 bottom-0 h-1/3 border-b-2 border-foreground",
              )}
            />
          ) : null}
        </div>
      );
    },
    [
      closePane,
      focusPane,
      focusedThreadId,
      handleDragOver,
      handleDrop,
      hover,
      paneIds,
      routeThreadId,
      split,
    ],
  );

  return (
    <ProjectSurfaceFrame>
      <div
        className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
      >
        <RouteInsetSurface surfaceClassName={CHAT_SURFACE_TRANSPARENT_CLASS_NAME}>
          <div className="flex h-full min-h-0 w-full">{renderNode(tree)}</div>
        </RouteInsetSurface>
      </div>
    </ProjectSurfaceFrame>
  );
}
