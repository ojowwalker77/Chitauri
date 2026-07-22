// FILE: 064_TaskRequesterThread.ts
// Purpose: Record which Thread sent a delegation Task, so replies can route back to it.
// Layer: Server persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A delegation Task is a channel between two Threads. The responder end is the
  // Task's canonical Thread (`projection_threads.task_id`, unique per Task since
  // migration 063); this column records the other end — the Thread that sent the
  // request — so a reply reaches a live conversation instead of dead-ending.
  if (!(yield* columnExists(sql, "projection_tasks", "requester_thread_id"))) {
    yield* sql`ALTER TABLE projection_tasks ADD COLUMN requester_thread_id TEXT`;
  }
  yield* sql`
    CREATE INDEX IF NOT EXISTS projection_tasks_requester_thread_idx
    ON projection_tasks(requester_thread_id, updated_at DESC)
  `;
});
