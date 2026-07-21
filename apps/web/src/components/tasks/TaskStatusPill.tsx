// FILE: TaskStatusPill.tsx
// Purpose: Keep durable Task status language and visual tone consistent across Worker surfaces.

import type { TaskStatus } from "@t3tools/contracts";

import { cn } from "~/lib/utils";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "waiting_on_worker",
  "in_review",
  "completed",
  "cancelled",
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  waiting_on_worker: "Waiting on Worker",
  in_review: "In review",
  completed: "Completed",
  cancelled: "Cancelled",
};

const TASK_STATUS_TONES: Record<TaskStatus, string> = {
  open: "bg-foreground/8 text-muted-foreground",
  in_progress: "bg-blue-500/12 text-blue-400",
  blocked: "bg-amber-500/12 text-amber-400",
  waiting_on_worker: "bg-cyan-500/12 text-cyan-400",
  in_review: "bg-violet-500/12 text-violet-400",
  completed: "bg-emerald-500/12 text-emerald-400",
  cancelled: "bg-foreground/6 text-muted-foreground/70",
};

export function TaskStatusPill({ status }: { status: TaskStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
        TASK_STATUS_TONES[status],
      )}
    >
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}
