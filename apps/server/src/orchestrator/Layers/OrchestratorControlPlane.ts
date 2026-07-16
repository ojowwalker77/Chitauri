import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CommandId,
  MessageId,
  type ModelSelection,
  OrchestratorLane,
  type OrchestratorRoutingPolicy,
  type ProviderStartOptions,
  ThreadId,
} from "@t3tools/contracts";
import { DateTime, Effect, Layer, Option } from "effect";
import { z } from "zod";

import { ServerConfig } from "../../config.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  OrchestratorControlPlane,
  type OrchestratorBrief,
  type OrchestratorControlPlaneShape,
  type OrchestratorTaskResult,
  type OrchestratorTaskStatus,
} from "../Services/OrchestratorControlPlane.ts";

const MCP_ROUTE_PATH = "/api/orchestrator/mcp";
const MCP_SERVER_NAME = "chitauri_orchestrator";
const MCP_TOOL_TIMEOUT_MS = 60 * 60 * 1_000;
const DELEGATION_TIMEOUT_MS = 55 * 60 * 1_000;
const MAX_TASKS = 200;

type TaskRecord = {
  readonly taskId: string;
  readonly seatThreadId: ThreadId;
  readonly lane: OrchestratorLane;
  readonly modelSelection: ModelSelection;
  childThreadId: ThreadId | null;
  status: "running" | "needs_review" | "failed";
  result: OrchestratorTaskResult | null;
};

type SeatSession = {
  readonly seatThreadId: ThreadId;
  readonly token: string;
  readonly server: McpServer;
  readonly transport: WebStandardStreamableHTTPServerTransport;
};

const BriefSchema = z.object({
  goal: z.string().trim().min(1).max(20_000),
  paths: z.array(z.string().trim().min(1).max(4_096)).max(100),
  constraints: z.array(z.string().trim().min(1).max(4_000)).max(100),
  dontTouch: z.array(z.string().trim().min(1).max(4_096)).max(100),
  doneCriteria: z.array(z.string().trim().min(1).max(4_000)).min(1).max(100),
});

function formatBrief(lane: OrchestratorLane, brief: OrchestratorBrief): string {
  const section = (title: string, values: readonly string[]) =>
    `${title}:\n${values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- None"}`;
  return [
    `You are the delegated ${lane} lane. Complete this self-contained brief in the current worktree.`,
    `Goal:\n${brief.goal}`,
    section("Paths in scope", brief.paths),
    section("Constraints", brief.constraints),
    section("Do not touch", brief.dontTouch),
    section("Done criteria", brief.doneCriteria),
    "Do not expand scope. Verify the done criteria and finish with a concise summary of changes and checks.",
  ].join("\n\n");
}

function trimTitle(goal: string): string {
  const normalized = goal.replace(/\s+/g, " ").trim();
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`;
}

function formatRoutingInstructions(policy: OrchestratorRoutingPolicy): string {
  const lanes = (["bulk", "ui", "explore", "verify"] as const).map((lane) => {
    const route = policy.lanes[lane];
    const escalation = route.escalation.length
      ? `; escalation ${route.escalation.map((selection) => `${selection.provider}:${selection.model}`).join(" -> ")}`
      : "";
    return `- ${lane}: ${route.modelSelection.provider}:${route.modelSelection.model}${escalation}`;
  });
  return [
    "Delegate self-contained work by lane, never by model. Chitauri enforces this routing policy and creates an isolated child worktree:",
    ...lanes,
    "Do not delegate judgment. Review every returned diff before using the child thread's merge controls.",
  ].join("\n");
}

function taskStatus(record: TaskRecord): OrchestratorTaskStatus {
  return {
    taskId: record.taskId,
    status: record.status,
    lane: record.lane,
    childThreadId: record.childThreadId,
  };
}

export const makeOrchestratorControlPlane = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const gitCore = yield* GitCore;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettingsService;
  const seatsByThreadId = new Map<ThreadId, SeatSession>();
  const seatsByToken = new Map<string, SeatSession>();
  const tasks = new Map<string, TaskRecord>();

  const requireSeat = (seatThreadId: ThreadId) =>
    Effect.gen(function* () {
      const thread = yield* projections.getThreadShellById(seatThreadId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(new Error(`Orchestrator seat '${seatThreadId}' was not found.`)),
            onSome: Effect.succeed,
          }),
        ),
      );
      if (!thread.orchestratorMode) {
        return yield* Effect.fail(new Error(`Thread '${seatThreadId}' is not an orchestrator seat.`));
      }
      const settings = yield* serverSettings.getSettings;
      const allowed = settings.orchestrator.seatModels.some(
        (selection) =>
          selection.provider === thread.modelSelection.provider &&
          selection.model === thread.modelSelection.model,
      );
      if (!allowed) {
        return yield* Effect.fail(
          new Error(
            `Thread '${seatThreadId}' uses '${thread.modelSelection.model}', which is not allowed by the orchestrator seat policy.`,
          ),
        );
      }
      return thread;
    });

  const requireTask = (seatThreadId: ThreadId, taskId: string) => {
    const task = tasks.get(taskId);
    if (!task || task.seatThreadId !== seatThreadId) {
      return Effect.fail(new Error(`Delegation task '${taskId}' was not found.`));
    }
    return Effect.succeed(task);
  };

  const retainTask = (task: TaskRecord) => {
    for (const [taskId, retained] of tasks) {
      if (tasks.size < MAX_TASKS) break;
      if (retained.status !== "running") tasks.delete(taskId);
    }
    if (tasks.size >= MAX_TASKS) {
      throw new Error(
        `The orchestrator already has ${MAX_TASKS} active delegations. Wait for one to finish before delegating again.`,
      );
    }
    tasks.set(task.taskId, task);
  };

  const collectDiffStat = (cwd: string, baseBranch: string) =>
    Effect.gen(function* () {
      const [committed, working, status] = yield* Effect.all([
        gitCore.execute({
          operation: "OrchestratorControlPlane.diffStat.committed",
          cwd,
          args: ["diff", "--stat", `${baseBranch}...HEAD`],
          allowNonZeroExit: true,
        }),
        gitCore.execute({
          operation: "OrchestratorControlPlane.diffStat.working",
          cwd,
          args: ["diff", "--stat", "HEAD"],
          allowNonZeroExit: true,
        }),
        gitCore.execute({
          operation: "OrchestratorControlPlane.diffStat.untracked",
          cwd,
          args: ["status", "--short", "--untracked-files=all"],
          allowNonZeroExit: true,
        }),
      ]);
      const untracked = status.stdout
        .split("\n")
        .filter((line) => line.startsWith("?? "))
        .join("\n");
      return [
        committed.stdout.trim(),
        working.stdout.trim(),
        untracked ? `Untracked files:\n${untracked}` : "",
      ]
        .filter(Boolean)
        .join("\n") || "No diff";
    });

  const waitForResult = (childThreadId: ThreadId) =>
    Effect.gen(function* () {
      const deadline = Date.now() + DELEGATION_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const thread = yield* projections.getThreadDetailById(childThreadId);
        if (Option.isSome(thread)) {
          const latestTurn = thread.value.latestTurn;
          if (latestTurn && latestTurn.state !== "running") {
            const finalMessage = thread.value.messages
              .filter((message) => message.role === "assistant" && !message.streaming)
              .at(-1)?.text;
            if (latestTurn.state === "completed") {
              return finalMessage ?? "Delegated turn completed without a final message.";
            }
            return yield* Effect.fail(
              new Error(`Delegated turn ended with state '${latestTurn.state}'.`),
            );
          }
        }
        yield* Effect.sleep("250 millis");
      }
      return yield* Effect.fail(new Error("Delegated turn timed out."));
    });

  const runDelegation = (input: {
    readonly taskId: string;
    readonly seatThreadId: ThreadId;
    readonly lane: OrchestratorLane;
    readonly brief: OrchestratorBrief;
  }) =>
    Effect.gen(function* () {
      const seat = yield* requireSeat(input.seatThreadId);
      const snapshot = yield* projections.getSnapshot();
      const project = snapshot.projects.find((candidate) => candidate.id === seat.projectId);
      if (!project) {
        return yield* Effect.fail(new Error(`Seat project '${seat.projectId}' was not found.`));
      }
      const settings = yield* serverSettings.getSettings;
      const route = settings.orchestrator.lanes[input.lane];
      const parentCwd = seat.worktreePath ?? project.workspaceRoot;
      const parentStatus = yield* gitCore.statusDetails(parentCwd);
      if (!parentStatus.isRepo || !parentStatus.branch) {
        return yield* Effect.fail(
          new Error("Delegation requires the orchestrator seat to be inside a Git branch."),
        );
      }

      const childThreadId = ThreadId.makeUnsafe(`orchestrator:${randomUUID()}`);
      const branch = `chitauri/delegate-${input.lane}-${randomUUID().slice(0, 8)}`;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const worktree = yield* gitCore.createWorktree({
        cwd: parentCwd,
        branch: parentStatus.branch,
        newBranch: branch,
        path: null,
      });
      yield* orchestrationEngine
        .dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(`orchestrator:${input.taskId}:create`),
          threadId: childThreadId,
          projectId: seat.projectId,
          title: trimTitle(input.brief.goal),
          modelSelection: route.modelSelection,
          runtimeMode: seat.runtimeMode,
          interactionMode: "default",
          envMode: "worktree",
          branch,
          worktreePath: worktree.worktree.path,
          associatedWorktreePath: worktree.worktree.path,
          associatedWorktreeBranch: branch,
          associatedWorktreeRef: parentStatus.branch,
          createBranchFlowCompleted: true,
          isPinned: false,
          orchestratorMode: false,
          parentThreadId: input.seatThreadId,
          subagentAgentId: input.taskId,
          subagentNickname: input.lane,
          subagentRole: input.lane,
          lastKnownPr: null,
          createdAt,
        })
        .pipe(
          Effect.catch((error) =>
            gitCore
              .removeWorktree({ cwd: parentCwd, path: worktree.worktree.path, force: true })
              .pipe(Effect.ignore, Effect.andThen(Effect.fail(error))),
          ),
        );
      const task = tasks.get(input.taskId)!;
      task.childThreadId = childThreadId;

      const providerSettings = settings.providers[route.modelSelection.provider];
      const providerOptions: ProviderStartOptions | undefined =
        route.modelSelection.provider === "codex"
          ? {
              codex: {
                ...(providerSettings.binaryPath ? { binaryPath: providerSettings.binaryPath } : {}),
                ...("homePath" in providerSettings && providerSettings.homePath
                  ? { homePath: providerSettings.homePath }
                  : {}),
              },
            }
          : route.modelSelection.provider === "claudeAgent"
            ? {
                claudeAgent: {
                  ...(providerSettings.binaryPath
                    ? { binaryPath: providerSettings.binaryPath }
                    : {}),
                },
              }
            : undefined;

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(`orchestrator:${input.taskId}:turn`),
        threadId: childThreadId,
        message: {
          messageId: MessageId.makeUnsafe(`orchestrator:${input.taskId}:message`),
          role: "user",
          text: formatBrief(input.lane, input.brief),
          attachments: [],
        },
        modelSelection: route.modelSelection,
        ...(providerOptions ? { providerOptions } : {}),
        assistantDeliveryMode: "streaming",
        dispatchMode: "queue",
        runtimeMode: seat.runtimeMode,
        interactionMode: "default",
        createdAt,
      });

      const finalMessage = yield* waitForResult(childThreadId);
      const diffStat = yield* collectDiffStat(worktree.worktree.path, parentStatus.branch);
      const result: OrchestratorTaskResult = {
        taskId: input.taskId,
        status: "needs_review",
        lane: input.lane,
        modelSelection: route.modelSelection,
        childThreadId,
        finalMessage,
        diffStat,
        error: null,
      };
      task.status = "needs_review";
      task.result = result;
      return result;
    }).pipe(
      Effect.catch((cause) => {
        const task = tasks.get(input.taskId)!;
        const message = cause instanceof Error ? cause.message : String(cause);
        const result: OrchestratorTaskResult = {
          taskId: input.taskId,
          status: "failed",
          lane: input.lane,
          modelSelection: task.modelSelection,
          childThreadId: task.childThreadId,
          finalMessage: null,
          diffStat: null,
          error: message,
        };
        task.status = "failed";
        task.result = result;
        return Effect.succeed(result);
      }),
    );

  const createSeatSession = (seatThreadId: ThreadId) =>
    Effect.gen(function* () {
      yield* requireSeat(seatThreadId);
      const existing = seatsByThreadId.get(seatThreadId);
      if (existing) return existing;

      const token = randomUUID();
      const settings = yield* serverSettings.getSettings;
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
      });
      const server = new McpServer(
        { name: MCP_SERVER_NAME, version: "0.1.0" },
        {
          instructions: formatRoutingInstructions(settings.orchestrator),
        },
      );

      server.registerTool(
        "delegate",
        {
          description:
            "Delegate a self-contained brief to the configured bulk, ui, explore, or verify lane. Returns only after the child finishes and includes its thread id and diff stat.",
          inputSchema: {
            lane: z.enum(["bulk", "ui", "explore", "verify"]),
            brief: BriefSchema,
          },
        },
        async ({ lane, brief }) => {
          const taskId = randomUUID();
          const settings = await Effect.runPromise(serverSettings.getSettings);
          const modelSelection = settings.orchestrator.lanes[lane].modelSelection;
          retainTask({
            taskId,
            seatThreadId,
            lane,
            modelSelection,
            childThreadId: null,
            status: "running",
            result: null,
          });
          const result = await Effect.runPromise(
            runDelegation({ taskId, seatThreadId, lane, brief }),
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        },
      );

      server.registerTool(
        "status",
        {
          description: "Read the current state of a delegation created by this seat.",
          inputSchema: { taskId: z.string().uuid() },
        },
        async ({ taskId }) => ({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                await Effect.runPromise(
                  requireTask(seatThreadId, taskId).pipe(Effect.map(taskStatus)),
                ),
                null,
                2,
              ),
            },
          ],
        }),
      );

      server.registerTool(
        "result",
        {
          description: "Fetch the completed review payload for a delegation created by this seat.",
          inputSchema: { taskId: z.string().uuid() },
        },
        async ({ taskId }) => {
          const result = await Effect.runPromise(
            requireTask(seatThreadId, taskId).pipe(
              Effect.flatMap((task) =>
                task.result
                  ? Effect.succeed(task.result)
                  : Effect.fail(new Error(`Delegation task '${taskId}' is still running.`)),
              ),
            ),
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        },
      );

      yield* Effect.promise(() => server.connect(transport));
      const session = { seatThreadId, token, server, transport } satisfies SeatSession;
      seatsByThreadId.set(seatThreadId, session);
      seatsByToken.set(token, session);
      return session;
    });

  return {
    getMcpServerForSeat: (seatThreadId) =>
      createSeatSession(seatThreadId).pipe(
        Effect.map((session) => ({
          name: MCP_SERVER_NAME,
          url: `http://127.0.0.1:${config.port}${MCP_ROUTE_PATH}`,
          headers: { Authorization: `Bearer ${session.token}` },
          toolTimeoutMs: MCP_TOOL_TIMEOUT_MS,
        })),
      ),
    handleHttpRequest: (request) =>
      Effect.gen(function* () {
        const authorization = request.headers.get("authorization");
        const token = authorization?.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : null;
        const session = token ? seatsByToken.get(token) : undefined;
        if (!session) return new Response("Unauthorized", { status: 401 });
        yield* requireSeat(session.seatThreadId);
        return yield* Effect.promise(() => session.transport.handleRequest(request));
      }),
    getTaskStatus: (seatThreadId, taskId) =>
      requireTask(seatThreadId, taskId).pipe(
        Effect.map((task) => ({ ...taskStatus(task), taskId })),
      ),
    getTaskResult: (seatThreadId, taskId) =>
      requireTask(seatThreadId, taskId).pipe(
        Effect.flatMap((task) =>
          task.result
            ? Effect.succeed(task.result)
            : Effect.fail(new Error(`Delegation task '${taskId}' is still running.`)),
        ),
      ),
  } satisfies OrchestratorControlPlaneShape;
});

export const OrchestratorControlPlaneLive = Layer.effect(
  OrchestratorControlPlane,
  makeOrchestratorControlPlane,
);
