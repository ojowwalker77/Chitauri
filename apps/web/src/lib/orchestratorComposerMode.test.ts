import { describe, expect, it } from "vitest";

import {
  composerThreadModeFromOrchestratorFlag,
  orchestratorFlagFromComposerThreadMode,
  resolveOrchestratorSeatModel,
} from "./orchestratorComposerMode";

describe("orchestrator composer mode", () => {
  const seatModels = [
    { provider: "codex" as const, model: "gpt-seat" },
    { provider: "claudeAgent" as const, model: "claude-seat" },
  ];

  it("maps the durable thread flag to the user-facing mode", () => {
    expect(composerThreadModeFromOrchestratorFlag(true)).toBe("orchestrator");
    expect(composerThreadModeFromOrchestratorFlag(false)).toBe("single-agent");
    expect(orchestratorFlagFromComposerThreadMode("orchestrator")).toBe(true);
    expect(orchestratorFlagFromComposerThreadMode("single-agent")).toBe(false);
  });

  it("keeps the preferred provider when it has an allowed seat model", () => {
    expect(resolveOrchestratorSeatModel(seatModels, "claudeAgent")).toEqual({
      provider: "claudeAgent",
      model: "claude-seat",
    });
  });

  it("falls back deterministically to the first allowed seat model", () => {
    expect(resolveOrchestratorSeatModel(seatModels, "cursor")).toEqual({
      provider: "codex",
      model: "gpt-seat",
    });
    expect(resolveOrchestratorSeatModel([], "codex")).toBeNull();
  });
});
