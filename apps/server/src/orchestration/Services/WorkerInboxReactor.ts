// FILE: WorkerInboxReactor.ts
// Purpose: Service contract for the reactor that answers cross-Worker inbox requests.
// Layer: Server orchestration service

import { Effect, Scope, ServiceMap } from "effect";

export interface WorkerInboxReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class WorkerInboxReactor extends ServiceMap.Service<
  WorkerInboxReactor,
  WorkerInboxReactorShape
>()("t3/orchestration/Services/WorkerInboxReactor") {}
