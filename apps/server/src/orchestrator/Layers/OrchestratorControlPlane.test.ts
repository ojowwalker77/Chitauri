import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";

import { ServerConfig, type ServerConfigShape } from "../../config.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService, type ServerSettingsShape } from "../../serverSettings.ts";
import { makeOrchestratorControlPlane } from "./OrchestratorControlPlane.ts";

const SEAT_THREAD_ID = ThreadId.makeUnsafe("thread-seat");

it("authenticates a seat and exposes only the control-plane tools", async () => {
  const projections = {
    getThreadShellById: () =>
      Effect.succeed(
        Option.some({
          id: SEAT_THREAD_ID,
          projectId: ProjectId.makeUnsafe("project-seat"),
          title: "Orchestrator",
          modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
          runtimeMode: "full-access",
          interactionMode: "default",
          envMode: "local",
          branch: "main",
          worktreePath: "/tmp/project-seat",
          orchestratorMode: true,
        }),
      ),
  } as unknown as ProjectionSnapshotQueryShape;
  const settings = {
    start: Effect.void,
    ready: Effect.void,
    getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
    streamChanges: Stream.empty,
  } satisfies ServerSettingsShape;
  const config = { port: 3773 } as ServerConfigShape;
  const engine = {} as OrchestrationEngineShape;
  const git = {} as GitCoreShape;

  const controlPlane = await Effect.runPromise(
    makeOrchestratorControlPlane.pipe(
      Effect.provideService(ServerConfig, config),
      Effect.provideService(GitCore, git),
      Effect.provideService(OrchestrationEngineService, engine),
      Effect.provideService(ProjectionSnapshotQuery, projections),
      Effect.provideService(ServerSettingsService, settings),
    ),
  );
  const mcp = await Effect.runPromise(controlPlane.getMcpServerForSeat(SEAT_THREAD_ID));

  const unauthorized = await Effect.runPromise(
    controlPlane.handleHttpRequest(
      new Request(mcp.url, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  assert.strictEqual(unauthorized.status, 401);

  const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
    requestInit: { headers: mcp.headers },
    fetch: ((input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return Effect.runPromise(controlPlane.handleHttpRequest(request));
    }) as typeof fetch,
  });
  const client = new Client({ name: "chitauri-test", version: "1.0.0" });
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  try {
    const tools = await client.listTools();
    assert.deepStrictEqual(tools.tools.map((tool) => tool.name).sort(), [
      "delegate",
      "result",
      "status",
    ]);
  } finally {
    await client.close();
  }
});

it("accepts a replacement MCP client after the provider runtime restarts", async () => {
  const projections = {
    getThreadShellById: () =>
      Effect.succeed(
        Option.some({
          id: SEAT_THREAD_ID,
          projectId: ProjectId.makeUnsafe("project-seat"),
          title: "Orchestrator",
          modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
          runtimeMode: "full-access",
          interactionMode: "default",
          envMode: "local",
          branch: "main",
          worktreePath: "/tmp/project-seat",
          orchestratorMode: true,
        }),
      ),
  } as unknown as ProjectionSnapshotQueryShape;
  const settings = {
    start: Effect.void,
    ready: Effect.void,
    getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
    streamChanges: Stream.empty,
  } satisfies ServerSettingsShape;
  const controlPlane = await Effect.runPromise(
    makeOrchestratorControlPlane.pipe(
      Effect.provideService(ServerConfig, { port: 3773, host: "::1" } as ServerConfigShape),
      Effect.provideService(GitCore, {} as GitCoreShape),
      Effect.provideService(OrchestrationEngineService, {} as OrchestrationEngineShape),
      Effect.provideService(ProjectionSnapshotQuery, projections),
      Effect.provideService(ServerSettingsService, settings),
    ),
  );
  const mcp = await Effect.runPromise(controlPlane.getMcpServerForSeat(SEAT_THREAD_ID));
  assert.strictEqual(mcp.url, "http://[::1]:3773/api/orchestrator/mcp");
  const makeClient = () => {
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: { headers: mcp.headers },
      fetch: ((input: Request | string, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        return Effect.runPromise(controlPlane.handleHttpRequest(request));
      }) as typeof fetch,
    });
    return {
      client: new Client({ name: "chitauri-restart-test", version: "1.0.0" }),
      transport,
    };
  };

  const first = makeClient();
  await first.client.connect(first.transport as Parameters<typeof first.client.connect>[0]);
  const second = makeClient();
  try {
    await second.client.connect(second.transport as Parameters<typeof second.client.connect>[0]);
    const tools = await second.client.listTools();
    assert.deepStrictEqual(tools.tools.map((tool) => tool.name).sort(), [
      "delegate",
      "result",
      "status",
    ]);
  } finally {
    await first.client.close().catch(() => undefined);
    await second.client.close().catch(() => undefined);
  }
});

it("delegates through the normal thread path in an isolated worktree", async () => {
  const commands: OrchestrationCommand[] = [];
  let hasWorkingTreeChanges = false;
  const childThreadIdRef: { current: ThreadId | null } = { current: null };
  const projections = {
    getThreadShellById: () =>
      Effect.succeed(
        Option.some({
          id: SEAT_THREAD_ID,
          projectId: ProjectId.makeUnsafe("project-seat"),
          title: "Orchestrator",
          modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
          runtimeMode: "full-access",
          interactionMode: "default",
          envMode: "local",
          branch: "main",
          worktreePath: "/repo",
          orchestratorMode: true,
        }),
      ),
    getSnapshot: () =>
      Effect.succeed({
        projects: [
          {
            id: ProjectId.makeUnsafe("project-seat"),
            workspaceRoot: "/repo",
          },
        ],
      }),
    getThreadDetailById: () =>
      Effect.succeed(
        childThreadIdRef.current
          ? Option.some({
              id: childThreadIdRef.current,
              latestTurn: {
                turnId: "turn-child",
                state: "completed",
                requestedAt: "2026-07-15T00:00:00.000Z",
                startedAt: "2026-07-15T00:00:00.000Z",
                completedAt: "2026-07-15T00:01:00.000Z",
                assistantMessageId: "message-child",
              },
              messages: [
                {
                  role: "assistant",
                  text: "Delegated task complete.",
                  streaming: false,
                },
              ],
            })
          : Option.none(),
      ),
  } as unknown as ProjectionSnapshotQueryShape;
  const settings = {
    start: Effect.void,
    ready: Effect.void,
    getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
    streamChanges: Stream.empty,
  } satisfies ServerSettingsShape;
  const engine = {
    dispatch: (command: OrchestrationCommand) => {
      commands.push(command);
      if (command.type === "thread.create") childThreadIdRef.current = command.threadId;
      return Effect.succeed({ sequence: commands.length });
    },
  } as unknown as OrchestrationEngineShape;
  const git = {
    statusDetails: () =>
      Effect.succeed({ isRepo: true, branch: "main", hasWorkingTreeChanges }),
    createWorktree: () =>
      Effect.succeed({ worktree: { path: "/repo-worktrees/delegate", branch: "delegate" } }),
    execute: (input: { readonly operation: string }) =>
      Effect.succeed({
        code: 0,
        stdout: input.operation.endsWith("committed")
          ? "src/example.ts | 2 ++\n"
          : input.operation.endsWith("untracked")
            ? "?? src/new.ts\n"
            : "",
        stderr: "",
      }),
  } as unknown as GitCoreShape;

  const controlPlane = await Effect.runPromise(
    makeOrchestratorControlPlane.pipe(
      Effect.provideService(ServerConfig, { port: 3773 } as ServerConfigShape),
      Effect.provideService(GitCore, git),
      Effect.provideService(OrchestrationEngineService, engine),
      Effect.provideService(ProjectionSnapshotQuery, projections),
      Effect.provideService(ServerSettingsService, settings),
    ),
  );
  const mcp = await Effect.runPromise(controlPlane.getMcpServerForSeat(SEAT_THREAD_ID));
  const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
    requestInit: { headers: mcp.headers },
    fetch: ((input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return Effect.runPromise(controlPlane.handleHttpRequest(request));
    }) as typeof fetch,
  });
  const client = new Client({ name: "chitauri-test", version: "1.0.0" });
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  try {
    const response = await client.callTool({
      name: "delegate",
      arguments: {
        lane: "bulk",
        brief: {
          goal: "Implement the focused change",
          paths: ["src/example.ts"],
          constraints: ["Keep the API stable"],
          dontTouch: ["src/unrelated.ts"],
          doneCriteria: ["Focused tests pass"],
        },
      },
    });
    const text = (response.content as Array<{ type: string; text: string }>)[0];
    assert.strictEqual(text?.type, "text");
    const result = JSON.parse(text && text.type === "text" ? text.text : "{}") as {
      status: string;
      finalMessage: string;
      diffStat: string;
    };
    assert.strictEqual(result.status, "needs_review");
    assert.strictEqual(result.finalMessage, "Delegated task complete.");
    assert.match(result.diffStat, /src\/example\.ts/);
    assert.match(result.diffStat, /\?\? src\/new\.ts/);
    assert.strictEqual(commands[0]?.type, "thread.create");
    if (commands[0]?.type === "thread.create") {
      assert.strictEqual(commands[0].parentThreadId, SEAT_THREAD_ID);
      assert.strictEqual(commands[0].worktreePath, "/repo-worktrees/delegate");
      assert.strictEqual(commands[0].modelSelection.model, "gpt-5.6-terra");
    }
    assert.strictEqual(commands[1]?.type, "thread.turn.start");

    hasWorkingTreeChanges = true;
    const dirtyResponse = await client.callTool({
      name: "delegate",
      arguments: {
        lane: "bulk",
        brief: {
          goal: "Use uncommitted seat work",
          paths: ["src/example.ts"],
          constraints: [],
          dontTouch: [],
          doneCriteria: ["The uncommitted change is included"],
        },
      },
    });
    const dirtyText = (dirtyResponse.content as Array<{ type: string; text: string }>)[0];
    const dirtyResult = JSON.parse(
      dirtyText && dirtyText.type === "text" ? dirtyText.text : "{}",
    ) as { status: string; error: string };
    assert.strictEqual(dirtyResult.status, "failed");
    assert.match(dirtyResult.error, /Commit or stash/);
    assert.strictEqual(commands.length, 2);
  } finally {
    await client.close();
  }
});
