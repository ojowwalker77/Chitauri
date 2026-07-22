import { CommandId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { runWorkerTool } from "./workerToolsMcp.ts";

async function createSystem() {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "worker-tools-test-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(orchestrationLayer);
  return {
    runtime,
    engine: await runtime.runPromise(Effect.service(OrchestrationEngineService)),
    snapshots: await runtime.runPromise(Effect.service(ProjectionSnapshotQuery)),
  };
}

describe("Worker MCP tools", () => {
  it("lets an agent manage Tasks and Inbox requests without implicitly creating Threads", async () => {
    const system = await createSystem();
    const workerA = ProjectId.makeUnsafe("worker-a");
    const workerB = ProjectId.makeUnsafe("worker-b");
    const threadA = ThreadId.makeUnsafe("thread-a");
    const threadB = ThreadId.makeUnsafe("thread-b");
    const now = "2026-07-22T00:00:00.000Z";

    for (const [workerId, title] of [
      [workerA, "TeaCode"],
      [workerB, "auth-service"],
    ] as const) {
      await system.runtime.runPromise(
        system.engine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe(`create-${workerId}`),
          projectId: workerId,
          title,
          workspaceRoot: `/workspace/${title}`,
          defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
          createdAt: now,
        }),
      );
    }
    for (const [threadId, workerId] of [
      [threadA, workerA],
      [threadB, workerB],
    ] as const) {
      await system.runtime.runPromise(
        system.engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(`create-${threadId}`),
          threadId,
          projectId: workerId,
          title: `Thread ${threadId}`,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "approval-required",
          envMode: "local",
          branch: null,
          worktreePath: null,
          createdAt: now,
        }),
      );
    }

    const call = async (threadId: ThreadId, name: string, args: unknown) => {
      const snapshot = await system.runtime.runPromise(system.snapshots.getShellSnapshot());
      return system.runtime.runPromise(
        runWorkerTool({ name, args, rawThreadId: threadId, snapshot }),
      );
    };

    const created = (await call(threadA, "tasks_create", {
      title: "Audit urgent fixes",
      brief: "Pick five urgent findings.",
    })) as { id: string; threadCreated: boolean };
    expect(created.threadCreated).toBe(false);

    let snapshot = await system.runtime.runPromise(system.snapshots.getShellSnapshot());
    expect(snapshot.threads).toHaveLength(2);
    expect(snapshot.threads.find((thread) => thread.id === threadA)?.taskId).toBeNull();
    expect(snapshot.tasks.find((task) => task.id === created.id)).toMatchObject({
      title: "Audit urgent fixes",
      status: "open",
      origin: "agent",
    });

    await call(threadA, "tasks_update", {
      task_id: created.id,
      title: "Audit five urgent fixes",
    });
    await call(threadA, "tasks_pull", { task_id: created.id });
    snapshot = await system.runtime.runPromise(system.snapshots.getShellSnapshot());
    expect(snapshot.threads.find((thread) => thread.id === threadA)?.taskId).toBe(created.id);
    expect(snapshot.tasks.find((task) => task.id === created.id)).toMatchObject({
      title: "Audit five urgent fixes",
      status: "in_progress",
    });

    const request = (await call(threadA, "inbox_send", {
      worker_id: workerB,
      subject: "Provide the API contract",
      body: "Return the current contract for this integration.",
      related_task_id: created.id,
    })) as { requestId: string; threadCreated: boolean };
    expect(request.threadCreated).toBe(false);

    const inbox = (await call(threadB, "inbox_list", {})) as Array<{
      id: string;
      requesterWorkerId: string | null;
    }>;
    expect(inbox).toEqual([
      expect.objectContaining({ id: request.requestId, requesterWorkerId: workerA }),
    ]);

    await call(threadA, "tasks_close", {
      task_id: created.id,
      outcome: "completed",
      summary: "Five urgent fixes audited.",
    });
    snapshot = await system.runtime.runPromise(system.snapshots.getShellSnapshot());
    expect(snapshot.tasks.find((task) => task.id === created.id)).toMatchObject({
      status: "completed",
      completionSummary: "Five urgent fixes audited.",
    });
    expect(snapshot.threads).toHaveLength(2);

    await system.runtime.dispose();
  });
});
