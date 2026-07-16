import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN orchestrator_mode INTEGER NOT NULL DEFAULT 0
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));
});
