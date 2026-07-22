// FILE: taskReferences.ts
// Purpose: Stable, compact human references for durable Worker Tasks.

export function formatTaskReference(taskId: string): string {
  const finalSegment = taskId.split(":").at(-1) ?? taskId;
  const compact = finalSegment
    .replaceAll(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
  return `TASK-${compact || "UNKNOWN"}`;
}
