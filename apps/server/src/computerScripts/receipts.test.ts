import * as fs from "node:fs/promises";
import OS from "node:os";
import * as nodePath from "node:path";

import {
  ComputerScriptAnalysisId,
  ComputerScriptCandidateId,
  ComputerScriptId,
  ComputerScriptRunId,
  type ComputerScriptsRunSnapshot,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { loadAndReconcileRunHistory, readRunHistory, writeRunHistoryAtomically } from "./receipts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => fs.rm(path, { force: true, recursive: true })),
  );
});

function runningSnapshot(): ComputerScriptsRunSnapshot {
  return {
    id: ComputerScriptRunId.makeUnsafe("computer-run:test"),
    analysisId: ComputerScriptAnalysisId.makeUnsafe("computer-analysis:test"),
    utilityId: ComputerScriptId.makeUnsafe("computer-script:test"),
    state: "running",
    startedAt: "2026-07-16T12:00:00.000Z",
    completedAt: null,
    selectedCandidateIds: [ComputerScriptCandidateId.makeUnsafe("computer-candidate:test")],
    estimatedBytes: 10,
    reclaimedBytes: 0,
    removedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    progress: { current: 0, total: 1, label: "Starting run", bytes: 0 },
    logs: [],
    results: [],
    error: null,
  };
}

describe("Computer Scripts receipts", () => {
  it("atomically reconciles a persisted running receipt to interrupted on restart", async () => {
    const root = await fs.mkdtemp(nodePath.join(OS.tmpdir(), "chitauri-computer-receipts-"));
    temporaryDirectories.push(root);
    const path = nodePath.join(root, "computer-scripts-runs.json");
    await writeRunHistoryAtomically(path, [runningSnapshot()]);

    const interruptedAt = "2026-07-16T12:05:00.000Z";
    const reconciled = await loadAndReconcileRunHistory(path, interruptedAt);

    expect(reconciled[0]).toMatchObject({
      state: "interrupted",
      completedAt: interruptedAt,
      error: "Run interrupted because the Chitauri server restarted.",
    });
    expect((await readRunHistory(path))[0]?.state).toBe("interrupted");
    expect((await fs.readdir(root)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });
});
