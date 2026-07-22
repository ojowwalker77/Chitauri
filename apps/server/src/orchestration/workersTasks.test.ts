import {
  CommandId,
  EventId,
  ProjectId,
  TaskId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const WORKER_ID = ProjectId.makeUnsafe("worker-1");
const OTHER_WORKER_ID = ProjectId.makeUnsafe("worker-2");
const CHAT_ID = ProjectId.makeUnsafe("home-chat");
const TASK_ID = TaskId.makeUnsafe("task-1");

type DecidedEvent = Omit<OrchestrationEvent, "sequence">;

function firstEvent(result: DecidedEvent | ReadonlyArray<DecidedEvent>): DecidedEvent | undefined {
  return "type" in result ? result : result[0];
}

async function addProject(
  model: ReturnType<typeof createEmptyReadModel>,
  input: { readonly id: ProjectId; readonly kind?: "project" | "chat"; readonly sequence: number },
) {
  const now = "2026-07-21T12:00:00.000Z";
  return Effect.runPromise(
    projectEvent(model, {
      sequence: input.sequence,
      eventId: EventId.makeUnsafe(`event-project-${input.sequence}`),
      aggregateKind: "project",
      aggregateId: input.id,
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe(`command-project-${input.sequence}`),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        projectId: input.id,
        kind: input.kind ?? "project",
        title: `Project ${input.sequence}`,
        workspaceRoot: `/tmp/project-${input.sequence}`,
        defaultModelSelection: null,
        scripts: [],
        workerInstructions: "Keep changes scoped.",
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

describe("Worker Task orchestration", () => {
  it("creates, completes, and reopens a durable Task", async () => {
    const now = "2026-07-21T12:00:00.000Z";
    const testReportArtifact = {
      id: "artifact-test-report",
      kind: "test_report" as const,
      title: "Worker Task tests",
      reference: "38 tests passing",
      createdAt: now,
    };
    const withWorker = await addProject(createEmptyReadModel(now), {
      id: WORKER_ID,
      sequence: 1,
    });
    const created = firstEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withWorker,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-task-create"),
            taskId: TASK_ID,
            workerId: WORKER_ID,
            title: "Ship Workers",
            brief: "Make Tasks durable.",
            origin: "research",
            createdAt: now,
          },
        }),
      ),
    );
    expect(created?.type).toBe("task.created");
    if (!created || created.type !== "task.created") return;
    expect(created.payload).toMatchObject({
      taskId: TASK_ID,
      workerId: WORKER_ID,
      status: "open",
      origin: "research",
      completedAt: null,
    });

    const withTask = await Effect.runPromise(
      projectEvent(withWorker, { ...created, sequence: 2 } as OrchestrationEvent),
    );
    expect(withTask.tasks).toHaveLength(1);
    expect(withTask.tasks[0]).toMatchObject({
      id: TASK_ID,
      workerId: WORKER_ID,
      title: "Ship Workers",
      status: "open",
    });

    const completed = firstEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withTask,
          command: {
            type: "task.update",
            commandId: CommandId.makeUnsafe("command-task-complete"),
            taskId: TASK_ID,
            status: "completed",
            artifacts: [testReportArtifact],
            completionSummary: "Workers foundation shipped.",
          },
        }),
      ),
    );
    expect(completed?.type).toBe("task.updated");
    if (!completed || completed.type !== "task.updated") return;
    expect(completed.payload).toMatchObject({
      status: "completed",
      artifacts: [testReportArtifact],
      completedAt: expect.any(String),
    });

    const completedModel = await Effect.runPromise(
      projectEvent(withTask, { ...completed, sequence: 3 } as OrchestrationEvent),
    );
    expect(completedModel.tasks.find((task) => task.id === TASK_ID)?.artifacts).toEqual([
      testReportArtifact,
    ]);
    const reopened = firstEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: completedModel,
          command: {
            type: "task.update",
            commandId: CommandId.makeUnsafe("command-task-reopen"),
            taskId: TASK_ID,
            status: "in_progress",
          },
        }),
      ),
    );
    expect(reopened?.type).toBe("task.updated");
    if (!reopened || reopened.type !== "task.updated") return;
    expect(reopened.payload).toMatchObject({ completedAt: null });
    const reopenedModel = await Effect.runPromise(
      projectEvent(completedModel, { ...reopened, sequence: 4 } as OrchestrationEvent),
    );
    expect(reopenedModel.tasks.find((task) => task.id === TASK_ID)?.artifacts).toEqual([
      testReportArtifact,
    ]);
  });

  it("rejects Tasks for Home Chat and cross-Worker Thread assignment", async () => {
    const now = "2026-07-21T12:00:00.000Z";
    const withChat = await addProject(createEmptyReadModel(now), {
      id: CHAT_ID,
      kind: "chat",
      sequence: 1,
    });
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withChat,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-chat-task"),
            taskId: TASK_ID,
            workerId: CHAT_ID,
            title: "Invalid Task",
            brief: "",
            origin: "user",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("not an active repository Worker");

    const withOwner = await addProject(createEmptyReadModel(now), {
      id: WORKER_ID,
      sequence: 1,
    });
    const withBothWorkers = await addProject(withOwner, { id: OTHER_WORKER_ID, sequence: 2 });
    const createdTask = firstEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withBothWorkers,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-task-create"),
            taskId: TASK_ID,
            workerId: WORKER_ID,
            title: "Owner Task",
            brief: "",
            origin: "user",
            createdAt: now,
          },
        }),
      ),
    );
    expect(createdTask?.type).toBe("task.created");
    if (!createdTask || createdTask.type !== "task.created") return;
    const withTask = await Effect.runPromise(
      projectEvent(withBothWorkers, { ...createdTask, sequence: 3 } as OrchestrationEvent),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withTask,
          command: {
            type: "thread.create",
            commandId: CommandId.makeUnsafe("command-cross-worker-thread"),
            threadId: ThreadId.makeUnsafe("thread-1"),
            projectId: OTHER_WORKER_ID,
            taskId: TASK_ID,
            title: "Wrong Worker",
            modelSelection: { provider: "codex", model: "gpt-5.4" },
            runtimeMode: "full-access",
            envMode: "local",
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("belongs to Worker");
  });

  it("creates delegated Tasks under a different Worker with durable requester links", async () => {
    const now = "2026-07-21T12:00:00.000Z";
    const recipientTaskId = TaskId.makeUnsafe("task-recipient");
    const withRequester = await addProject(createEmptyReadModel(now), {
      id: WORKER_ID,
      sequence: 1,
    });
    const withBothWorkers = await addProject(withRequester, {
      id: OTHER_WORKER_ID,
      sequence: 2,
    });
    const requesterTask = firstEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withBothWorkers,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-requester-task"),
            taskId: TASK_ID,
            workerId: WORKER_ID,
            title: "Ship passkeys",
            brief: "Coordinate the client integration.",
            origin: "user",
            createdAt: now,
          },
        }),
      ),
    );
    expect(requesterTask?.type).toBe("task.created");
    if (!requesterTask || requesterTask.type !== "task.created") return;
    const withRequesterTask = await Effect.runPromise(
      projectEvent(withBothWorkers, {
        ...requesterTask,
        sequence: 3,
      } as OrchestrationEvent),
    );

    const delegatedTask = firstEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withRequesterTask,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-delegated-task"),
            taskId: recipientTaskId,
            workerId: OTHER_WORKER_ID,
            requesterWorkerId: WORKER_ID,
            requesterTaskId: TASK_ID,
            title: "Add passkey endpoints",
            brief: "Implement the repository-owned API work.",
            origin: "delegation",
            createdAt: now,
          },
        }),
      ),
    );

    expect(delegatedTask?.type).toBe("task.created");
    if (!delegatedTask || delegatedTask.type !== "task.created") return;
    expect(delegatedTask.payload).toMatchObject({
      taskId: recipientTaskId,
      workerId: OTHER_WORKER_ID,
      requesterWorkerId: WORKER_ID,
      requesterTaskId: TASK_ID,
      origin: "delegation",
    });

    const withDelegatedTask = await Effect.runPromise(
      projectEvent(withRequesterTask, {
        ...delegatedTask,
        sequence: 4,
      } as OrchestrationEvent),
    );
    expect(withDelegatedTask.tasks.find((task) => task.id === recipientTaskId)).toMatchObject({
      workerId: OTHER_WORKER_ID,
      requesterWorkerId: WORKER_ID,
      requesterTaskId: TASK_ID,
      origin: "delegation",
    });
  });

  it("allows an unfiled Worker request without inventing a requester Task", async () => {
    const now = "2026-07-21T12:00:00.000Z";
    const withRequester = await addProject(createEmptyReadModel(now), {
      id: WORKER_ID,
      sequence: 1,
    });
    const withBothWorkers = await addProject(withRequester, {
      id: OTHER_WORKER_ID,
      sequence: 2,
    });

    const request = firstEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withBothWorkers,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-unfiled-request"),
            taskId: TaskId.makeUnsafe("task-unfiled-request"),
            workerId: OTHER_WORKER_ID,
            requesterWorkerId: WORKER_ID,
            title: "Provide the API contract",
            brief: "Send the current contract without starting a Thread.",
            origin: "delegation",
            createdAt: now,
          },
        }),
      ),
    );

    expect(request?.type).toBe("task.created");
    if (!request || request.type !== "task.created") return;
    expect(request.payload).toMatchObject({
      workerId: OTHER_WORKER_ID,
      requesterWorkerId: WORKER_ID,
      requesterTaskId: null,
      origin: "delegation",
    });
  });

  it("rejects same-Worker and invalid requester delegation links", async () => {
    const now = "2026-07-21T12:00:00.000Z";
    const withRequester = await addProject(createEmptyReadModel(now), {
      id: WORKER_ID,
      sequence: 1,
    });
    const withBothWorkers = await addProject(withRequester, {
      id: OTHER_WORKER_ID,
      sequence: 2,
    });
    const requesterTask = firstEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withBothWorkers,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-requester-task"),
            taskId: TASK_ID,
            workerId: WORKER_ID,
            title: "Requester Task",
            brief: "",
            origin: "user",
            createdAt: now,
          },
        }),
      ),
    );
    expect(requesterTask?.type).toBe("task.created");
    if (!requesterTask || requesterTask.type !== "task.created") return;
    const withRequesterTask = await Effect.runPromise(
      projectEvent(withBothWorkers, {
        ...requesterTask,
        sequence: 3,
      } as OrchestrationEvent),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withRequesterTask,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-same-worker-delegation"),
            taskId: TaskId.makeUnsafe("task-same-worker"),
            workerId: WORKER_ID,
            requesterWorkerId: WORKER_ID,
            requesterTaskId: TASK_ID,
            title: "Same Worker",
            brief: "",
            origin: "delegation",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("different repository Worker");

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withRequesterTask,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-missing-requester-task"),
            taskId: TaskId.makeUnsafe("task-missing-requester"),
            workerId: OTHER_WORKER_ID,
            requesterWorkerId: WORKER_ID,
            requesterTaskId: TaskId.makeUnsafe("task-does-not-exist"),
            title: "Missing Requester",
            brief: "",
            origin: "delegation",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("Task 'task-does-not-exist' does not exist");

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withRequesterTask,
          command: {
            type: "task.create",
            commandId: CommandId.makeUnsafe("command-mismatched-requester-worker"),
            taskId: TaskId.makeUnsafe("task-mismatched-requester"),
            workerId: WORKER_ID,
            requesterWorkerId: OTHER_WORKER_ID,
            requesterTaskId: TASK_ID,
            title: "Mismatched Requester",
            brief: "",
            origin: "delegation",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("belongs to Worker");
  });
});
