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
    "TeaCode Tasks are durable, agent-visible work records. Threads are independent coding sessions and may be linked to a Task only when work starts.",
    currentTask
      ? `Task linked to this Thread:\n${taskLine(currentTask)}`
      : "Current Thread is unfiled.",
    pending.length > 0
      ? `Pending Tasks for this Worker:\n${pending.map(taskLine).join("\n")}`
      : "Pending Tasks for this Worker: none.",
    "Provider plans and todo lists are execution progress, not TeaCode Tasks. Use tasks_list, tasks_create, tasks_update, tasks_close, and tasks_pull for durable Task work when the user asks.",
    "Use inbox_list and inbox_send for structured cross-repository Worker requests. Never edit another Worker's repository directly.",
    "inbox_send is fully automatic: the receiving Worker starts its own session, answers, and its reply arrives back in this Thread. Do not ask the user to relay, approve, or check on it — send the request, say you sent it, and continue with work that does not depend on the answer.",
    "Reply on an open request channel with inbox_reply (request_id is the id inbox_send returned, or the channel id given to you). Pass close: true on the final reply.",
    "When the user references or asks to pull a Task, use its exact id and brief in the current Thread unless the user explicitly starts another Thread. Do not invent a duplicate Task or edit another repository directly.",
    "</worker_task_context>",
  ].join("\n");
}
