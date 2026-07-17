// FILE: ComposerChoiceRow.tsx
// Purpose: Shared list-style choice row (leading number chip + label + inline
// description + optional trailing affordance) used by both composer decision cards —
// the pending-approval card and the AskUserQuestion card — so approvals and questions
// read as one coherent set of Codex-style list controls instead of drifting apart.
// Layer: Chat composer UI
// Exports: ComposerChoiceRow, ComposerChoiceTone

import { type ReactNode } from "react";
import { cn } from "~/lib/utils";

/** Semantic accent for a choice row. `success` marks an affirmative/grant action
 *  (approve), `destructive` a rejecting action; `primary` is a monochrome emphasis
 *  for a recommended decision and `neutral` is the plain grayscale row. */
export type ComposerChoiceTone = "neutral" | "primary" | "success" | "destructive";

interface ComposerChoiceRowProps {
  /** 1-based shortcut number shown in the leading chip; `null` hides the chip. */
  shortcut: number | null;
  label: string;
  description?: string | null;
  /** Neutral "chosen" state (single/multi select) — filled chip + persistent fill. */
  selected?: boolean;
  tone?: ComposerChoiceTone;
  disabled?: boolean;
  /** Trailing affordance, e.g. a check icon on the selected option. */
  trailing?: ReactNode;
  onSelect: () => void;
}

const ROW_TONE_CLASS_NAME: Record<ComposerChoiceTone, string> = {
  neutral: "hover:bg-[var(--hover)]",
  primary: "hover:bg-[var(--hover)]",
  success: "hover:bg-[color-mix(in_srgb,var(--success)_10%,var(--hover))]",
  destructive: "hover:bg-[color-mix(in_srgb,var(--destructive)_10%,var(--hover))]",
};

const CHIP_TONE_CLASS_NAME: Record<ComposerChoiceTone, string> = {
  neutral:
    "border border-[color:var(--color-border)] text-[var(--color-text-foreground-secondary)] group-hover:text-[var(--color-text-foreground)]",
  primary:
    "border border-[color:color-mix(in_srgb,var(--foreground)_20%,var(--color-border))] text-foreground group-hover:border-[color:color-mix(in_srgb,var(--foreground)_35%,var(--color-border))]",
  success:
    "border border-[color:color-mix(in_srgb,var(--success)_50%,var(--color-border))] text-success group-hover:border-[color:color-mix(in_srgb,var(--success)_75%,var(--color-border))]",
  destructive:
    "border border-[color:color-mix(in_srgb,var(--destructive)_42%,var(--color-border))] text-destructive group-hover:border-[color:color-mix(in_srgb,var(--destructive)_68%,var(--color-border))]",
};

export function ComposerChoiceRow({
  shortcut,
  label,
  description,
  selected = false,
  tone = "neutral",
  disabled = false,
  trailing,
  onSelect,
}: ComposerChoiceRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-[10px] border border-transparent px-2.5 py-2 text-left transition-[background-color,border-color,scale] duration-press ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.96] motion-reduce:active:scale-100",
        selected
          ? "border-[color:color-mix(in_srgb,var(--foreground)_20%,var(--panel-border))] bg-[var(--selected)]"
          : ROW_TONE_CLASS_NAME[tone],
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {shortcut !== null ? (
        <span
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums transition-colors duration-press",
            selected
              ? "border border-[color:color-mix(in_srgb,var(--foreground)_35%,var(--panel-border))] text-foreground"
              : CHIP_TONE_CLASS_NAME[tone],
          )}
        >
          {shortcut}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 leading-snug">
        <span className="text-[13px] font-medium text-foreground/90">{label}</span>
        {description && description !== label ? (
          <span className="ml-1.5 text-[12px] text-muted-foreground/55">{description}</span>
        ) : null}
      </div>
      {trailing}
    </button>
  );
}
