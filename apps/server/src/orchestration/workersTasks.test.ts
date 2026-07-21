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
            completionSummary: "Workers foundation shipped.",
          },
        }),
      ),
    );
    expect(completed?.type).toBe("task.updated");
    if (!completed || completed.type !== "task.updated") return;
    expect(completed.payload).toMatchObject({
      status: "completed",
      completedAt: expect.any(String),
    });

    const completedModel = await Effect.runPromise(
      projectEvent(withTask, { ...completed, sequence: 3 } as OrchestrationEvent),
    );
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
});
