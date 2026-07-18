import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
  type WheelEvent,
} from "react";

import {
  SKETCHPAD_MAX_TEXT_CHARS,
  hasSketchpadContent,
  type SketchpadDocument,
  type SketchpadEdge,
  type SketchpadFrame,
  type SketchpadNode,
  type SketchpadPoint,
} from "~/lib/composerSketchpad";
import { cn } from "~/lib/utils";
import {
  exportSketchpadSnapshot,
  resolveSketchpadExportLayout,
  type ExportedSketchpadSnapshot,
} from "./sketchpadExport";
import type { SketchpadAction, SketchpadReducerState } from "./sketchpadReducer";

export interface SketchpadSurfaceHandle {
  exportSnapshot(existingAttachmentCount: number): Promise<ExportedSketchpadSnapshot>;
  focus(): void;
  fit(): void;
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

type Gesture =
  | {
      kind: "move";
      pointerId: number;
      elementId: string;
      start: SketchpadPoint;
      last: SketchpadPoint;
    }
  | {
      kind: "resize";
      pointerId: number;
      nodeId: string;
      start: SketchpadPoint;
      original: SketchpadFrame;
      lastFrame: SketchpadFrame;
    }
  | {
      kind: "pen";
      pointerId: number;
      points: SketchpadPoint[];
    }
  | {
      kind: "pan";
      pointerId: number;
      startClient: SketchpadPoint;
      original: Viewport;
    }
  | {
      kind: "pinch";
      pointerIds: readonly [number, number];
      startCenter: SketchpadPoint;
      startDistance: number;
      original: Viewport;
    };

function nodeCenter(node: SketchpadNode): SketchpadPoint {
  return { x: node.frame.x + node.frame.width / 2, y: node.frame.y + node.frame.height / 2 };
}

function edgePoint(
  document: SketchpadDocument,
  endpoint: SketchpadEdge["from"],
): SketchpadPoint | null {
  const node = document.nodes.find((candidate) => candidate.id === endpoint.nodeId);
  if (!node) return null;
  return {
    x: node.frame.x + node.frame.width * endpoint.anchor.x,
    y: node.frame.y + node.frame.height * endpoint.anchor.y,
  };
}

function edgeMidpoint(document: SketchpadDocument, edge: SketchpadEdge): SketchpadPoint | null {
  const from = edgePoint(document, edge.from);
  const to = edgePoint(document, edge.to);
  return from && to ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } : null;
}

function strokePath(points: ReadonlyArray<SketchpadPoint>): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function frameStyle(frame: SketchpadFrame): CSSProperties {
  return { left: frame.x, top: frame.y, width: frame.width, height: frame.height };
}

function midpoint(left: SketchpadPoint, right: SketchpadPoint): SketchpadPoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function pointDistance(left: SketchpadPoint, right: SketchpadPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

interface ArtworkProps {
  document: SketchpadDocument;
  markerId: string;
  exportMode?: boolean;
  selectedElementId?: string | null;
  editingElementId?: string | null;
  editingValue?: string;
  nodeElementRefs?: MutableRefObject<Map<string, HTMLElement | SVGPathElement>>;
  onElementPointerDown?: (event: PointerEvent, elementId: string) => void;
  onResizePointerDown?: (event: PointerEvent, node: SketchpadNode) => void;
  onStartEditing?: (elementId: string) => void;
  onEditingValueChange?: (value: string) => void;
  onCommitEditing?: () => void;
  onCancelEditing?: () => void;
}

function SketchpadArtwork(props: ArtworkProps) {
  const { document } = props;
  return (
    <>
      <svg
        className="pointer-events-none absolute left-0 top-0 size-px overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <marker
            id={props.markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {document.edges.map((edge) => {
          const from = edgePoint(document, edge.from);
          const to = edgePoint(document, edge.to);
          if (!from || !to) return null;
          const midpoint = edgeMidpoint(document, edge);
          return (
            <g
              key={edge.id}
              className={
                props.exportMode ? "text-slate-900" : "text-[var(--color-text-foreground)]"
              }
            >
              <path
                d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={props.selectedElementId === edge.id ? 3 : 2}
                markerEnd={`url(#${props.markerId})`}
                className={cn(
                  "pointer-events-auto cursor-pointer",
                  props.selectedElementId === edge.id && "text-info",
                )}
                onPointerDown={(event) => props.onElementPointerDown?.(event, edge.id)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  props.onStartEditing?.(edge.id);
                }}
              />
              {edge.label && midpoint ? (
                <text
                  x={midpoint.x}
                  y={midpoint.y - 7}
                  textAnchor="middle"
                  className="pointer-events-auto select-none fill-current text-[12px]"
                  onDoubleClick={() => props.onStartEditing?.(edge.id)}
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {document.nodes.flatMap((node) =>
          node.kind === "stroke"
            ? [
                <path
                  key={node.id}
                  ref={(element) => {
                    if (!props.nodeElementRefs) return;
                    if (element) props.nodeElementRefs.current.set(node.id, element);
                    else props.nodeElementRefs.current.delete(node.id);
                  }}
                  d={strokePath(node.points)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={props.selectedElementId === node.id ? 4 : 2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn(
                    "pointer-events-auto cursor-move",
                    props.exportMode ? "text-slate-900" : "text-[var(--color-text-foreground)]",
                    props.selectedElementId === node.id && "text-info",
                  )}
                  onPointerDown={(event) => props.onElementPointerDown?.(event, node.id)}
                />,
              ]
            : [],
        )}
      </svg>

      {document.nodes.flatMap((node) => {
        if (node.kind === "stroke") return [];
        const selected = props.selectedElementId === node.id;
        const editing = props.editingElementId === node.id;
        return [
          <div
            key={node.id}
            ref={(element) => {
              if (!props.nodeElementRefs) return;
              if (element) props.nodeElementRefs.current.set(node.id, element);
              else props.nodeElementRefs.current.delete(node.id);
            }}
            data-sketchpad-element={node.id}
            className={cn(
              "absolute flex cursor-move select-none items-center justify-center text-[13px]",
              props.exportMode ? "text-slate-900" : "text-[var(--color-text-foreground)] shadow-sm",
              node.kind === "note" &&
                (props.exportMode
                  ? "items-start justify-start rounded-lg border border-amber-400 bg-amber-100 p-3 text-left"
                  : "items-start justify-start rounded-lg border border-amber-500/35 bg-amber-200/45 p-3 text-left dark:bg-amber-500/12"),
              node.kind === "shape" &&
                node.shape !== "diamond" &&
                (props.exportMode
                  ? "border-2 border-slate-500 bg-white px-3 text-center"
                  : "border-2 border-[var(--color-border-default)] bg-[var(--color-background-surface)]/95 px-3 text-center"),
              node.kind === "shape" && node.shape === "rectangle" && "rounded-lg",
              node.kind === "shape" && node.shape === "ellipse" && "rounded-[999px]",
              selected && "outline-2 outline-offset-2 outline-info",
            )}
            style={frameStyle(node.frame)}
            onPointerDown={(event) => props.onElementPointerDown?.(event, node.id)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              props.onStartEditing?.(node.id);
            }}
          >
            {node.kind === "shape" && node.shape === "diamond" ? (
              <div
                className={cn(
                  "absolute inset-[14%] rotate-45 rounded-sm border-2",
                  props.exportMode
                    ? "border-slate-500 bg-white"
                    : "border-[var(--color-border-default)] bg-[var(--color-background-surface)]/95",
                )}
              >
                <span className="absolute inset-0 flex -rotate-45 items-center justify-center px-2 text-center">
                  {node.label}
                </span>
              </div>
            ) : editing ? (
              <textarea
                autoFocus
                value={props.editingValue}
                maxLength={SKETCHPAD_MAX_TEXT_CHARS}
                className="size-full resize-none bg-transparent text-inherit outline-none"
                aria-label={node.kind === "note" ? "Edit note" : "Edit shape label"}
                onChange={(event) => props.onEditingValueChange?.(event.target.value)}
                onBlur={() => props.onCommitEditing?.()}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    props.onCancelEditing?.();
                  }
                  if (event.key === "Enter" && !event.shiftKey && node.kind === "shape") {
                    event.preventDefault();
                    props.onCommitEditing?.();
                  }
                }}
              />
            ) : node.kind === "note" ? (
              <span className="whitespace-pre-wrap break-words">{node.text || "Note"}</span>
            ) : (
              <span>{node.label}</span>
            )}
            {selected && props.onResizePointerDown ? (
              <button
                type="button"
                aria-label="Resize element"
                className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-info bg-[var(--color-background-surface)]"
                onPointerDown={(event) => props.onResizePointerDown?.(event, node)}
              />
            ) : null}
          </div>,
        ];
      })}
    </>
  );
}

export const SketchpadSurface = forwardRef<
  SketchpadSurfaceHandle,
  {
    state: SketchpadReducerState;
    dispatch: (action: SketchpadAction) => void;
    onRequestClose: () => void;
  }
>(function SketchpadSurface({ state, dispatch, onRequestClose }, forwardedRef) {
  const rootRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const previewPathRef = useRef<SVGPathElement>(null);
  const arrowPreviewPathRef = useRef<SVGPathElement>(null);
  const nodeElementRefs = useRef(new Map<string, HTMLElement | SVGPathElement>());
  const gestureRef = useRef<Gesture | null>(null);
  const touchPointsRef = useRef(new Map<number, SketchpadPoint>());
  const spaceHeldRef = useRef(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [arrowSourceId, setArrowSourceId] = useState<string | null>(null);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const rawMarkerId = useId();
  const markerId = `sketchpad-arrow-${rawMarkerId.replaceAll(":", "")}`;
  const exportMarkerId = `${markerId}-export`;
  const exportLayout = useMemo(
    () => resolveSketchpadExportLayout(state.document),
    [state.document],
  );

  const clientToBoard = useCallback(
    (clientX: number, clientY: number): SketchpadPoint => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.x) / viewport.zoom,
        y: (clientY - rect.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  const fit = useCallback(() => {
    const root = rootRef.current;
    const layout = resolveSketchpadExportLayout(state.document);
    if (!root || !layout) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const rect = root.getBoundingClientRect();
    const zoom = Math.max(
      0.25,
      Math.min(
        1.5,
        Math.min(rect.width / layout.bounds.width, rect.height / layout.bounds.height) * 0.88,
      ),
    );
    setViewport({
      zoom,
      x: (rect.width - layout.bounds.width * zoom) / 2 - layout.bounds.x * zoom,
      y: (rect.height - layout.bounds.height * zoom) / 2 - layout.bounds.y * zoom,
    });
  }, [state.document]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      async exportSnapshot(existingAttachmentCount) {
        if (!exportRef.current) throw new Error("The sketchpad renderer is not ready yet.");
        return exportSketchpadSnapshot({
          element: exportRef.current,
          document: state.document,
          existingAttachmentCount,
        });
      },
      focus: () => rootRef.current?.focus(),
      fit,
    }),
    [fit, state.document],
  );

  useEffect(() => {
    const releaseSpace = (event: globalThis.KeyboardEvent) => {
      if (event.code === "Space") spaceHeldRef.current = false;
    };
    window.addEventListener("keyup", releaseSpace);
    return () => window.removeEventListener("keyup", releaseSpace);
  }, []);

  const startEditing = (elementId: string) => {
    const node = state.document.nodes.find((candidate) => candidate.id === elementId);
    const edge = state.document.edges.find((candidate) => candidate.id === elementId);
    if (!node && !edge) return;
    setEditingElementId(elementId);
    setEditingValue(
      node
        ? node.kind === "note"
          ? node.text
          : node.kind === "shape"
            ? node.label
            : ""
        : (edge?.label ?? ""),
    );
  };

  const finishEditing = (commit: boolean) => {
    const elementId = editingElementId;
    if (commit && elementId) {
      if (state.document.edges.some((edge) => edge.id === elementId)) {
        dispatch({ type: "update-edge-label", edgeId: elementId, label: editingValue });
      } else {
        dispatch({ type: "update-node-text", nodeId: elementId, text: editingValue });
      }
    }
    setEditingElementId(null);
    setEditingValue("");
    rootRef.current?.focus();
  };

  const beginElementPointer = (event: PointerEvent, elementId: string) => {
    event.stopPropagation();
    rootRef.current?.focus();
    const node = state.document.nodes.find((candidate) => candidate.id === elementId);
    if (state.tool === "arrow" && node && node.kind !== "stroke") {
      if (!arrowSourceId) {
        setArrowSourceId(node.id);
        dispatch({ type: "select", elementId: node.id });
      } else if (arrowSourceId !== node.id) {
        dispatch({
          type: "add-edge",
          edge: {
            id: crypto.randomUUID(),
            kind: "arrow",
            from: { nodeId: arrowSourceId, anchor: { x: 0.5, y: 0.5 } },
            to: { nodeId: node.id, anchor: { x: 0.5, y: 0.5 } },
            label: "",
            author: "user",
          },
        });
        setArrowSourceId(null);
      }
      return;
    }
    dispatch({ type: "select", elementId });
    if (state.tool !== "select" || !node) return;
    const point = clientToBoard(event.clientX, event.clientY);
    rootRef.current?.setPointerCapture(event.pointerId);
    gestureRef.current = {
      kind: "move",
      pointerId: event.pointerId,
      elementId,
      start: point,
      last: point,
    };
  };

  const beginResize = (event: PointerEvent, node: SketchpadNode) => {
    if (node.kind === "stroke") return;
    event.preventDefault();
    event.stopPropagation();
    const start = clientToBoard(event.clientX, event.clientY);
    rootRef.current?.setPointerCapture(event.pointerId);
    gestureRef.current = {
      kind: "resize",
      pointerId: event.pointerId,
      nodeId: node.id,
      start,
      original: { ...node.frame },
      lastFrame: { ...node.frame },
    };
  };

  const createNodeAtPoint = (point: SketchpadPoint): boolean => {
    if (
      state.tool !== "note" &&
      state.tool !== "rectangle" &&
      state.tool !== "ellipse" &&
      state.tool !== "diamond"
    ) {
      return false;
    }
    const id = crypto.randomUUID();
    const frame = { x: point.x - 80, y: point.y - 45, width: 160, height: 90 };
    const node: SketchpadNode =
      state.tool === "note"
        ? { id, kind: "note", text: "", frame, author: "user" }
        : { id, kind: "shape", shape: state.tool, label: "", frame, author: "user" };
    dispatch({ type: "add-node", node });
    dispatch({ type: "set-tool", tool: "select" });
    setEditingElementId(id);
    setEditingValue("");
    return true;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    rootRef.current?.focus();
    if (event.pointerType === "touch") {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const pointers = [...touchPointsRef.current.entries()];
      if (state.tool === "select" && pointers.length === 2) {
        const previousGesture = gestureRef.current;
        if (previousGesture) resetGesturePreview(previousGesture);
        const [[firstId, firstPoint], [secondId, secondPoint]] = pointers as [
          [number, SketchpadPoint],
          [number, SketchpadPoint],
        ];
        rootRef.current?.setPointerCapture(firstId);
        rootRef.current?.setPointerCapture(secondId);
        gestureRef.current = {
          kind: "pinch",
          pointerIds: [firstId, secondId],
          startCenter: midpoint(firstPoint, secondPoint),
          startDistance: Math.max(1, pointDistance(firstPoint, secondPoint)),
          original: viewport,
        };
        event.preventDefault();
        return;
      }
    }
    const point = clientToBoard(event.clientX, event.clientY);
    if (spaceHeldRef.current || event.button === 1) {
      event.preventDefault();
      rootRef.current?.setPointerCapture(event.pointerId);
      gestureRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        original: viewport,
      };
      return;
    }
    if (state.tool === "pen") {
      rootRef.current?.setPointerCapture(event.pointerId);
      gestureRef.current = { kind: "pen", pointerId: event.pointerId, points: [point] };
      previewPathRef.current?.setAttribute("d", strokePath([point]));
      return;
    }
    if (createNodeAtPoint(point)) return;
    if (state.tool === "arrow") {
      setArrowSourceId(null);
      dispatch({ type: "select", elementId: null });
      return;
    }
    dispatch({ type: "select", elementId: null });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && touchPointsRef.current.has(event.pointerId)) {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const gesture = gestureRef.current;
    if (gesture?.kind === "pinch") {
      if (!gesture.pointerIds.includes(event.pointerId)) return;
      const first = touchPointsRef.current.get(gesture.pointerIds[0]);
      const second = touchPointsRef.current.get(gesture.pointerIds[1]);
      const rect = rootRef.current?.getBoundingClientRect();
      if (!first || !second || !rect) return;
      const center = midpoint(first, second);
      const zoom = Math.max(
        0.25,
        Math.min(3, gesture.original.zoom * (pointDistance(first, second) / gesture.startDistance)),
      );
      const startLocal = {
        x: gesture.startCenter.x - rect.left,
        y: gesture.startCenter.y - rect.top,
      };
      const boardCenter = {
        x: (startLocal.x - gesture.original.x) / gesture.original.zoom,
        y: (startLocal.y - gesture.original.y) / gesture.original.zoom,
      };
      setViewport({
        zoom,
        x: center.x - rect.left - boardCenter.x * zoom,
        y: center.y - rect.top - boardCenter.y * zoom,
      });
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId) {
      if (arrowSourceId && arrowPreviewPathRef.current) {
        const source = state.document.nodes.find((node) => node.id === arrowSourceId);
        if (source) {
          const point = clientToBoard(event.clientX, event.clientY);
          const center = nodeCenter(source);
          arrowPreviewPathRef.current.setAttribute(
            "d",
            `M ${center.x} ${center.y} L ${point.x} ${point.y}`,
          );
        }
      }
      return;
    }
    if (gesture.kind === "pan") {
      setViewport({
        ...gesture.original,
        x: gesture.original.x + event.clientX - gesture.startClient.x,
        y: gesture.original.y + event.clientY - gesture.startClient.y,
      });
      return;
    }
    const point = clientToBoard(event.clientX, event.clientY);
    if (gesture.kind === "move") {
      gesture.last = point;
      const element = nodeElementRefs.current.get(gesture.elementId);
      if (element)
        element.style.transform = `translate(${point.x - gesture.start.x}px, ${point.y - gesture.start.y}px)`;
      return;
    }
    if (gesture.kind === "resize") {
      gesture.lastFrame = {
        ...gesture.original,
        width: Math.max(48, gesture.original.width + point.x - gesture.start.x),
        height: Math.max(36, gesture.original.height + point.y - gesture.start.y),
      };
      const element = nodeElementRefs.current.get(gesture.nodeId);
      if (element) {
        element.style.width = `${gesture.lastFrame.width}px`;
        element.style.height = `${gesture.lastFrame.height}px`;
      }
      return;
    }
    gesture.points.push(point);
    previewPathRef.current?.setAttribute("d", strokePath(gesture.points));
  };

  function resetGesturePreview(gesture: Gesture) {
    if (gesture.kind === "move") {
      const element = nodeElementRefs.current.get(gesture.elementId);
      if (element) element.style.transform = "";
    }
    if (gesture.kind === "resize") {
      const element = nodeElementRefs.current.get(gesture.nodeId);
      if (element) {
        element.style.width = "";
        element.style.height = "";
      }
    }
    if (gesture.kind === "pen") previewPathRef.current?.setAttribute("d", "");
  }

  const finishGesture = (event: PointerEvent<HTMLDivElement>, commitGesture: boolean) => {
    const gesture = gestureRef.current;
    if (event.pointerType === "touch") touchPointsRef.current.delete(event.pointerId);
    if (gesture?.kind === "pinch") {
      if (!gesture.pointerIds.includes(event.pointerId)) return;
      gestureRef.current = null;
      for (const pointerId of gesture.pointerIds) {
        if (rootRef.current?.hasPointerCapture(pointerId)) {
          rootRef.current.releasePointerCapture(pointerId);
        }
      }
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    resetGesturePreview(gesture);
    if (rootRef.current?.hasPointerCapture(event.pointerId))
      rootRef.current.releasePointerCapture(event.pointerId);
    if (!commitGesture) return;
    if (gesture.kind === "move") {
      dispatch({
        type: "move-element",
        elementId: gesture.elementId,
        delta: { x: gesture.last.x - gesture.start.x, y: gesture.last.y - gesture.start.y },
      });
    } else if (gesture.kind === "resize") {
      dispatch({ type: "resize-node", nodeId: gesture.nodeId, frame: gesture.lastFrame });
    } else if (gesture.kind === "pen") {
      dispatch({ type: "add-stroke", id: crypto.randomUUID(), points: gesture.points });
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextZoom = Math.max(0.25, Math.min(3, viewport.zoom * Math.exp(-event.deltaY * 0.0015)));
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const boardX = (localX - viewport.x) / viewport.zoom;
    const boardY = (localY - viewport.y) / viewport.zoom;
    setViewport({ zoom: nextZoom, x: localX - boardX * nextZoom, y: localY - boardY * nextZoom });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
      return;
    if (event.code === "Space") {
      spaceHeldRef.current = true;
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      dispatch({ type: "redo" });
      return;
    }
    if (event.key === "Enter") {
      const rect = rootRef.current?.getBoundingClientRect();
      if (
        rect &&
        createNodeAtPoint(clientToBoard(rect.left + rect.width / 2, rect.top + rect.height / 2))
      ) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      dispatch({ type: "delete-selected" });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (editingElementId) finishEditing(false);
      else if (arrowSourceId) setArrowSourceId(null);
      else if (state.tool !== "select") dispatch({ type: "set-tool", tool: "select" });
      else if (state.selectedElementId) dispatch({ type: "select", elementId: null });
      else onRequestClose();
      return;
    }
    const keyTools = {
      v: "select",
      t: "note",
      r: "rectangle",
      o: "ellipse",
      d: "diamond",
      a: "arrow",
      p: "pen",
    } as const;
    const tool = keyTools[event.key.toLowerCase() as keyof typeof keyTools];
    if (tool && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setArrowSourceId(null);
      dispatch({ type: "set-tool", tool });
    }
  };

  const editingEdge = editingElementId
    ? state.document.edges.find((edge) => edge.id === editingElementId)
    : null;
  const editingEdgePosition = editingEdge ? edgeMidpoint(state.document, editingEdge) : null;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="application"
      aria-label="Sketchpad canvas"
      className={cn(
        "relative size-full touch-none overflow-hidden bg-[var(--color-background-surface)] outline-none",
        "bg-[radial-gradient(circle_at_center,var(--color-border-default)_0.75px,transparent_0.75px)] bg-[size:18px_18px]",
        state.tool === "select"
          ? "cursor-default"
          : state.tool === "pen"
            ? "cursor-crosshair"
            : "cursor-cell",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishGesture(event, true)}
      onPointerCancel={(event) => finishGesture(event, false)}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      {!hasSketchpadContent(state.document) ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-xs text-[var(--color-text-foreground-tertiary)]">
          <span>Choose a tool or press T to add a note.</span>
        </div>
      ) : null}
      <div
        className="absolute left-0 top-0 size-px origin-top-left overflow-visible"
        style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
      >
        <SketchpadArtwork
          document={state.document}
          markerId={markerId}
          selectedElementId={state.selectedElementId}
          editingElementId={editingElementId}
          editingValue={editingValue}
          nodeElementRefs={nodeElementRefs}
          onElementPointerDown={beginElementPointer}
          onResizePointerDown={beginResize}
          onStartEditing={startEditing}
          onEditingValueChange={setEditingValue}
          onCommitEditing={() => finishEditing(true)}
          onCancelEditing={() => finishEditing(false)}
        />
        {editingEdge && editingEdgePosition ? (
          <input
            autoFocus
            value={editingValue}
            maxLength={SKETCHPAD_MAX_TEXT_CHARS}
            aria-label="Edit arrow label"
            className="absolute z-20 w-40 -translate-x-1/2 -translate-y-1/2 rounded border border-info bg-[var(--color-background-surface)] px-2 py-1 text-xs outline-none"
            style={{ left: editingEdgePosition.x, top: editingEdgePosition.y }}
            onChange={(event) => setEditingValue(event.target.value)}
            onBlur={() => finishEditing(true)}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") finishEditing(true);
              if (event.key === "Escape") finishEditing(false);
            }}
          />
        ) : null}
        <svg
          className="pointer-events-none absolute left-0 top-0 size-px overflow-visible text-info"
          aria-hidden="true"
        >
          <path
            ref={previewPathRef}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            ref={arrowPreviewPathRef}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        </svg>
      </div>

      {exportLayout ? (
        <div
          ref={exportRef}
          aria-hidden="true"
          className="fixed -left-[100000px] top-0 overflow-hidden bg-white text-slate-900"
          style={{ width: exportLayout.width, height: exportLayout.height }}
        >
          <div
            className="absolute left-0 top-0 size-px origin-top-left overflow-visible"
            style={{
              transform: `translate(${-exportLayout.bounds.x * exportLayout.scale}px, ${-exportLayout.bounds.y * exportLayout.scale}px) scale(${exportLayout.scale})`,
            }}
          >
            <SketchpadArtwork document={state.document} markerId={exportMarkerId} exportMode />
          </div>
        </div>
      ) : null}
    </div>
  );
});
