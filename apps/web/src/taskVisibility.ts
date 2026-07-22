// FILE: taskVisibility.ts
// Purpose: Keep the operational Task list focused while preserving closed history.

import type { OrchestrationTaskShell, ProjectId } from "@t3tools/contracts";

export type TaskVisibility = "active" | "closed";

export function isClosedTask(task: OrchestrationTaskShell): boolean {
  return task.status === "completed" || task.status === "cancelled";
}

export function tasksForWorker(
  tasks: readonly OrchestrationTaskShell[],
  workerId: ProjectId | undefined,
  visibility: TaskVisibility,
): OrchestrationTaskShell[] {
  return tasks
    .filter(
      (task) =>
        task.workerId === workerId &&
        (visibility === "closed" ? isClosedTask(task) : !isClosedTask(task)),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
