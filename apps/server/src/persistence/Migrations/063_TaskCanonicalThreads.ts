// FILE: 063_TaskCanonicalThreads.ts
// Purpose: Enforce the product invariant that one durable Task owns one canonical Thread.

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Older builds allowed the Task detail screen to create any number of Threads.
  // Preserve every Thread, but keep only the oldest one tracked by the Task.
  yield* sql`
    UPDATE projection_threads AS candidate
    SET task_id = NULL
    WHERE candidate.task_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM projection_threads AS canonical
        WHERE canonical.task_id = candidate.task_id
          AND (
            canonical.created_at < candidate.created_at
            OR (
              canonical.created_at = candidate.created_at
              AND canonical.thread_id < candidate.thread_id
            )
          )
      )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS projection_threads_canonical_task_idx
    ON projection_threads(task_id)
    WHERE task_id IS NOT NULL
  `;
});
