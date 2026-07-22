// FILE: workerMentionContext.ts
// Purpose: Resolve structured @Task and @Worker references into deterministic agent context.

import type {
  OrchestrationProjectShell,
  OrchestrationTaskShell,
  ProviderMentionReference,
} from "@t3tools/contracts";
import { formatTaskReference } from "@t3tools/shared/taskReferences";
import { parseTeaCodeMentionReference } from "@t3tools/shared/workerMentions";

function compact(value: string, maxLength: number): string {
  return value.trim().replaceAll(/\s+/g, " ").slice(0, maxLength);
}

export function buildWorkerMentionContext(input: {
  readonly mentions: ReadonlyArray<ProviderMentionReference>;
  readonly tasks: ReadonlyArray<OrchestrationTaskShell>;
  readonly workers: ReadonlyArray<OrchestrationProjectShell>;
}): string {
  const taskById = new Map<string, OrchestrationTaskShell>(
    input.tasks.map((task) => [task.id, task]),
  );
  const workerById = new Map<string, OrchestrationProjectShell>(
    input.workers.map((worker) => [worker.id, worker]),
  );
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const mention of input.mentions) {
    const target = parseTeaCodeMentionReference(mention);
    if (!target) continue;
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (target.kind === "task") {
      const task = taskById.get(target.id);
      if (!task) {
        lines.push(`- Task reference unavailable: ${mention.name} (id: ${target.id})`);
        continue;
      }
      const owner = workerById.get(task.workerId);
      const brief = compact(task.brief, 600);
      lines.push(
        `- Task ${formatTaskReference(task.id)} (id: ${task.id}) | ${task.status} | ${task.title} | Worker: ${owner?.title ?? task.workerId}${brief ? ` | Brief: ${brief}` : ""}`,
      );
      continue;
    }

    const worker = workerById.get(target.id);
    if (!worker) {
      lines.push(`- Worker reference unavailable: ${mention.name} (id: ${target.id})`);
      continue;
    }
    lines.push(
      `- Worker: ${worker.title} (id: ${worker.id}) | Repository: ${worker.workspaceRoot}`,
    );
  }

  if (lines.length === 0) return "";
  return [
    "<teacode_references>",
    "The user explicitly referenced these durable TeaCode objects in this message:",
    ...lines,
    "Use Task ids exactly. A Task reference adds context to the current Thread; it does not imply a new Thread. Communicate cross-repository work through the referenced Worker inbox.",
    "</teacode_references>",
  ].join("\n");
}
