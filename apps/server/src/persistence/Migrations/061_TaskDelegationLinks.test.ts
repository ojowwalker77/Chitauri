import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("061_TaskDelegationLinks", (it) => {
  it.effect("preserves existing Tasks with null requester references", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 60 });
      yield* sql`
        INSERT INTO projection_tasks (
          task_id, worker_id, title, brief, status, origin,
          completion_summary, created_at, updated_at, completed_at
        ) VALUES (
          'task-1', 'worker-1', 'Existing Task', 'Created before delegation links', 'open', 'user',
          NULL, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL
        )
      `;

      yield* runMigrations();

      const tasks = yield* sql<{
        readonly requester_worker_id: string | null;
        readonly requester_task_id: string | null;
      }>`
        SELECT requester_worker_id, requester_task_id
        FROM projection_tasks
        WHERE task_id = 'task-1'
      `;
      assert.deepStrictEqual(tasks, [{ requester_worker_id: null, requester_task_id: null }]);
    }),
  );

  it.effect("is registered and idempotent", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      yield* runMigrations();

      assert.deepStrictEqual(migrationEntries.find(([id]) => id === 61)?.slice(0, 2), [
        61,
        "TaskDelegationLinks",
      ]);
    }),
  );
});
