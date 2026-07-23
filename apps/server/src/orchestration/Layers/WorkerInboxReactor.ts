// FILE: WorkerInboxReactor.ts
// Purpose: Spawn a session on the receiving Worker when a cross-Worker request arrives.
// Layer: Server orchestration reactor

import {
  CommandId,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  TaskId,
  ThreadId,
  type OrchestrationTaskShell,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { workerChannelRequestMessageId } from "@t3tools/shared/workerChannelMessages";
import { Cause, Effect, Layer, Stream } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  buildDelegationRequestPrompt,
  delegationTasksAwaitingResponder,
  responderThreadIdFor,
} from "../workerInboxChannel.ts";
import {
  WorkerInboxReactor,
  type WorkerInboxReactorShape,
} from "../Services/WorkerInboxReactor.ts";

// Command ids are derived from the Task id rather than random, so a retry after a
// partial failure replays the same commands instead of spawning a second Thread.
const spawnCommandIds = (taskId: TaskId) => ({
  threadId: ThreadId.makeUnsafe(`worker-inbox:${taskId}`),
  messageId: MessageId.makeUnsafe(workerChannelRequestMessageId(taskId)),
  threadCreate: CommandId.makeUnsafe(`worker-inbox:${taskId}:thread-create`),
  taskInProgress: CommandId.makeUnsafe(`worker-inbox:${taskId}:in-progress`),
  turnStart: CommandId.makeUnsafe(`worker-inbox:${taskId}:turn-start`),
});

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;

  const spawnResponder = (taskId: TaskId) =>
    Effect.gen(function* () {
      const snapshot = yield* snapshotQuery.getShellSnapshot();
      const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
      if (!task || task.origin !== "delegation") return;
      // Re-check under the fresh snapshot: the live event and startup recovery can
      // both target the same Task, and a Task owns exactly one canonical Thread.
      if (responderThreadIdFor({ taskId: task.id, threads: snapshot.threads })) return;

      const worker = snapshot.projects.find(
        (candidate) => candidate.id === task.workerId && candidate.kind === "project",
      );
      if (!worker) return;
      const requester = task.requesterWorkerId
        ? snapshot.projects.find((candidate) => candidate.id === task.requesterWorkerId)
        : undefined;
      const requesterThread = task.requesterThreadId
        ? snapshot.threads.find((candidate) => candidate.id === task.requesterThreadId)
        : undefined;

      // The receiving Worker's own default wins; otherwise mirror the requester's
      // model so a repository without a configured default still answers.
      const modelSelection = worker.defaultModelSelection ?? requesterThread?.modelSelection;
      if (!modelSelection) {
        yield* Effect.logWarning("worker inbox reactor cannot resolve a model for the request", {
          taskId: task.id,
          workerId: task.workerId,
        });
        return;
      }
      // Inherit the requester's runtime mode, falling back to the same default a
      // hand-created Thread gets. An approval-gated session would stall waiting on
      // a user click, which is exactly what auto-answering exists to avoid.
      const runtimeMode = requesterThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
      const ids = spawnCommandIds(task.id);
      const now = new Date().toISOString();

      yield* engine.dispatch({
        type: "thread.create",
        commandId: ids.threadCreate,
        threadId: ids.threadId,
        projectId: task.workerId,
        taskId: task.id,
        title: task.title,
        modelSelection,
        runtimeMode,
        envMode: "local",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });
      yield* engine.dispatch({
        type: "task.update",
        commandId: ids.taskInProgress,
        taskId: task.id,
        status: "in_progress",
      });
      yield* engine.dispatch({
        type: "thread.turn.start",
        commandId: ids.turnStart,
        threadId: ids.threadId,
        message: {
          messageId: ids.messageId,
          role: "user",
          text: buildDelegationRequestPrompt({
            task,
            requesterWorkerTitle: requester?.title ?? "requesting",
          }),
          attachments: [],
        },
        modelSelection,
        dispatchMode: "queue",
        // Reuses the automation origin rather than adding a Worker-specific one:
        // it already means "dispatched by the system, not typed by the user", and
        // a new enum value would break decoding of persisted messages on downgrade.
        dispatchOrigin: "automation",
        runtimeMode,
        createdAt: now,
      });
    });

  const spawnSafely = (taskId: TaskId) =>
    spawnResponder(taskId).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("worker inbox reactor failed to answer a request", {
          taskId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const queuedTaskIds = new Set<TaskId>();
  const worker = yield* makeDrainableWorker((taskId: TaskId) =>
    spawnSafely(taskId).pipe(Effect.ensuring(Effect.sync(() => queuedTaskIds.delete(taskId)))),
  );
  const enqueueSpawn = (taskId: TaskId) =>
    Effect.sync(() => {
      if (queuedTaskIds.has(taskId)) return false;
      queuedTaskIds.add(taskId);
      return true;
    }).pipe(Effect.flatMap((fresh) => (fresh ? worker.enqueue(taskId) : Effect.void)));

  const start: WorkerInboxReactorShape["start"] = Effect.fn(function* () {
    // Pick up requests that landed while the server was down before watching the
    // live stream. Spawning is idempotent, so overlap with live events is harmless.
    const pending = yield* snapshotQuery.getShellSnapshot().pipe(
      Effect.map(delegationTasksAwaitingResponder),
      Effect.catchCause((cause) =>
        Effect.logWarning("worker inbox reactor recovery failed", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.as([] as ReadonlyArray<OrchestrationTaskShell>)),
      ),
    );
    for (const task of pending) {
      yield* enqueueSpawn(task.id);
    }
    yield* Effect.forkScoped(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "task.created" && event.payload.origin === "delegation"
          ? enqueueSpawn(event.payload.taskId)
          : Effect.void,
      ),
    );
  });

  return { start, drain: worker.drain } satisfies WorkerInboxReactorShape;
});

export const WorkerInboxReactorLive = Layer.effect(WorkerInboxReactor, make);
