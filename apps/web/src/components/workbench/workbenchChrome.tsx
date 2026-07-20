// FILE: workbenchChrome.tsx
// Purpose: Single source of truth for the two-pane "workbench" surfaces (Git
//          Workbench) — pane geometry, sub-header rows, micro section labels,
//          and the segmented tab/filter strip.
// Layer: Workbench surface primitives
// Why: Workbench surfaces each hand-rolled the same aside/main class strings
//      and three different pill shapes for what is one control. Radii
//      (7px/8px/lg/xl), heights, and label typography drifted per call site.
//      Centralizing them here makes the surfaces read as one system and keeps
//      new rows from re-deriving magic classes.

import type { ReactNode } from "react";

import {
  CHAT_SURFACE_CHIP_CLASS_NAME,
  CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
} from "~/components/chat/chatHeaderControls";
import { cn } from "~/lib/utils";

/** Fixed height of a workbench sub-header row (tab strips, action bars, filter rows). */
export const WORKBENCH_ROW_HEIGHT_CLASS_NAME = "h-12";

/** Standard horizontal inset inside a workbench pane. */
export const WORKBENCH_ROW_PADDING_X_CLASS_NAME = "px-3";

/**
 * A sub-header row inside a workbench pane: fixed height, hairline underline,
 * shared inset. Every toolbar/tab/action row uses this so the horizontal rules
 * line up across panes.
 */
export function WorkbenchRow({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-border/70",
        WORKBENCH_ROW_HEIGHT_CLASS_NAME,
        WORKBENCH_ROW_PADDING_X_CLASS_NAME,
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Left list pane. Collapses to full width below `md`, where the detail pane
 * takes over the viewport once something is selected.
 */
export function WorkbenchListPane({
  hidden,
  className,
  children,
}: {
  hidden: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <aside
      className={cn(
        "w-[340px] min-w-[280px] max-w-[42%] shrink-0 flex-col border-r border-border/70 max-md:w-full max-md:max-w-full",
        hidden ? "hidden md:flex" : "flex",
        className,
      )}
    >
      {children}
    </aside>
  );
}

/** Right detail pane, the mirror of {@link WorkbenchListPane}. */
export function WorkbenchDetailPane({
  hidden,
  className,
  children,
}: {
  hidden: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <main
      className={cn(
        "min-w-0 flex-1 flex-col overflow-hidden",
        hidden ? "hidden md:flex" : "flex",
        className,
      )}
    >
      {children}
    </main>
  );
}

/**
 * Typography for a micro heading above a group of rows ("Checks", "Environments",
 * "Identity"). One spec so these stop drifting between 10px/0.1em and 12px/wide.
 * Prefer {@link WorkbenchSectionLabel}; the raw token is for call sites that need
 * a non-heading element (e.g. a card caption inside an existing heading level).
 */
export const WORKBENCH_SECTION_LABEL_CLASS_NAME =
  "text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground";

/** Micro heading above a group of rows. */
export function WorkbenchSectionLabel({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return <h2 className={cn(WORKBENCH_SECTION_LABEL_CLASS_NAME, className)}>{children}</h2>;
}

export type SegmentedTabOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
};

/**
 * The one segmented control for workbench tab strips and list filters. Built on
 * the same flat chip chrome as the chat header toggles and dock tabs, so an
 * active segment is the shared `--selected` fill rather than a per-surface pill.
 *
 * Rendered as a radiogroup (not a tablist) because call sites drive their own
 * panels and some segments filter a list rather than swap a panel.
 */
export function SegmentedTabs<T extends string>({
  value,
  options,
  ariaLabel,
  className,
  onValueChange,
}: {
  value: T;
  options: readonly SegmentedTabOption<T>[];
  ariaLabel: string;
  className?: string | undefined;
  onValueChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("flex min-w-0 items-center gap-0.5 overflow-x-auto", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              CHAT_SURFACE_CHIP_CLASS_NAME,
              "inline-flex shrink-0 items-center justify-center outline-none transition-[background-color,color,scale] duration-press ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
              active && CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
