import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("055_Workspaces", (it) => {
  it.effect("backfills durable workspace identity while retaining legacy thread fields", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, is_pinned, created_at, updated_at, deleted_at
        ) VALUES ('project-1', 'project', 'Project', '/tmp/project-1', '[]', 0, '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL)
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, env_mode,
          branch, worktree_path, associated_worktree_path, associated_worktree_branch, associated_worktree_ref,
          created_at, updated_at, deleted_at
        ) VALUES (
          'thread-1', 'project-1', 'Worktree', '{"provider":"codex","model":"gpt-5.4"}', 'full-access', 'default', 'worktree',
          'feature/workspace', '/tmp/project-1/.worktrees/feature', '/tmp/project-1/.worktrees/feature', 'feature/workspace', 'feature/workspace',
          '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL
        )
      `;

      yield* runMigrations();
      assert.deepStrictEqual(migrationEntries.find(([id]) => id === 55)?.slice(0, 2), [
        55,
        "Workspaces",
      ]);
      const rows = yield* sql<{
        readonly workspace_id: string;
        readonly kind: string;
        readonly state: string;
        readonly path: string;
        readonly branch: string;
      }>`SELECT workspace_id, kind, state, path, branch FROM workspaces`;
      assert.deepStrictEqual(rows, [
        {
          workspace_id: "legacy-thread-thread-1",
          kind: "worktree",
          state: "ready",
          path: "/tmp/project-1/.worktrees/feature",
          branch: "feature/workspace",
        },
      ]);
      const threads = yield* sql<{ readonly workspace_id: string; readonly worktree_path: string }>`
        SELECT workspace_id, worktree_path FROM projection_threads WHERE thread_id = 'thread-1'
      `;
      assert.deepStrictEqual(threads, [
        {
          workspace_id: "legacy-thread-thread-1",
          worktree_path: "/tmp/project-1/.worktrees/feature",
        },
      ]);
    }),
  );
});
