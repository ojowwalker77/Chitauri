import type { OrchestrationEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { toTaskCreatedShellStreamEvent } from "./wsRpc";

describe("Worker Task shell events", () => {
  it("projects task.created directly from the durable event", () => {
    const event = {
      type: "task.created",
      sequence: 42,
      payload: {
        taskId: "task-1",
        workerId: "worker-1",
        requesterWorkerId: "worker-2",
        requesterTaskId: "task-2",
        title: "Verify inbox delivery",
        brief: "Smoke test only.",
        status: "open",
        origin: "delegation",
        completionSummary: null,
        createdAt: "2026-07-22T13:54:24.083Z",
        updatedAt: "2026-07-22T13:54:24.083Z",
        completedAt: null,
      },
    } as unknown as Extract<OrchestrationEvent, { type: "task.created" }>;

    expect(toTaskCreatedShellStreamEvent(event)).toEqual({
      kind: "task-upserted",
      sequence: 42,
      task: {
        id: "task-1",
        workerId: "worker-1",
        requesterWorkerId: "worker-2",
        requesterTaskId: "task-2",
        // The source event predates Worker channels and carries no requester
        // Thread; the shell projection must still emit the key, defaulted to null.
        requesterThreadId: null,
        title: "Verify inbox delivery",
        brief: "Smoke test only.",
        status: "open",
        origin: "delegation",
        artifacts: [],
        completionSummary: null,
        createdAt: "2026-07-22T13:54:24.083Z",
        updatedAt: "2026-07-22T13:54:24.083Z",
        completedAt: null,
      },
    });
  });
});
