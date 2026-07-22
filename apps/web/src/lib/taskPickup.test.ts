import { describe, expect, it } from "vitest";
import { ProjectId, TaskId, ThreadId, type OrchestrationTaskShell } from "@t3tools/contracts";
import { resolveTaskPickupTarget } from "./taskPickup";

const workerId = ProjectId.makeUnsafe("worker:tea-code");
const taskId = TaskId.makeUnsafe("agent-task:4a0fc913-abc");
const canonicalThreadId = ThreadId.makeUnsafe("thread:task");
const task: OrchestrationTaskShell = {
  id: taskId,
  workerId,
  requesterWorkerId: null,
  requesterTaskId: null,
  title: "Audit urgent fixes",
  brief: "Review and prioritize the urgent fixes.",
  status: "open",
  origin: "agent",
  artifacts: [],
  completionSummary: null,
  createdAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T10:00:00.000Z",
  completedAt: null,
};
const canonicalThread = {
  id: canonicalThreadId,
  projectId: workerId,
  taskId,
};

describe("resolveTaskPickupTarget", () => {
  it("resolves the compact reference to the Task canonical Thread", () => {
    expect(
      resolveTaskPickupTarget({
        prompt: "Pick up TASK-4A0FC913 and start with the audit.",
        workerId,
        currentTaskId: null,
        tasks: [task],
        threads: [canonicalThread],
      }),
    ).toEqual({ task, thread: canonicalThread });
  });

  it("also resolves an exact durable Task id", () => {
    expect(
      resolveTaskPickupTarget({
        prompt: `Continue ${taskId}, please.`,
        workerId,
        currentTaskId: null,
        tasks: [task],
        threads: [canonicalThread],
      })?.thread.id,
    ).toBe(canonicalThreadId);
  });

  it("does not redirect from the Task own Thread", () => {
    expect(
      resolveTaskPickupTarget({
        prompt: "Continue TASK-4A0FC913.",
        workerId,
        currentTaskId: taskId,
        tasks: [task],
        threads: [canonicalThread],
      }),
    ).toBeNull();
  });

  it("requires an exact reference and canonical Thread in the same Worker", () => {
    expect(
      resolveTaskPickupTarget({
        prompt: "Continue TASK-4A0F, please.",
        workerId,
        currentTaskId: null,
        tasks: [task],
        threads: [],
      }),
    ).toBeNull();
  });
});
