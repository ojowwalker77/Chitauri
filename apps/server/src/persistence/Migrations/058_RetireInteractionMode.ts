import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Plan mode is retired. The `thread.interaction-mode-set` event stays decodable
 * for historical replays, but nothing reads or writes these projection columns
 * anymore, so drop them.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    DROP COLUMN interaction_mode
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));

  yield* sql`
    ALTER TABLE automation_definitions
    DROP COLUMN interaction_mode
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));
});
