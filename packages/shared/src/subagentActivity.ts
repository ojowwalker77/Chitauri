// FILE: subagentActivity.ts
// Purpose: Reduce provider-specific subagent activity into one provider-agnostic state model.
// Layer: Shared runtime logic consumed downstream of provider ingestion.
// Exports: UnifiedSubagentState, deriveUnifiedSubagentStates, decodeCollabSubagents

import {
  decodeSubagentAgentStates,
  decodeSubagentReceiverAgents,
  decodeSubagentReceiverThreadIds,
  extractSubagentIdentityHints,
} from "./subagents";

export type UnifiedSubagentStatus = "running" | "completed" | "failed" | "stopped";

export interface UnifiedSubagentState {
  taskId: string;
  taskType?: string | undefined;
  title: string | null;
  currentTool?: string | undefined;
  currentDetail?: string | undefined;
  spawnCommand?: string | undefined;
  totalTokens?: number | undefined;
  toolUses?: number | undefined;
  durationMs?: number | undefined;
  status: UnifiedSubagentStatus;
  startedAt: string;
  updatedAt: string;
}

export interface UnifiedCollabSubagent {
  threadId: string;
  providerThreadId: string;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  rawStatus?: string | undefined;
  latestUpdate?: string | undefined;
}

export interface SubagentLifecycleActivity {
  kind: string;
  createdAt: string;
  turnId?: string | null | undefined;
  payload?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function firstTrimmedString(...values: ReadonlyArray<unknown>): string | undefined {
  for (const value of values) {
    const normalized = asTrimmedString(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function collabPayloadItem(payload: Record<string, unknown>): Record<string, unknown> | null {
  const data = asRecord(payload.data);
  return asRecord(data?.item) ?? data;
}

export function decodeCollabSubagents(
  item: Record<string, unknown>,
): ReadonlyArray<UnifiedCollabSubagent> {
  const receiverThreadIds = decodeSubagentReceiverThreadIds(item);
  const receiverAgents = decodeSubagentReceiverAgents(item, receiverThreadIds).map(
    (agent): UnifiedCollabSubagent => ({
      threadId: agent.providerThreadId,
      providerThreadId: agent.providerThreadId,
      ...(agent.agentId ? { agentId: agent.agentId } : {}),
      ...(agent.nickname ? { nickname: agent.nickname } : {}),
      ...(agent.role ? { role: agent.role } : {}),
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.prompt ? { prompt: agent.prompt } : {}),
    }),
  );

  const agentStates = decodeSubagentAgentStates(item);
  if (receiverAgents.length > 0 || Object.keys(agentStates).length > 0) {
    const mergedByThreadId = new Map<string, UnifiedCollabSubagent>();
    for (const agent of receiverAgents) {
      mergedByThreadId.set(agent.threadId, agent);
    }
    for (const [threadId, state] of Object.entries(agentStates)) {
      const previous = mergedByThreadId.get(threadId);
      mergedByThreadId.set(threadId, {
        threadId,
        providerThreadId: previous?.providerThreadId ?? threadId,
        ...previous,
        ...(state.agentId ? { agentId: state.agentId } : {}),
        ...(state.nickname ? { nickname: state.nickname } : {}),
        ...(state.role ? { role: state.role } : {}),
        ...(state.model ? { model: state.model } : {}),
        ...(state.prompt ? { prompt: state.prompt } : {}),
        ...(state.status ? { rawStatus: state.status } : {}),
        ...(state.message ? { latestUpdate: state.message } : {}),
      });
    }
    return [...mergedByThreadId.values()];
  }

  const singularThreadId =
    receiverThreadIds[0] ??
    asTrimmedString(
      item.receiverThreadId ?? item.receiver_thread_id ?? item.threadId ?? item.thread_id,
    );
  if (!singularThreadId) {
    const fallbackIdentity = extractSubagentIdentityHints(item).find(
      (entry) => entry.providerThreadId !== undefined,
    );
    if (!fallbackIdentity?.providerThreadId) {
      return [];
    }
    return [
      {
        threadId: fallbackIdentity.providerThreadId,
        providerThreadId: fallbackIdentity.providerThreadId,
        ...(fallbackIdentity.agentId ? { agentId: fallbackIdentity.agentId } : {}),
        ...(fallbackIdentity.nickname ? { nickname: fallbackIdentity.nickname } : {}),
        ...(fallbackIdentity.role ? { role: fallbackIdentity.role } : {}),
        ...(fallbackIdentity.model ? { model: fallbackIdentity.model } : {}),
        ...(fallbackIdentity.prompt ? { prompt: fallbackIdentity.prompt } : {}),
        ...(fallbackIdentity.status ? { rawStatus: fallbackIdentity.status } : {}),
        ...(fallbackIdentity.message ? { latestUpdate: fallbackIdentity.message } : {}),
      },
    ];
  }

  const agentId = firstTrimmedString(
    item.agentId,
    item.agent_id,
    item.newAgentId,
    item.new_agent_id,
  );
  const nickname = firstTrimmedString(
    item.newAgentNickname,
    item.new_agent_nickname,
    item.agentNickname,
    item.agent_nickname,
    item.receiverAgentNickname,
    item.receiver_agent_nickname,
  );
  const role = firstTrimmedString(
    item.receiverAgentRole,
    item.receiver_agent_role,
    item.newAgentRole,
    item.new_agent_role,
    item.agentRole,
    item.agent_role,
    item.agentType,
    item.agent_type,
  );
  const model = firstTrimmedString(
    item.model,
    item.modelName,
    item.model_name,
    item.requestedModel,
    item.requested_model,
  );
  const prompt = firstTrimmedString(item.prompt, item.task, item.message);

  return [
    {
      threadId: singularThreadId,
      providerThreadId: singularThreadId,
      ...(agentId ? { agentId } : {}),
      ...(nickname ? { nickname } : {}),
      ...(role ? { role } : {}),
      ...(model ? { model } : {}),
      ...(prompt ? { prompt } : {}),
    },
  ];
}

function taskUsage(payload: Record<string, unknown>): {
  totalTokens?: number | undefined;
  toolUses?: number | undefined;
  durationMs?: number | undefined;
} {
  const usage = asRecord(payload.usage);
  if (!usage) {
    return {};
  }
  const totalTokens = asFiniteNumber(usage.total_tokens);
  const toolUses = asFiniteNumber(usage.tool_uses);
  const durationMs = asFiniteNumber(usage.duration_ms);
  return {
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function normalizeTaskStatus(rawStatus: unknown): UnifiedSubagentStatus {
  const normalized = asTrimmedString(rawStatus)?.toLowerCase() ?? "";
  if (normalized === "failed" || normalized === "error" || normalized === "errored") {
    return "failed";
  }
  if (
    normalized === "stopped" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "interrupted" ||
    normalized === "aborted"
  ) {
    return "stopped";
  }
  return "completed";
}

function normalizeCollabStatus(rawStatus: string | undefined): UnifiedSubagentStatus {
  const normalized = rawStatus
    ? rawStatus.trim().toLowerCase().replaceAll("_", "").replaceAll("-", "")
    : "";
  if (
    !normalized ||
    normalized === "running" ||
    normalized === "inprogress" ||
    normalized === "pending" ||
    normalized === "pendinginit"
  ) {
    return "running";
  }
  if (normalized === "completed" || normalized === "done" || normalized === "success") {
    return "completed";
  }
  if (
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "errored" ||
    normalized === "notfound"
  ) {
    return "failed";
  }
  if (
    normalized === "stopped" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "interrupted" ||
    normalized === "aborted" ||
    normalized === "shutdown"
  ) {
    return "stopped";
  }
  return "completed";
}

function collabTitle(subagent: UnifiedCollabSubagent): string | null {
  const identity = subagent.nickname ?? subagent.role;
  if (identity) {
    return identity;
  }
  const promptLine = subagent.prompt
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (promptLine) {
    return promptLine.length > 120 ? `${promptLine.slice(0, 117).trimEnd()}...` : promptLine;
  }
  return subagent.model ?? null;
}

function isCollabActivity(activity: SubagentLifecycleActivity): boolean {
  if (
    activity.kind !== "tool.started" &&
    activity.kind !== "tool.updated" &&
    activity.kind !== "tool.completed"
  ) {
    return false;
  }
  return asRecord(activity.payload)?.itemType === "collab_agent_tool_call";
}

/**
 * Reduces already ordered orchestration activities into one UI-facing subagent state model.
 * Provider adapters keep their native lifecycle semantics; this is the downstream bridge.
 */
export function deriveUnifiedSubagentStates(
  activities: ReadonlyArray<SubagentLifecycleActivity>,
  latestTurnId?: string,
): UnifiedSubagentState[] {
  const byId = new Map<string, UnifiedSubagentState>();
  const commandByDescription = new Map<string, string>();

  for (const activity of activities) {
    if (
      latestTurnId &&
      activity.turnId &&
      activity.turnId !== latestTurnId &&
      activity.kind !== "task.completed" &&
      !isCollabActivity(activity)
    ) {
      continue;
    }

    const payload = asRecord(activity.payload);
    if (
      activity.kind === "tool.started" ||
      activity.kind === "tool.updated" ||
      activity.kind === "tool.completed"
    ) {
      if (payload?.itemType === "command_execution") {
        const data = asRecord(payload.data);
        const input = asRecord(data?.input);
        const description = asTrimmedString(input?.description);
        const command = asTrimmedString(input?.command);
        if (description && command) {
          commandByDescription.set(description, command);
        }
      } else if (payload?.itemType === "collab_agent_tool_call") {
        const item = collabPayloadItem(payload);
        if (!item) {
          continue;
        }
        for (const subagent of decodeCollabSubagents(item)) {
          const existing: UnifiedSubagentState = byId.get(subagent.providerThreadId) ?? {
            taskId: subagent.providerThreadId,
            title: null,
            status: "running",
            startedAt: activity.createdAt,
            updatedAt: activity.createdAt,
          };
          byId.set(subagent.providerThreadId, {
            ...existing,
            taskType: "collab_subagent",
            title: collabTitle(subagent) ?? existing.title,
            currentDetail: subagent.latestUpdate ?? existing.currentDetail,
            status: normalizeCollabStatus(subagent.rawStatus),
            updatedAt: activity.createdAt,
          });
        }
      }
      continue;
    }

    if (
      activity.kind !== "task.started" &&
      activity.kind !== "task.progress" &&
      activity.kind !== "task.completed"
    ) {
      continue;
    }
    const taskId = asTrimmedString(payload?.taskId);
    if (!payload || !taskId) {
      continue;
    }
    const existing: UnifiedSubagentState = byId.get(taskId) ?? {
      taskId,
      title: null,
      status: "running",
      startedAt: activity.createdAt,
      updatedAt: activity.createdAt,
    };

    if (activity.kind === "task.started") {
      byId.set(taskId, {
        ...existing,
        taskType: asTrimmedString(payload.taskType) ?? existing.taskType,
        title: asTrimmedString(payload.detail) ?? existing.title,
        updatedAt: activity.createdAt,
      });
      continue;
    }

    const usage = taskUsage(payload);
    if (activity.kind === "task.progress") {
      byId.set(taskId, {
        ...existing,
        currentTool: asTrimmedString(payload.lastToolName) ?? existing.currentTool,
        currentDetail: asTrimmedString(payload.detail) ?? existing.currentDetail,
        totalTokens: usage.totalTokens ?? existing.totalTokens,
        toolUses: usage.toolUses ?? existing.toolUses,
        durationMs: usage.durationMs ?? existing.durationMs,
        updatedAt: activity.createdAt,
      });
      continue;
    }

    byId.set(taskId, {
      ...existing,
      totalTokens: usage.totalTokens ?? existing.totalTokens,
      toolUses: usage.toolUses ?? existing.toolUses,
      durationMs: usage.durationMs ?? existing.durationMs,
      status: normalizeTaskStatus(payload.status),
      updatedAt: activity.createdAt,
    });
  }

  const agents = [...byId.values()].filter((agent) => agent.taskType !== "plan");
  for (const agent of agents) {
    if (!agent.title) {
      continue;
    }
    const spawnCommand = commandByDescription.get(agent.title);
    if (spawnCommand) {
      agent.spawnCommand = spawnCommand;
    }
  }
  return agents;
}
