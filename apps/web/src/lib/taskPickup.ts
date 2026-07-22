// FILE: taskPickup.ts
// Purpose: Resolves explicit Task references to their canonical Worker Thread.

import type { OrchestrationTaskShell, ProjectId, TaskId, ThreadId } from "@t3tools/contracts";
import { formatTaskReference } from "@t3tools/shared/taskReferences";

interface TaskPickupThread {
  id: ThreadId;
  projectId: ProjectId;
  taskId?: TaskId | null;
}

export interface TaskPickupTarget {
  task: OrchestrationTaskShell;
  thread: TaskPickupThread;
}

function promptReferenceTokens(prompt: string): Set<string> {
  return new Set(
    prompt
      .toUpperCase()
      .split(/[^A-Z0-9:-]+/)
      .filter(Boolean),
  );
}

export function resolveTaskPickupTarget(input: {
  prompt: string;
  workerId: ProjectId;
  currentTaskId: TaskId | null;
  tasks: readonly OrchestrationTaskShell[];
  threads: readonly TaskPickupThread[];
}): TaskPickupTarget | null {
  const tokens = promptReferenceTokens(input.prompt);

  for (const task of input.tasks) {
    if (task.workerId !== input.workerId || task.id === input.currentTaskId) {
      continue;
    }
    if (!tokens.has(task.id.toUpperCase()) && !tokens.has(formatTaskReference(task.id))) {
      continue;
    }

    const thread = input.threads.find(
      (candidate) => candidate.projectId === input.workerId && candidate.taskId === task.id,
    );
    if (thread) {
      return { task, thread };
    }
  }

  return null;
}
