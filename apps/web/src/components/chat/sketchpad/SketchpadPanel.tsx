import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  LuArrowUpRight,
  LuCircle,
  LuDiamond,
  LuExpand,
  LuMousePointer2,
  LuPencil,
  LuRectangleHorizontal,
  LuRedo2,
  LuStickyNote,
  LuTrash2,
  LuUndo2,
  LuX,
} from "react-icons/lu";

import type { SketchpadDocument } from "~/lib/composerSketchpad";
import { cn } from "~/lib/utils";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { SketchpadSurface, type SketchpadSurfaceHandle } from "./SketchpadSurface";
import type { ExportedSketchpadSnapshot } from "./sketchpadExport";
import {
  createSketchpadReducerState,
  sketchpadReducer,
  type SketchpadTool,
} from "./sketchpadReducer";

export interface SketchpadPanelHandle {
  exportSnapshot(existingAttachmentCount: number): Promise<ExportedSketchpadSnapshot>;
  focus(): void;
}

const TOOLS: ReadonlyArray<{
  tool: SketchpadTool;
  label: string;
  key: string;
  icon: typeof LuMousePointer2;
}> = [
  { tool: "select", label: "Select", key: "V", icon: LuMousePointer2 },
  { tool: "note", label: "Note", key: "T", icon: LuStickyNote },
  { tool: "rectangle", label: "Rectangle", key: "R", icon: LuRectangleHorizontal },
  { tool: "ellipse", label: "Ellipse", key: "O", icon: LuCircle },
  { tool: "diamond", label: "Diamond", key: "D", icon: LuDiamond },
  { tool: "arrow", label: "Arrow", key: "A", icon: LuArrowUpRight },
  { tool: "pen", label: "Pen", key: "P", icon: LuPencil },
];

function documentsMatch(left: SketchpadDocument | null, right: SketchpadDocument | null): boolean {
  if (!left || !right) return left === right;
  return (
    left.revision === right.revision &&
    JSON.stringify(left.nodes) === JSON.stringify(right.nodes) &&
    JSON.stringify(left.edges) === JSON.stringify(right.edges)
  );
}

function ToolbarButton(props: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const title = props.shortcut ? `${props.label} (${props.shortcut})` : props.label;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant={props.active ? "secondary" : "ghost"}
            className={cn("size-7 shrink-0 rounded-md", props.active && "text-info")}
            aria-label={title}
            aria-pressed={props.active}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{title}</TooltipPopup>
    </Tooltip>
  );
}

export const SketchpadPanel = forwardRef<
  SketchpadPanelHandle,
  {
    document: SketchpadDocument | null;
    compact: boolean;
    onDocumentChange: (document: SketchpadDocument | null) => void;
    onClose: () => void;
  }
>(function SketchpadPanel({ document, compact, onDocumentChange, onClose }, forwardedRef) {
  const [state, dispatch] = useReducer(sketchpadReducer, document, createSketchpadReducerState);
  const surfaceRef = useRef<SketchpadSurfaceHandle>(null);
  const initializedRef = useRef(false);
  const lastEmittedDocumentRef = useRef<SketchpadDocument | null>(document);

  useEffect(() => {
    if (documentsMatch(document, lastEmittedDocumentRef.current)) return;
    dispatch({ type: "load-document", document });
  }, [document]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    const nextDocument =
      state.document.nodes.length + state.document.edges.length > 0 ? state.document : null;
    lastEmittedDocumentRef.current = nextDocument;
    onDocumentChange(nextDocument);
  }, [onDocumentChange, state.document]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      exportSnapshot(existingAttachmentCount) {
        if (!surfaceRef.current)
          return Promise.reject(new Error("The sketchpad is not ready yet."));
        return surfaceRef.current.exportSnapshot(existingAttachmentCount);
      },
      focus: () => surfaceRef.current?.focus(),
    }),
    [],
  );

  return (
    <section
      aria-label="Composer sketchpad"
      className={cn(
        "flex min-h-0 flex-col border-b border-[var(--color-border-default)] bg-[var(--color-background-surface)]",
        compact
          ? "h-[clamp(18rem,54dvh,24rem)] max-sm:h-[min(72dvh,36rem)]"
          : "h-[clamp(18rem,42vh,30rem)] max-sm:h-[min(72dvh,36rem)]",
      )}
    >
      <div className="flex min-h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[var(--color-border-default)] px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TOOLS.map(({ tool, label, key, icon: Icon }) => (
          <ToolbarButton
            key={tool}
            label={label}
            shortcut={key}
            active={state.tool === tool}
            onClick={() => dispatch({ type: "set-tool", tool })}
          >
            <Icon className="size-3.5" />
          </ToolbarButton>
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-[var(--color-border-default)]" />
        <ToolbarButton
          label="Undo"
          shortcut="Mod+Z"
          disabled={state.past.length === 0}
          onClick={() => dispatch({ type: "undo" })}
        >
          <LuUndo2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          shortcut="Mod+Shift+Z"
          disabled={state.future.length === 0}
          onClick={() => dispatch({ type: "redo" })}
        >
          <LuRedo2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Fit sketch" onClick={() => surfaceRef.current?.fit()}>
          <LuExpand className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Clear sketch (undoable)"
          disabled={state.document.nodes.length + state.document.edges.length === 0}
          onClick={() => dispatch({ type: "clear" })}
        >
          <LuTrash2 className="size-3.5" />
        </ToolbarButton>
        <span className="min-w-2 flex-1" />
        <ToolbarButton label="Close sketchpad" shortcut="Escape" onClick={onClose}>
          <LuX className="size-3.5" />
        </ToolbarButton>
      </div>
      <div className="min-h-0 flex-1">
        <SketchpadSurface
          ref={surfaceRef}
          state={state}
          dispatch={dispatch}
          onRequestClose={onClose}
        />
      </div>
    </section>
  );
});
