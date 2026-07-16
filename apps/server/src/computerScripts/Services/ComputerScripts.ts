import type {
  ComputerScriptsAnalysisInput,
  ComputerScriptsAnalysisSnapshot,
  ComputerScriptsCancelAnalysisInput,
  ComputerScriptsCancelRunInput,
  ComputerScriptsCatalogResult,
  ComputerScriptsListHistoryInput,
  ComputerScriptsListHistoryResult,
  ComputerScriptsRunInput,
  ComputerScriptsRunSnapshot,
  ComputerScriptsStartAnalysisInput,
  ComputerScriptsStartAnalysisResult,
  ComputerScriptsStartRunInput,
  ComputerScriptsStartRunResult,
  ComputerScriptsStreamEvent,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export interface ComputerScriptsShape {
  readonly catalog: () => Effect.Effect<ComputerScriptsCatalogResult, Error>;
  readonly startAnalysis: (
    input: ComputerScriptsStartAnalysisInput,
  ) => Effect.Effect<ComputerScriptsStartAnalysisResult, Error>;
  readonly analysis: (
    input: ComputerScriptsAnalysisInput,
  ) => Effect.Effect<ComputerScriptsAnalysisSnapshot, Error>;
  readonly cancelAnalysis: (
    input: ComputerScriptsCancelAnalysisInput,
  ) => Effect.Effect<ComputerScriptsAnalysisSnapshot, Error>;
  readonly startRun: (
    input: ComputerScriptsStartRunInput,
  ) => Effect.Effect<ComputerScriptsStartRunResult, Error>;
  readonly run: (
    input: ComputerScriptsRunInput,
  ) => Effect.Effect<ComputerScriptsRunSnapshot, Error>;
  readonly cancelRun: (
    input: ComputerScriptsCancelRunInput,
  ) => Effect.Effect<ComputerScriptsRunSnapshot, Error>;
  readonly listHistory: (
    input: ComputerScriptsListHistoryInput,
  ) => Effect.Effect<ComputerScriptsListHistoryResult, Error>;
  readonly streamEvents: Stream.Stream<ComputerScriptsStreamEvent, never, never>;
}

export class ComputerScripts extends ServiceMap.Service<ComputerScripts, ComputerScriptsShape>()(
  "t3/computerScripts/Services/ComputerScripts",
) {}
