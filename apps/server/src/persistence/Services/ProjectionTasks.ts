// FILE: ProjectionTasks.ts
// Purpose: Durable Task projection repository contract.
// Layer: Server persistence service

import {
  IsoDateTime,
  ProjectId,
  TaskArtifact,
  TaskId,
  TaskOrigin,
  TaskStatus,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTask = Schema.Struct({
  taskId: TaskId,
  workerId: ProjectId,
  requesterWorkerId: Schema.NullOr(ProjectId),
  requesterTaskId: Schema.NullOr(TaskId),
  title: Schema.String,
  brief: Schema.String,
  status: TaskStatus,
  origin: TaskOrigin,
  artifacts: Schema.Array(TaskArtifact),
  completionSummary: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionTask = typeof ProjectionTask.Type;

export const GetProjectionTaskInput = Schema.Struct({ taskId: TaskId });
export type GetProjectionTaskInput = typeof GetProjectionTaskInput.Type;

export const ListProjectionTasksByWorkerInput = Schema.Struct({ workerId: ProjectId });
export type ListProjectionTasksByWorkerInput = typeof ListProjectionTasksByWorkerInput.Type;

export interface ProjectionTaskRepositoryShape {
  readonly upsert: (task: ProjectionTask) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionTaskInput,
  ) => Effect.Effect<Option.Option<ProjectionTask>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionTask>, ProjectionRepositoryError>;
  readonly listByWorkerId: (
    input: ListProjectionTasksByWorkerInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTask>, ProjectionRepositoryError>;
}

export class ProjectionTaskRepository extends ServiceMap.Service<
  ProjectionTaskRepository,
  ProjectionTaskRepositoryShape
>()("t3/persistence/Services/ProjectionTasks/ProjectionTaskRepository") {}
