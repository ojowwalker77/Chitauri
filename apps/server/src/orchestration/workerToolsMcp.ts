// FILE: workerToolsMcp.ts
// Purpose: Private MCP tools for durable Worker Tasks and cross-Worker Inbox requests.

import {
  CommandId,
  ProjectId,
  TaskId,
  ThreadId,
  type OrchestrationShellSnapshot,
  type ProviderSessionStartInput,
  type TaskStatus,
} from "@t3tools/contracts";
import { Cause, Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ServerConfigShape } from "../config.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

export const WORKER_TOOLS_MCP_PATH = "/api/worker-tools/mcp";
const WORKER_TOOLS_TOKEN = crypto.randomUUID();
const TASK_STATUSES = new Set<TaskStatus>([
  "open",
  "in_progress",
  "blocked",
  "waiting_on_worker",
  "in_review",
  "completed",
  "cancelled",
]);

type JsonRpcRequest = {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
};

type WorkerScope = {
  readonly threadId: ThreadId;
  readonly workerId: ProjectId;
  readonly snapshot: OrchestrationShellSnapshot;
};

const toolDefinitions = [
  {
    name: "tasks_list",
    description: "List durable Tasks owned by this Thread's repository Worker.",
    inputSchema: {
      type: "object",
      properties: {
        include_closed: {
          type: "boolean",
          description: "Include completed and cancelled Tasks. Defaults to false.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "tasks_create",
    description:
      "Create a durable Task for this repository Worker. This never creates or switches Threads.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        brief: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "tasks_update",
    description: "Edit the title, brief, or status of a Task owned by this Worker.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string" },
        brief: { type: "string" },
        status: { type: "string", enum: [...TASK_STATUSES] },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "tasks_close",
    description: "Close a Task as completed or cancelled with an optional durable summary.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        outcome: { type: "string", enum: ["completed", "cancelled"] },
        summary: { type: "string" },
      },
      required: ["task_id", "outcome"],
      additionalProperties: false,
    },
  },
  {
    name: "tasks_pull",
    description:
      "Explicitly link the current Thread to a Task owned by this Worker and mark an open Task in progress.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "inbox_list",
    description: "List structured requests received by this repository Worker.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "inbox_send",
    description:
      "Send a structured work request to another repository Worker. The recipient receives a Task in its Inbox, but no Thread is created.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        related_task_id: { type: "string" },
      },
      required: ["worker_id", "subject", "body"],
      additionalProperties: false,
    },
  },
] as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`'${key}' must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`'${key}' must be a string.`);
  return value.trim();
}

function ownedTask(scope: WorkerScope, rawTaskId: string) {
  const task = scope.snapshot.tasks.find((candidate) => candidate.id === rawTaskId);
  if (!task || task.workerId !== scope.workerId) {
    throw new Error(`Task '${rawTaskId}' is not owned by this Worker.`);
  }
  return task;
}

function taskResult(task: OrchestrationShellSnapshot["tasks"][number]) {
  return {
    id: task.id,
    workerId: task.workerId,
    title: task.title,
    brief: task.brief,
    status: task.status,
    origin: task.origin,
    requesterWorkerId: task.requesterWorkerId,
    requesterTaskId: task.requesterTaskId,
    updatedAt: task.updatedAt,
  };
}

function resolveWorkerScope(input: {
  readonly rawThreadId: string;
  readonly snapshot: OrchestrationShellSnapshot;
}): WorkerScope {
  const thread = input.snapshot.threads.find((candidate) => candidate.id === input.rawThreadId);
  if (!thread) throw new Error("The calling TeaCode Thread no longer exists.");
  const worker = input.snapshot.projects.find(
    (candidate) => candidate.id === thread.projectId && candidate.kind === "project",
  );
  if (!worker) throw new Error("The calling Thread is not attached to a repository Worker.");
  return { threadId: thread.id, workerId: worker.id, snapshot: input.snapshot };
}

const commandId = () => CommandId.makeUnsafe(`worker-tool:${crypto.randomUUID()}`);

export function runWorkerTool(input: {
  readonly name: string;
  readonly args: unknown;
  readonly rawThreadId: string;
  readonly snapshot: OrchestrationShellSnapshot;
}) {
  return Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const scope = resolveWorkerScope({
      rawThreadId: input.rawThreadId,
      snapshot: input.snapshot,
    });
    const args = record(input.args ?? {});

    if (input.name === "tasks_list") {
      const includeClosed = args.include_closed === true;
      return scope.snapshot.tasks
        .filter(
          (task) =>
            task.workerId === scope.workerId &&
            (includeClosed || (task.status !== "completed" && task.status !== "cancelled")),
        )
        .map(taskResult);
    }

    if (input.name === "tasks_create") {
      const taskId = TaskId.makeUnsafe(crypto.randomUUID());
      const now = new Date().toISOString();
      yield* engine.dispatch({
        type: "task.create",
        commandId: commandId(),
        taskId,
        workerId: scope.workerId,
        title: requiredString(args, "title"),
        brief: optionalString(args, "brief") ?? "",
        origin: "agent",
        createdAt: now,
      });
      return { id: taskId, workerId: scope.workerId, status: "open", threadCreated: false };
    }

    if (input.name === "tasks_update") {
      const task = ownedTask(scope, requiredString(args, "task_id"));
      const title = optionalString(args, "title");
      const brief = optionalString(args, "brief");
      const rawStatus = optionalString(args, "status");
      if (rawStatus && !TASK_STATUSES.has(rawStatus as TaskStatus)) {
        throw new Error(`Unknown Task status '${rawStatus}'.`);
      }
      if (title === undefined && brief === undefined && rawStatus === undefined) {
        throw new Error("Provide at least one Task field to update.");
      }
      yield* engine.dispatch({
        type: "task.update",
        commandId: commandId(),
        taskId: task.id,
        ...(title !== undefined ? { title } : {}),
        ...(brief !== undefined ? { brief } : {}),
        ...(rawStatus !== undefined ? { status: rawStatus as TaskStatus } : {}),
      });
      return { id: task.id, updated: true };
    }

    if (input.name === "tasks_close") {
      const task = ownedTask(scope, requiredString(args, "task_id"));
      const outcome = requiredString(args, "outcome");
      if (outcome !== "completed" && outcome !== "cancelled") {
        throw new Error("'outcome' must be 'completed' or 'cancelled'.");
      }
      const summary = optionalString(args, "summary");
      yield* engine.dispatch({
        type: "task.update",
        commandId: commandId(),
        taskId: task.id,
        status: outcome,
        ...(summary !== undefined ? { completionSummary: summary } : {}),
      });
      return { id: task.id, status: outcome };
    }

    if (input.name === "tasks_pull") {
      const task = ownedTask(scope, requiredString(args, "task_id"));
      const thread = scope.snapshot.threads.find((candidate) => candidate.id === scope.threadId);
      if (thread?.taskId && thread.taskId !== task.id) {
        throw new Error(`This Thread is already linked to Task '${thread.taskId}'.`);
      }
      if (thread?.taskId !== task.id) {
        yield* engine.dispatch({
          type: "thread.meta.update",
          commandId: commandId(),
          threadId: scope.threadId,
          taskId: task.id,
        });
      }
      if (task.status === "open") {
        yield* engine.dispatch({
          type: "task.update",
          commandId: commandId(),
          taskId: task.id,
          status: "in_progress",
        });
      }
      return { id: task.id, threadId: scope.threadId, status: "in_progress" };
    }

    if (input.name === "inbox_list") {
      return scope.snapshot.tasks
        .filter((task) => task.workerId === scope.workerId && task.origin === "delegation")
        .map(taskResult);
    }

    if (input.name === "inbox_send") {
      const recipientId = ProjectId.makeUnsafe(requiredString(args, "worker_id"));
      const recipient = scope.snapshot.projects.find(
        (candidate) => candidate.id === recipientId && candidate.kind === "project",
      );
      if (!recipient) throw new Error(`Worker '${recipientId}' does not exist.`);
      if (recipient.id === scope.workerId) {
        throw new Error("Inbox requests must target another repository Worker.");
      }
      const relatedTaskId = optionalString(args, "related_task_id");
      const relatedTask = relatedTaskId ? ownedTask(scope, relatedTaskId) : null;
      const taskId = TaskId.makeUnsafe(crypto.randomUUID());
      yield* engine.dispatch({
        type: "task.create",
        commandId: commandId(),
        taskId,
        workerId: recipient.id,
        requesterWorkerId: scope.workerId,
        ...(relatedTask ? { requesterTaskId: relatedTask.id } : {}),
        title: requiredString(args, "subject"),
        brief: requiredString(args, "body"),
        origin: "delegation",
        createdAt: new Date().toISOString(),
      });
      return {
        requestId: taskId,
        recipientWorkerId: recipient.id,
        relatedTaskId: relatedTask?.id ?? null,
        threadCreated: false,
      };
    }

    throw new Error(`Unknown TeaCode Worker tool '${input.name}'.`);
  });
}

function jsonRpcResult(id: unknown, result: unknown) {
  return HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id, result }, { status: 200 });
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return HttpServerResponse.jsonUnsafe(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status: 200 },
  );
}

export function workerToolsMcpServer(
  config: ServerConfigShape,
  threadId: ThreadId,
): NonNullable<ProviderSessionStartInput["mcpServers"]>[number] {
  return {
    name: "teacode-worker",
    url: `http://127.0.0.1:${config.port}${WORKER_TOOLS_MCP_PATH}`,
    headers: {
      Authorization: `Bearer ${WORKER_TOOLS_TOKEN}`,
      "X-TeaCode-Thread-Id": threadId,
    },
    toolTimeoutMs: 30_000,
  };
}

export const workerToolsMcpRouteLayer = HttpRouter.add(
  "*",
  WORKER_TOOLS_MCP_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.headers.authorization !== `Bearer ${WORKER_TOOLS_TOKEN}`) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    const rawThreadId = request.headers["x-teacode-thread-id"];
    if (!rawThreadId) return HttpServerResponse.text("Missing Thread scope", { status: 400 });
    if (request.method !== "POST") {
      return HttpServerResponse.text("Method Not Allowed", { status: 405 });
    }

    const rpc = (yield* request.json.pipe(
      Effect.orElseSucceed(() => null),
    )) as JsonRpcRequest | null;
    if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
      return jsonRpcError(rpc?.id, -32600, "Invalid JSON-RPC request.");
    }
    if (rpc.method === "notifications/initialized") {
      return HttpServerResponse.text("", { status: 202 });
    }
    if (rpc.method === "initialize") {
      const params = record(rpc.params ?? {});
      const requestedProtocol = optionalString(params, "protocolVersion");
      return jsonRpcResult(rpc.id, {
        protocolVersion: requestedProtocol ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "TeaCode Worker", version: "1" },
      });
    }
    if (rpc.method === "tools/list") {
      return jsonRpcResult(rpc.id, { tools: toolDefinitions });
    }
    if (rpc.method !== "tools/call") {
      return jsonRpcError(rpc.id, -32601, `Method '${rpc.method}' is not supported.`);
    }

    const params = record(rpc.params ?? {});
    const name = requiredString(params, "name");
    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const snapshot = yield* snapshotQuery.getShellSnapshot();
    const toolResponse = yield* runWorkerTool({
      name,
      args: params.arguments ?? {},
      rawThreadId,
      snapshot,
    }).pipe(
      Effect.map((result) => ({
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: { result },
      })),
      Effect.catchCause((cause) =>
        Effect.succeed({
          content: [{ type: "text" as const, text: Cause.pretty(cause) }],
          isError: true as const,
        }),
      ),
    );
    return jsonRpcResult(rpc.id, toolResponse);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        jsonRpcResult(null, {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        }),
      ),
    ),
  ),
);
