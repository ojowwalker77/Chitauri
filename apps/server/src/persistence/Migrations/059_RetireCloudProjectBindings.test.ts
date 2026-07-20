import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const tableNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type IN ('table', 'index')
  `;
  return rows.map((row) => row.name);
});

layer("059_RetireCloudProjectBindings", (it) => {
  it.effect("drops the retired binding table and its indexes", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 58 });
      const before = yield* tableNames;
      assert.isTrue(before.includes("cloud_project_bindings"));

      yield* runMigrations();

      const after = yield* tableNames;
      assert.isFalse(after.includes("cloud_project_bindings"));
      assert.isFalse(after.includes("cloud_project_bindings_scope_unique"));
      assert.isFalse(after.includes("cloud_project_bindings_project_id_idx"));
    }),
  );

  it.effect("is idempotent on databases that never created the table", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      yield* runMigrations();

      const after = yield* tableNames;
      assert.isFalse(after.includes("cloud_project_bindings"));
    }),
  );

  it.effect("registers the retirement migration", () =>
    Effect.sync(() => {
      const entry = migrationEntries.find(([id]) => id === 59);
      assert.deepStrictEqual(entry?.slice(0, 2), [59, "RetireCloudProjectBindings"]);
    }),
  );
});
