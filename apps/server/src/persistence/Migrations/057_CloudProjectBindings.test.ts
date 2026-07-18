import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations";
import * as NodeSqliteClient from "../NodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("057_CloudProjectBindings", (it) => {
  it.effect("creates a secret-free binding table and cascades hard project deletion", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA foreign_keys = ON`;
      yield* runMigrations({ toMigrationInclusive: 56 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, is_pinned,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-cloud', 'project', 'Cloud project', '/tmp/project-cloud', '[]', 0,
          '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL
        )
      `;

      yield* runMigrations();
      yield* runMigrations();
      assert.deepStrictEqual(migrationEntries.find(([id]) => id === 57)?.slice(0, 2), [
        57,
        "CloudProjectBindings",
      ]);

      const columns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('cloud_project_bindings') ORDER BY cid
      `;
      assert.deepStrictEqual(
        columns.map((column) => column.name),
        [
          "binding_id",
          "project_id",
          "context_id",
          "environment",
          "regions_json",
          "expected_account_id",
          "expected_project_id",
          "created_at",
          "updated_at",
        ],
      );

      const invalidScope = yield* Effect.exit(sql`
        INSERT INTO cloud_project_bindings (
          binding_id, project_id, context_id, environment, regions_json,
          expected_account_id, expected_project_id, created_at, updated_at
        ) VALUES (
          'binding-invalid', 'project-cloud', 'aws:default', 'Invalid', '["us-east-1"]',
          '123456789012', 'gcp-project', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z'
        )
      `);
      assert.strictEqual(invalidScope._tag, "Failure");

      yield* sql`
        INSERT INTO cloud_project_bindings (
          binding_id, project_id, context_id, environment, regions_json,
          expected_account_id, expected_project_id, created_at, updated_at
        ) VALUES (
          'binding-cloud', 'project-cloud', 'aws:profile:production', 'Production', '["us-east-1"]',
          '123456789012', NULL, '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z'
        )
      `;
      yield* sql`DELETE FROM projection_projects WHERE project_id = 'project-cloud'`;
      const bindings = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM cloud_project_bindings
      `;
      assert.strictEqual(bindings[0]?.count, 0);
    }),
  );
});
