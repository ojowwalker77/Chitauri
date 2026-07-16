import type { ModelSelection, OrchestratorLane, ThreadId } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface OrchestratorBrief {
  readonly goal: string;
  readonly paths: readonly string[];
  readonly constraints: readonly string[];
  readonly dontTouch: readonly string[];
  readonly doneCriteria: readonly string[];
}

export interface OrchestratorTaskResult {
  readonly taskId: string;
  readonly status: "needs_review" | "failed";
  readonly lane: OrchestratorLane;
  readonly modelSelection: ModelSelection;
  readonly childThreadId: ThreadId | null;
  readonly finalMessage: string | null;
  readonly diffStat: string | null;
  readonly error: string | null;
}

export interface OrchestratorTaskStatus {
  readonly taskId: string;
  readonly status: "running" | "needs_review" | "failed";
  readonly lane: OrchestratorLane;
  readonly childThreadId: ThreadId | null;
}

export interface OrchestratorMcpServerConfig {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly toolTimeoutMs: number;
}

export interface OrchestratorControlPlaneShape {
  readonly getMcpServerForSeat: (
    seatThreadId: ThreadId,
  ) => Effect.Effect<OrchestratorMcpServerConfig, Error>;
  readonly handleHttpRequest: (request: Request) => Effect.Effect<Response, Error>;
  readonly getTaskStatus: (
    seatThreadId: ThreadId,
    taskId: string,
  ) => Effect.Effect<OrchestratorTaskStatus, Error>;
  readonly getTaskResult: (
    seatThreadId: ThreadId,
    taskId: string,
  ) => Effect.Effect<OrchestratorTaskResult, Error>;
}

export class OrchestratorControlPlane extends ServiceMap.Service<
  OrchestratorControlPlane,
  OrchestratorControlPlaneShape
>()("t3/orchestrator/Services/OrchestratorControlPlane") {}
