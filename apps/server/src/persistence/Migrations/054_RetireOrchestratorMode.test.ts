import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("054_RetireOrchestratorMode", (it) => {
  it.effect("drops the retired projection column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });

      const before = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
      assert.isTrue(before.some((column) => column.name === "orchestrator_mode"));

      yield* runMigrations();

      const after = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
      assert.isFalse(after.some((column) => column.name === "orchestrator_mode"));
    }),
  );

  it.effect("registers the retirement migration", () =>
    Effect.sync(() => {
      const entry = migrationEntries.find(([id]) => id === 54);
      assert.deepStrictEqual(entry?.slice(0, 2), [54, "RetireOrchestratorMode"]);
    }),
  );
});
