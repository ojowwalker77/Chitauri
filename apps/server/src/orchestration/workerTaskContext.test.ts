import { ProjectId, TaskId, type OrchestrationTaskShell } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildWorkerTaskContext } from "./workerTaskContext.ts";

const workerId = ProjectId.makeUnsafe("worker-1");

function task(
  id: string,
  status: OrchestrationTaskShell["status"],
  title: string,
): OrchestrationTaskShell {
  return {
    id: TaskId.makeUnsafe(id),
    workerId,
    requesterWorkerId: null,
    requesterTaskId: null,
    title,
    brief: `${title} brief`,
    status,
    origin: "agent",
    artifacts: [],
    completionSummary: null,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    completedAt: null,
  };
}

describe("buildWorkerTaskContext", () => {
  it("shows the current canonical Task and only active sibling Tasks", () => {
    const context = buildWorkerTaskContext({
      currentTaskId: TaskId.makeUnsafe("task-current"),
      workerId,
      tasks: [
        task("task-current", "in_progress", "Current work"),
        task("task-open", "open", "Next work"),
        task("task-done", "completed", "Finished work"),
      ],
    });

    expect(context).toContain("Current Task Thread:");
    expect(context).toContain("[task-current] in_progress: Current work");
    expect(context).toContain("[task-open] open: Next work");
    expect(context).not.toContain("Finished work");
  });

  it("stays empty when an unfiled Thread has no pending Tasks", () => {
    expect(buildWorkerTaskContext({ currentTaskId: null, workerId, tasks: [] })).toBe("");
  });
});
