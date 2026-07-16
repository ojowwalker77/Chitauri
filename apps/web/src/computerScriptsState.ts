import type {
  ComputerScriptAnalysisId,
  ComputerScriptId,
  ComputerScriptRunId,
  ComputerScriptsAnalysisSnapshot,
  ComputerScriptsRunSnapshot,
  ComputerScriptsStreamEvent,
} from "@t3tools/contracts";

export interface ComputerScriptsViewState {
  readonly analyses: ReadonlyMap<ComputerScriptAnalysisId, ComputerScriptsAnalysisSnapshot>;
  readonly analysisByUtility: ReadonlyMap<ComputerScriptId, ComputerScriptAnalysisId>;
  readonly runs: ReadonlyMap<ComputerScriptRunId, ComputerScriptsRunSnapshot>;
  readonly runByUtility: ReadonlyMap<ComputerScriptId, ComputerScriptRunId>;
}

export function emptyComputerScriptsViewState(): ComputerScriptsViewState {
  return {
    analyses: new Map(),
    analysisByUtility: new Map(),
    runs: new Map(),
    runByUtility: new Map(),
  };
}

function shouldActivateSnapshot(
  currentStartedAt: string | undefined,
  incomingStartedAt: string,
): boolean {
  return currentStartedAt === undefined || incomingStartedAt >= currentStartedAt;
}

function newestSnapshot<
  Snapshot extends ComputerScriptsAnalysisSnapshot | ComputerScriptsRunSnapshot,
>(existing: Snapshot | undefined, incoming: Snapshot): Snapshot {
  if (!existing) return incoming;
  if (existing.completedAt && !incoming.completedAt) return existing;
  if (!existing.completedAt && incoming.completedAt) return incoming;
  if (incoming.progress.current < existing.progress.current) return existing;
  return incoming;
}

export function applyComputerScriptsEvent(
  state: ComputerScriptsViewState,
  event: ComputerScriptsStreamEvent,
): ComputerScriptsViewState {
  if (event.type === "analysis") {
    const snapshot = newestSnapshot(state.analyses.get(event.snapshot.id), event.snapshot);
    const analyses = new Map(state.analyses).set(snapshot.id, snapshot);
    const currentId = state.analysisByUtility.get(event.snapshot.utilityId);
    const current = currentId ? analyses.get(currentId) : undefined;
    const analysisByUtility = new Map(state.analysisByUtility);
    if (
      currentId === snapshot.id ||
      shouldActivateSnapshot(current?.startedAt, snapshot.startedAt)
    ) {
      analysisByUtility.set(snapshot.utilityId, snapshot.id);
    }
    return { ...state, analyses, analysisByUtility };
  }

  const snapshot = newestSnapshot(state.runs.get(event.snapshot.id), event.snapshot);
  const runs = new Map(state.runs).set(snapshot.id, snapshot);
  const currentId = state.runByUtility.get(event.snapshot.utilityId);
  const current = currentId ? runs.get(currentId) : undefined;
  const runByUtility = new Map(state.runByUtility);
  if (currentId === snapshot.id || shouldActivateSnapshot(current?.startedAt, snapshot.startedAt)) {
    runByUtility.set(snapshot.utilityId, snapshot.id);
  }
  return { ...state, runs, runByUtility };
}

export function analysisForUtility(
  state: ComputerScriptsViewState,
  utilityId: ComputerScriptId | undefined,
): ComputerScriptsAnalysisSnapshot | null {
  if (!utilityId) return null;
  const analysisId = state.analysisByUtility.get(utilityId);
  return analysisId ? (state.analyses.get(analysisId) ?? null) : null;
}

export function runForUtility(
  state: ComputerScriptsViewState,
  utilityId: ComputerScriptId | undefined,
): ComputerScriptsRunSnapshot | null {
  if (!utilityId) return null;
  const runId = state.runByUtility.get(utilityId);
  return runId ? (state.runs.get(runId) ?? null) : null;
}
