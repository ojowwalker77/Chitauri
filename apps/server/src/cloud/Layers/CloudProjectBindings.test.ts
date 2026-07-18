import { CloudBindingId, CloudContextId, ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { CloudProjectBindings } from "../Services/CloudProjectBindings";
import { CloudProjectBindingsLive } from "./CloudProjectBindings";

const layer = it.layer(
  Layer.mergeAll(
    CloudProjectBindingsLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

layer("CloudProjectBindings", (it) => {
  it.effect("creates, updates, lists, and removes non-secret binding selectors", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const bindings = yield* CloudProjectBindings;
      const projectId = ProjectId.makeUnsafe("project-cloud-bindings");
      const bindingId = CloudBindingId.makeUnsafe("binding-cloud-bindings");
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, is_pinned,
          created_at, updated_at, deleted_at
        ) VALUES (
          ${projectId}, 'project', 'Cloud bindings', '/tmp/cloud-bindings', '[]', 0,
          '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL
        )
      `;

      yield* bindings.upsert({
        id: bindingId,
        projectId,
        contextId: CloudContextId.makeUnsafe("aws:profile:production"),
        environment: "Production",
        regions: ["us-east-1"],
        expectedAccountId: "123456789012",
        expectedProjectId: null,
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      });
      yield* bindings.upsert({
        id: bindingId,
        projectId,
        contextId: CloudContextId.makeUnsafe("aws:profile:production"),
        environment: "Production",
        regions: ["us-east-1", "us-west-2"],
        expectedAccountId: "123456789012",
        expectedProjectId: null,
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:01:00.000Z",
      });

      const listed = yield* bindings.list(projectId);
      assert.strictEqual(listed.length, 1);
      assert.deepStrictEqual(listed[0]?.regions, ["us-east-1", "us-west-2"]);
      assert.strictEqual(
        Option.getOrNull(yield* bindings.getById(bindingId))?.updatedAt,
        "2026-07-17T00:01:00.000Z",
      );

      const raw = yield* sql<Record<string, unknown>>`
        SELECT * FROM cloud_project_bindings WHERE binding_id = ${bindingId}
      `;
      assert.strictEqual("credentials" in (raw[0] ?? {}), false);
      assert.strictEqual("access_token" in (raw[0] ?? {}), false);

      yield* bindings.remove(bindingId);
      assert.strictEqual(Option.isNone(yield* bindings.getById(bindingId)), true);
    }),
  );
});
