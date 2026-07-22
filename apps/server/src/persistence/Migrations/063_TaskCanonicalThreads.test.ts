import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("063_TaskCanonicalThreads", (it) => {
  it.effect("keeps the oldest Task Thread and makes later Threads unfiled", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 62 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, task_id, title, model_selection_json, runtime_mode,
          env_mode, branch, worktree_path, created_at, updated_at, deleted_at
        ) VALUES
          ('thread-b', 'worker-1', 'task-1', 'Later', '{"provider":"codex","model":"gpt-5.4"}',
           'full-access', 'worktree', NULL, NULL, '2026-07-21T01:00:00.000Z', '2026-07-21T01:00:00.000Z', NULL),
          ('thread-a', 'worker-1', 'task-1', 'Canonical', '{"provider":"codex","model":"gpt-5.4"}',
           'full-access', 'worktree', NULL, NULL, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL)
      `;

      yield* runMigrations();

      const rows = yield* sql<{ readonly thread_id: string; readonly task_id: string | null }>`
        SELECT thread_id, task_id FROM projection_threads ORDER BY thread_id
      `;
      assert.deepStrictEqual(rows, [
        { thread_id: "thread-a", task_id: "task-1" },
        { thread_id: "thread-b", task_id: null },
      ]);
      yield* Effect.flip(
        sql`UPDATE projection_threads SET task_id = 'task-1' WHERE thread_id = 'thread-b'`,
      );
    }),
  );

  it.effect("is registered and idempotent", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      yield* runMigrations();
      assert.deepStrictEqual(migrationEntries.find(([id]) => id === 63)?.slice(0, 2), [
        63,
        "TaskCanonicalThreads",
      ]);
    }),
  );
});
