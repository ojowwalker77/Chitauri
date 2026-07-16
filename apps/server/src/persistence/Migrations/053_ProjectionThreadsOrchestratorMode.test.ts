import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("053_ProjectionThreadsOrchestratorMode", (it) => {
  it.effect("adds a disabled-by-default orchestrator seat marker", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      const entry = migrationEntries.find(([id]) => id === 53);
      assert.deepStrictEqual(entry?.slice(0, 2), [53, "ProjectionThreadsOrchestratorMode"]);

      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, is_pinned,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-seat', 'project', 'Seat project', '/tmp/seat', '[]', 0,
          '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, env_mode, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-seat', 'project-seat', 'Seat',
          '{"provider":"codex","model":"gpt-5.6-sol"}',
          'full-access', 'default', 'local',
          '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', NULL
        )
      `;

      const rows = yield* sql<{ readonly orchestrator_mode: number }>`
        SELECT orchestrator_mode FROM projection_threads WHERE thread_id = 'thread-seat'
      `;
      assert.deepStrictEqual(rows, [{ orchestrator_mode: 0 }]);
    }),
  );
});
