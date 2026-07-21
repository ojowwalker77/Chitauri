// FILE: ProjectionTasks.ts
// Purpose: SQLite implementation of the durable Task projection repository.
// Layer: Server persistence layer

import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionTaskInput,
  ListProjectionTasksByWorkerInput,
  ProjectionTask,
  ProjectionTaskRepository,
  type ProjectionTaskRepositoryShape,
} from "../Services/ProjectionTasks.ts";

const makeProjectionTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionTask,
    execute: (row) => sql`
      INSERT INTO projection_tasks (
        task_id, worker_id, requester_worker_id, requester_task_id,
        title, brief, status, origin, completion_summary,
        created_at, updated_at, completed_at
      ) VALUES (
        ${row.taskId}, ${row.workerId}, ${row.requesterWorkerId}, ${row.requesterTaskId},
        ${row.title}, ${row.brief}, ${row.status}, ${row.origin},
        ${row.completionSummary}, ${row.createdAt}, ${row.updatedAt}, ${row.completedAt}
      )
      ON CONFLICT (task_id) DO UPDATE SET
        worker_id = excluded.worker_id,
        requester_worker_id = excluded.requester_worker_id,
        requester_task_id = excluded.requester_task_id,
        title = excluded.title,
        brief = excluded.brief,
        status = excluded.status,
        origin = excluded.origin,
        completion_summary = excluded.completion_summary,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `,
  });

  const getByIdRow = SqlSchema.findOneOption({
    Request: GetProjectionTaskInput,
    Result: ProjectionTask,
    execute: ({ taskId }) => sql`
      SELECT
        task_id AS "taskId", worker_id AS "workerId",
        requester_worker_id AS "requesterWorkerId", requester_task_id AS "requesterTaskId",
        title, brief, status, origin,
        completion_summary AS "completionSummary", created_at AS "createdAt",
        updated_at AS "updatedAt", completed_at AS "completedAt"
      FROM projection_tasks
      WHERE task_id = ${taskId}
    `,
  });

  const listAllRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionTask,
    execute: () => sql`
      SELECT
        task_id AS "taskId", worker_id AS "workerId",
        requester_worker_id AS "requesterWorkerId", requester_task_id AS "requesterTaskId",
        title, brief, status, origin,
        completion_summary AS "completionSummary", created_at AS "createdAt",
        updated_at AS "updatedAt", completed_at AS "completedAt"
      FROM projection_tasks
      ORDER BY updated_at DESC, task_id ASC
    `,
  });

  const listByWorkerRows = SqlSchema.findAll({
    Request: ListProjectionTasksByWorkerInput,
    Result: ProjectionTask,
    execute: ({ workerId }) => sql`
      SELECT
        task_id AS "taskId", worker_id AS "workerId",
        requester_worker_id AS "requesterWorkerId", requester_task_id AS "requesterTaskId",
        title, brief, status, origin,
        completion_summary AS "completionSummary", created_at AS "createdAt",
        updated_at AS "updatedAt", completed_at AS "completedAt"
      FROM projection_tasks
      WHERE worker_id = ${workerId}
      ORDER BY updated_at DESC, task_id ASC
    `,
  });

  return {
    upsert: (task) =>
      upsertRow(task).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.upsert:query")),
      ),
    getById: (input) =>
      getByIdRow(input).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.getById:query")),
      ),
    listAll: () =>
      listAllRows(undefined).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.listAll:query")),
      ),
    listByWorkerId: (input) =>
      listByWorkerRows(input).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.listByWorkerId:query")),
      ),
  } satisfies ProjectionTaskRepositoryShape;
});

export const ProjectionTaskRepositoryLive = Layer.effect(
  ProjectionTaskRepository,
  makeProjectionTaskRepository,
);
