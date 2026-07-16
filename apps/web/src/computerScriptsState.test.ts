import {
  ComputerScriptAnalysisId,
  ComputerScriptId,
  type ComputerScriptsAnalysisSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  analysisForUtility,
  applyComputerScriptsEvent,
  emptyComputerScriptsViewState,
} from "./computerScriptsState";

function analysisSnapshot(input: {
  id: string;
  utilityId: string;
  startedAt: string;
  state?: ComputerScriptsAnalysisSnapshot["state"];
}): ComputerScriptsAnalysisSnapshot {
  const completed = input.state === "review";
  return {
    id: ComputerScriptAnalysisId.makeUnsafe(input.id),
    utilityId: ComputerScriptId.makeUnsafe(input.utilityId),
    state: input.state ?? "analyzing",
    startedAt: input.startedAt,
    completedAt: completed ? "2026-07-16T12:01:00.000Z" : null,
    options: { roots: [], minAgeDays: 30, minBytes: 0, includeProtected: false },
    candidates: [],
    estimatedBytes: 0,
    progress: { current: completed ? 1 : 0, total: completed ? 1 : null, label: null, bytes: 0 },
    logs: [],
    error: null,
  };
}

describe("Computer Scripts view state", () => {
  it("keeps late analysis events isolated to their utility", () => {
    const utilityA = ComputerScriptId.makeUnsafe("utility:a");
    const utilityB = ComputerScriptId.makeUnsafe("utility:b");
    const analysisA = analysisSnapshot({
      id: "analysis:a",
      utilityId: utilityA,
      startedAt: "2026-07-16T12:00:00.000Z",
    });
    const analysisB = analysisSnapshot({
      id: "analysis:b",
      utilityId: utilityB,
      startedAt: "2026-07-16T12:00:01.000Z",
    });
    let state = emptyComputerScriptsViewState();
    state = applyComputerScriptsEvent(state, { type: "analysis", snapshot: analysisA });
    state = applyComputerScriptsEvent(state, { type: "analysis", snapshot: analysisB });
    state = applyComputerScriptsEvent(state, {
      type: "analysis",
      snapshot: { ...analysisA, state: "review", completedAt: "2026-07-16T12:02:00.000Z" },
    });

    expect(analysisForUtility(state, utilityB)?.id).toBe(analysisB.id);
    expect(analysisForUtility(state, utilityA)?.state).toBe("review");
  });

  it("does not regress a completed analysis when an older initial response arrives late", () => {
    const utilityId = ComputerScriptId.makeUnsafe("utility:a");
    const analyzing = analysisSnapshot({
      id: "analysis:a",
      utilityId,
      startedAt: "2026-07-16T12:00:00.000Z",
    });
    let state = applyComputerScriptsEvent(emptyComputerScriptsViewState(), {
      type: "analysis",
      snapshot: { ...analyzing, state: "review", completedAt: "2026-07-16T12:01:00.000Z" },
    });
    state = applyComputerScriptsEvent(state, { type: "analysis", snapshot: analyzing });

    expect(analysisForUtility(state, utilityId)?.state).toBe("review");
  });
});
