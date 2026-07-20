/**
 * Retires the removed Cloud workbench. Bindings were a pure RPC-surface cache
 * of repository-to-cloud selectors — no orchestration event ever referenced
 * them — so the table can be dropped outright without touching event replay.
 * Migration #057 stays in the lineage so imported trackers still line up.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP INDEX IF EXISTS cloud_project_bindings_project_id_idx`;
  yield* sql`DROP INDEX IF EXISTS cloud_project_bindings_scope_unique`;
  yield* sql`DROP TABLE IF EXISTS cloud_project_bindings`;
});
