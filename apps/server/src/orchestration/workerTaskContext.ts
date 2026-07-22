// FILE: workerTaskContext.ts
// Purpose: Build compact, deterministic Task context for repository Worker agent sessions.

import type { OrchestrationTaskShell, TaskId } from "@t3tools/contracts";
import { formatTaskReference } from "@t3tools/shared/taskReferences";

const ACTIVE_STATUSES = new Set<OrchestrationTaskShell["status"]>([
  "open",
  "in_progress",
  "blocked",
  "waiting_on_worker",
  "in_review",
]);

const STATUS_ORDER: Readonly<Record<OrchestrationTaskShell["status"], number>> = {
  in_progress: 0,
  blocked: 1,
  waiting_on_worker: 2,
  in_review: 3,
  open: 4,
  completed: 5,
  cancelled: 6,
};

function taskLine(task: OrchestrationTaskShell): string {
  const brief = task.brief.trim().replaceAll(/\s+/g, " ");
  return `- [${formatTaskReference(task.id)} | id: ${task.id}] ${task.status}: ${task.title}${brief ? ` — ${brief.slice(0, 240)}` : ""}`;
}

export function buildWorkerTaskContext(input: {
  readonly currentTaskId: TaskId | null;
  readonly tasks: ReadonlyArray<OrchestrationTaskShell>;
  readonly workerId: OrchestrationTaskShell["workerId"];
}): string {
  const workerTasks = input.tasks.filter((task) => task.workerId === input.workerId);
  const currentTask = input.currentTaskId
    ? (workerTasks.find((task) => task.id === input.currentTaskId) ?? null)
    : null;
  const pending = workerTasks
    .filter((task) => task.id !== currentTask?.id && ACTIVE_STATUSES.has(task.status))
    .toSorted(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, 20);

  if (!currentTask && pending.length === 0) {
    return "";
  }

  return [
    "<worker_task_context>",
    "TeaCode Tasks are durable, agent-visible Threads. Every Task has one canonical Thread.",
    currentTask ? `Current Task Thread:\n${taskLine(currentTask)}` : "Current Thread is unfiled.",
    pending.length > 0
      ? `Pending Task Threads for this Worker:\n${pending.map(taskLine).join("\n")}`
      : "Pending Task Threads for this Worker: none.",
    "When the user asks to create Tasks, publish a provider task list; TeaCode turns unfinished items into canonical Task Threads.",
    "When the user references a Task, use its exact id and brief. Do not invent a duplicate Task or edit another repository directly.",
    "</worker_task_context>",
  ].join("\n");
}
