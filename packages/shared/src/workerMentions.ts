// FILE: workerMentions.ts
// Purpose: Encode TeaCode Task and Worker composer references without confusing them with files/plugins.

import type {
  OrchestrationProjectShell,
  OrchestrationTaskShell,
  ProviderMentionReference,
} from "@t3tools/contracts";

const TASK_MENTION_PREFIX = "teacode://task/";
const WORKER_MENTION_PREFIX = "teacode://worker/";

export type TeaCodeMentionTarget =
  | { readonly kind: "task"; readonly id: string }
  | { readonly kind: "worker"; readonly id: string };

export function createTaskMentionReference(
  task: Pick<OrchestrationTaskShell, "id" | "title">,
): ProviderMentionReference {
  return { name: task.title, path: `${TASK_MENTION_PREFIX}${encodeURIComponent(task.id)}` };
}

export function createWorkerMentionReference(
  worker: Pick<OrchestrationProjectShell, "id" | "title">,
): ProviderMentionReference {
  return { name: worker.title, path: `${WORKER_MENTION_PREFIX}${encodeURIComponent(worker.id)}` };
}

export function parseTeaCodeMentionReference(
  mention: ProviderMentionReference,
): TeaCodeMentionTarget | null {
  const prefixes = [
    ["task", TASK_MENTION_PREFIX],
    ["worker", WORKER_MENTION_PREFIX],
  ] as const;
  for (const [kind, prefix] of prefixes) {
    if (!mention.path.startsWith(prefix)) continue;
    const encodedId = mention.path.slice(prefix.length);
    if (!encodedId) return null;
    try {
      const id = decodeURIComponent(encodedId);
      return id ? { kind, id } : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function isTeaCodeMentionReference(mention: ProviderMentionReference): boolean {
  return parseTeaCodeMentionReference(mention) !== null;
}
