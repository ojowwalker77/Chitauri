import { describe, expect, it } from "vitest";

import { deriveUnifiedSubagentStates } from "./subagentActivity";

const createdAt = (seconds: number) =>
  `2026-07-15T18:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("deriveUnifiedSubagentStates", () => {
  it("normalizes Claude and Codex activity into the same live display state", () => {
    const claude = deriveUnifiedSubagentStates(
      [
        {
          kind: "task.started",
          createdAt: createdAt(1),
          turnId: "turn-1",
          payload: {
            taskId: "claude-agent-1",
            taskType: "local_agent",
            detail: "Map session toolbar components",
          },
        },
        {
          kind: "task.progress",
          createdAt: createdAt(2),
          turnId: "turn-1",
          payload: {
            taskId: "claude-agent-1",
            lastToolName: "Read",
            detail: "Inspecting ChatView.tsx",
          },
        },
      ],
      "turn-1",
    );
    const codex = deriveUnifiedSubagentStates(
      [
        {
          kind: "tool.completed",
          createdAt: createdAt(1),
          turnId: "turn-1",
          payload: {
            itemType: "collab_agent_tool_call",
            data: {
              item: {
                type: "collabAgentToolCall",
                id: "spawn-call-1",
                tool: "spawnAgent",
                receiverThreadIds: ["codex-agent-1"],
                prompt: "Map session toolbar components\nInspect the relevant UI files.",
                agentsStates: {
                  "codex-agent-1": {
                    status: "pendingInit",
                    message: "Inspecting ChatView.tsx",
                  },
                },
              },
            },
          },
        },
      ],
      "turn-1",
    );

    expect(claude[0]).toMatchObject({
      title: "Map session toolbar components",
      currentDetail: "Inspecting ChatView.tsx",
      status: "running",
    });
    expect(codex[0]).toMatchObject({
      title: "Map session toolbar components",
      currentDetail: "Inspecting ChatView.tsx",
      status: "running",
    });
  });

  it("preserves provider-specific metadata behind the unified state boundary", () => {
    const [claude] = deriveUnifiedSubagentStates([
      {
        kind: "task.started",
        createdAt: createdAt(1),
        payload: {
          taskId: "claude-agent-1",
          taskType: "local_bash",
          detail: "Relaunch Flash",
        },
      },
      {
        kind: "tool.started",
        createdAt: createdAt(2),
        payload: {
          itemType: "command_execution",
          data: {
            input: {
              description: "Relaunch Flash",
              command: "agy --model gemini-3.5-flash -p 'x'",
            },
          },
        },
      },
    ]);

    expect(claude).toMatchObject({
      taskType: "local_bash",
      spawnCommand: "agy --model gemini-3.5-flash -p 'x'",
    });
  });

  it("maps Codex terminal states into the shared status vocabulary", () => {
    const statuses = {
      completed: "completed",
      errored: "failed",
      interrupted: "stopped",
      shutdown: "stopped",
      notFound: "failed",
    } as const;

    for (const [rawStatus, expectedStatus] of Object.entries(statuses)) {
      const [agent] = deriveUnifiedSubagentStates([
        {
          kind: "tool.completed",
          createdAt: createdAt(1),
          payload: {
            itemType: "collab_agent_tool_call",
            data: {
              item: {
                id: `wait-${rawStatus}`,
                tool: "wait",
                receiverThreadIds: ["codex-agent-1"],
                agentsStates: {
                  "codex-agent-1": { status: rawStatus },
                },
              },
            },
          },
        },
      ]);

      expect(agent?.status).toBe(expectedStatus);
    }
  });
});
