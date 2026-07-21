// FILE: 062_TaskArtifacts.ts
// Purpose: Persist typed durable artifacts produced by Worker Tasks.

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* columnExists(sql, "projection_tasks", "artifacts_json"))) {
    yield* sql`
      ALTER TABLE projection_tasks
      ADD COLUMN artifacts_json TEXT NOT NULL DEFAULT '[]'
    `;
  }
});
