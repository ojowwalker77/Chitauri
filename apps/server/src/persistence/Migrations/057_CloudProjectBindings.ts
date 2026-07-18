import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Persists only repository-to-cloud selectors and pinned external identities.
 * Credentials, inventory, and logs deliberately have no persistence columns.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS cloud_project_bindings (
      binding_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      context_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      regions_json TEXT NOT NULL,
      expected_account_id TEXT,
      expected_project_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (expected_account_id IS NOT NULL AND expected_project_id IS NULL) OR
        (expected_account_id IS NULL AND expected_project_id IS NOT NULL)
      ),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS cloud_project_bindings_scope_unique
      ON cloud_project_bindings(project_id, context_id, environment)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS cloud_project_bindings_project_id_idx
      ON cloud_project_bindings(project_id)
  `;
});
