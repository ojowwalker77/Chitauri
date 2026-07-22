// FILE: SidebarTreeMap.tsx
// Purpose: Shared Tree Map presentation primitives for sidebar branch and runtime state.
// Layer: Web sidebar UI
// Exports: compact branch and status labels used by pinned, project, and thread rows

import { cn } from "../lib/utils";
import {
  resolveSidebarBranchLabel,
  resolveSidebarStatusLabel,
  type ThreadStatusPill,
} from "./Sidebar.logic";

export function SidebarTreeBranchChip(props: {
  branch: string | null | undefined;
  highlighted?: boolean | undefined;
  className?: string | undefined;
}) {
  const label = resolveSidebarBranchLabel(props.branch);
  if (!label) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex h-4 max-w-24 min-w-0 shrink items-center truncate rounded-md border border-foreground/[0.08] bg-foreground/[0.025] px-1.5 font-system-ui text-xs font-normal leading-none",
        props.highlighted ? "text-muted-foreground" : "text-faint",
        props.className,
      )}
      data-sidebar-tree-branch={label}
      title={props.branch ?? undefined}
    >
      {label}
    </span>
  );
}

export function SidebarTreeStatusPill(props: {
  status: ThreadStatusPill;
  label?: string | undefined;
  className?: string | undefined;
}) {
  const label = props.label ?? resolveSidebarStatusLabel(props.status);

  return (
    <span
      aria-label={props.status.label}
      className={cn(
        "inline-flex h-5 max-w-24 shrink-0 items-center gap-1.5 rounded-md border border-foreground/[0.08] bg-foreground/[0.025] px-1.5 font-system-ui text-xs font-medium leading-none",
        props.status.colorClass,
        props.className,
      )}
      data-sidebar-tree-status={props.status.label}
      title={props.status.label}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          props.status.dotClass,
          props.status.pulse && "motion-safe:animate-pulse",
        )}
      />
      <span className="truncate tabular-nums">{label}</span>
    </span>
  );
}
