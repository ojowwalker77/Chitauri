// FILE: 060_WorkersTasks.ts
// Purpose: Add Worker instructions, durable Tasks, and optional Thread-to-Task ownership.
// Layer: Server persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* columnExists(sql, "projection_projects", "worker_instructions"))) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN worker_instructions TEXT NOT NULL DEFAULT ''
    `;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_tasks (
      task_id TEXT PRIMARY KEY NOT NULL,
      worker_id TEXT NOT NULL,
      title TEXT NOT NULL,
      brief TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      origin TEXT NOT NULL,
      completion_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS projection_tasks_worker_status_updated_idx
    ON projection_tasks(worker_id, status, updated_at DESC)
  `;

  if (!(yield* columnExists(sql, "projection_threads", "task_id"))) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN task_id TEXT`;
  }
  yield* sql`
    CREATE INDEX IF NOT EXISTS projection_threads_task_id_idx
    ON projection_threads(task_id)
  `;
});
