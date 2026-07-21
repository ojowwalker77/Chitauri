import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("060_WorkersTasks", (it) => {
  it.effect("adds Worker instructions, durable Tasks, and nullable Thread ownership", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 59 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, is_pinned, created_at, updated_at, deleted_at
        ) VALUES (
          'project-1', 'project', 'Project', '/tmp/project-1', '[]', 0,
          '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          env_mode, branch, worktree_path, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-1', 'project-1', 'Unfiled thread',
          '{"provider":"codex","model":"gpt-5.4"}', 'full-access',
          'local', NULL, NULL, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL
        )
      `;

      yield* runMigrations();

      const projects = yield* sql<{ readonly worker_instructions: string }>`
        SELECT worker_instructions FROM projection_projects WHERE project_id = 'project-1'
      `;
      assert.deepStrictEqual(projects, [{ worker_instructions: "" }]);

      const threads = yield* sql<{ readonly task_id: string | null }>`
        SELECT task_id FROM projection_threads WHERE thread_id = 'thread-1'
      `;
      assert.deepStrictEqual(threads, [{ task_id: null }]);

      yield* sql`
        INSERT INTO projection_tasks (
          task_id, worker_id, title, brief, status, origin,
          completion_summary, created_at, updated_at, completed_at
        ) VALUES (
          'task-1', 'project-1', 'Ship Workers', 'Ground the pivot', 'in_progress', 'user',
          NULL, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL
        )
      `;
      yield* sql`UPDATE projection_threads SET task_id = 'task-1' WHERE thread_id = 'thread-1'`;

      const tasks = yield* sql<{
        readonly task_id: string;
        readonly worker_id: string;
        readonly status: string;
      }>`SELECT task_id, worker_id, status FROM projection_tasks`;
      assert.deepStrictEqual(tasks, [
        { task_id: "task-1", worker_id: "project-1", status: "in_progress" },
      ]);
    }),
  );

  it.effect("is registered and idempotent", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      yield* runMigrations();

      assert.deepStrictEqual(migrationEntries.find(([id]) => id === 60)?.slice(0, 2), [
        60,
        "WorkersTasks",
      ]);
    }),
  );
});
