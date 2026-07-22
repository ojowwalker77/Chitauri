import { ProjectId, TaskId, type OrchestrationTaskShell } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { tasksForWorker } from "./taskVisibility";

const workerId = ProjectId.makeUnsafe("worker-1");

function task(
  id: string,
  status: OrchestrationTaskShell["status"],
  updatedAt: string,
): OrchestrationTaskShell {
  return {
    id: TaskId.makeUnsafe(id),
    workerId,
    requesterWorkerId: null,
    requesterTaskId: null,
    title: id,
    brief: "",
    status,
    origin: "user",
    artifacts: [],
    completionSummary: null,
    createdAt: updatedAt,
    updatedAt,
    completedAt: status === "completed" || status === "cancelled" ? updatedAt : null,
  };
}

describe("tasksForWorker", () => {
  const tasks = [
    task("open", "open", "2026-07-22T10:00:00.000Z"),
    task("completed", "completed", "2026-07-22T12:00:00.000Z"),
    task("progress", "in_progress", "2026-07-22T11:00:00.000Z"),
    task("cancelled", "cancelled", "2026-07-22T13:00:00.000Z"),
    {
      ...task("other", "open", "2026-07-22T14:00:00.000Z"),
      workerId: ProjectId.makeUnsafe("worker-2"),
    },
  ];

  it("keeps completed and cancelled Tasks out of the active list", () => {
    expect(tasksForWorker(tasks, workerId, "active").map((entry) => entry.id)).toEqual([
      "progress",
      "open",
    ]);
  });

  it("keeps closed Tasks inspectable in newest-first order", () => {
    expect(tasksForWorker(tasks, workerId, "closed").map((entry) => entry.id)).toEqual([
      "cancelled",
      "completed",
    ]);
  });
});
