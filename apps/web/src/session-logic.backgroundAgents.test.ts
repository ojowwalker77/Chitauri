import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveActiveBackgroundTasksState, deriveTurnBackgroundAgents } from "./session-logic";

const TURN = TurnId.makeUnsafe("turn-1");
let seq = 0;

function activity(
  kind: string,
  payload: unknown,
  opts?: { turnId?: string | null; createdAt?: string },
): OrchestrationThreadActivity {
  seq += 1;
  return {
    id: `evt-${seq}`,
    tone: "info",
    kind,
    summary: "",
    payload,
    turnId: opts?.turnId === undefined ? TURN : opts.turnId ? TurnId.makeUnsafe(opts.turnId) : null,
    sequence: seq,
    createdAt: opts?.createdAt ?? `2026-07-07T18:00:${String(seq).padStart(2, "0")}.000Z`,
  } as unknown as OrchestrationThreadActivity;
}

describe("deriveTurnBackgroundAgents", () => {
  it("reconstructs an agent across started -> progress with title, tool, detail, and usage", () => {
    const agents = deriveTurnBackgroundAgents(
      [
        activity("task.started", { taskId: "a", taskType: "local_agent", detail: "Review X" }),
        activity("task.progress", {
          taskId: "a",
          lastToolName: "Read",
          detail: "Reading foo.ts",
          usage: { total_tokens: 9967, tool_uses: 1, duration_ms: 2061 },
        }),
      ],
      TURN,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      taskId: "a",
      title: "Review X",
      currentTool: "Read",
      currentDetail: "Reading foo.ts",
      totalTokens: 9967,
      toolUses: 1,
      durationMs: 2061,
      status: "running",
    });
  });

  it("settles status from task.completed (completed / failed)", () => {
    const agents = deriveTurnBackgroundAgents(
      [
        activity("task.started", { taskId: "a", taskType: "local_agent", detail: "A" }),
        activity("task.completed", {
          taskId: "a",
          status: "completed",
          usage: { total_tokens: 12000 },
        }),
        activity("task.started", { taskId: "b", taskType: "local_agent", detail: "B" }),
        activity("task.completed", { taskId: "b", status: "failed" }),
      ],
      TURN,
    );

    expect(agents.map((agent) => [agent.taskId, agent.status])).toEqual([
      ["a", "completed"],
      ["b", "failed"],
    ]);
    expect(agents[0]?.totalTokens).toBe(12000);
  });

  it("preserves spawn order and excludes plan tasks", () => {
    const agents = deriveTurnBackgroundAgents(
      [
        activity("task.started", { taskId: "plan-1", taskType: "plan", detail: "planning" }),
        activity("task.started", { taskId: "a", taskType: "local_agent", detail: "A" }),
        activity("task.started", { taskId: "b", taskType: "local_agent", detail: "B" }),
      ],
      TURN,
    );

    expect(agents.map((agent) => agent.taskId)).toEqual(["a", "b"]);
  });

  it("links a local_bash agent to its spawn command by matching description", () => {
    const agents = deriveTurnBackgroundAgents(
      [
        activity("task.started", {
          taskId: "a",
          taskType: "local_bash",
          detail: "Relaunch Flash",
        }),
        activity("tool.started", {
          itemType: "command_execution",
          data: {
            input: {
              description: "Relaunch Flash",
              command: "agy --model gemini-3.5-flash -p 'x'",
            },
          },
        }),
      ],
      TURN,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]?.spawnCommand).toBe("agy --model gemini-3.5-flash -p 'x'");
  });
});

describe("deriveActiveBackgroundTasksState reuses the fleet derivation", () => {
  it("counts only running agents, ignoring completed ones", () => {
    const activities = [
      activity("task.started", { taskId: "a", taskType: "local_agent", detail: "A" }),
      activity("task.started", { taskId: "b", taskType: "local_agent", detail: "B" }),
      activity("task.completed", { taskId: "b", status: "completed" }),
    ];
    expect(deriveActiveBackgroundTasksState(activities, TURN)).toEqual({ activeCount: 1 });
  });

  it("returns null when nothing is running", () => {
    const activities = [
      activity("task.started", { taskId: "a", taskType: "local_agent", detail: "A" }),
      activity("task.completed", { taskId: "a", status: "completed" }),
    ];
    expect(deriveActiveBackgroundTasksState(activities, TURN)).toBeNull();
  });
});
