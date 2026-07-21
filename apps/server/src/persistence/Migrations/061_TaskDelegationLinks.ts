// FILE: 061_TaskDelegationLinks.ts
// Purpose: Preserve the requesting Worker and parent Task for delegated Tasks.

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* columnExists(sql, "projection_tasks", "requester_worker_id"))) {
    yield* sql`ALTER TABLE projection_tasks ADD COLUMN requester_worker_id TEXT`;
  }
  if (!(yield* columnExists(sql, "projection_tasks", "requester_task_id"))) {
    yield* sql`ALTER TABLE projection_tasks ADD COLUMN requester_task_id TEXT`;
  }
  yield* sql`
    CREATE INDEX IF NOT EXISTS projection_tasks_requester_task_idx
    ON projection_tasks(requester_task_id, updated_at DESC)
  `;
});
