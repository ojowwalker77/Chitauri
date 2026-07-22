import { ProjectId, TaskId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildWorkerMentionContext } from "./workerMentionContext.ts";

const now = "2026-07-22T00:00:00.000Z";
const workerId = ProjectId.makeUnsafe("worker-1");
const taskId = TaskId.makeUnsafe("task-1");

describe("buildWorkerMentionContext", () => {
  it("resolves exact Task and Worker records without implying a new Thread", () => {
    const context = buildWorkerMentionContext({
      mentions: [
        { name: "Audit urgent fixes", path: "teacode://task/task-1" },
        { name: "TeaCode", path: "teacode://worker/worker-1" },
      ],
      tasks: [
        {
          id: taskId,
          workerId,
          requesterWorkerId: null,
          requesterTaskId: null,
          requesterThreadId: null,
          title: "Audit urgent fixes",
          brief: "Inspect the five urgent findings.",
          status: "open",
          origin: "agent",
          artifacts: [],
          completionSummary: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
      ],
      workers: [
        {
          id: workerId,
          kind: "project",
          title: "TeaCode",
          workspaceRoot: "/workspace/TeaCode",
          defaultModelSelection: null,
          scripts: [],
          workerInstructions: "",
          isPinned: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    expect(context).toContain("Task TASK-TASK1 (id: task-1)");
    expect(context).toContain("Inspect the five urgent findings.");
    expect(context).toContain("Repository: /workspace/TeaCode");
    expect(context).toContain("does not imply a new Thread");
  });
});
