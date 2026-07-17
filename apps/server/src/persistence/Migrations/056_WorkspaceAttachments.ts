import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Workspace identity is deliberately independent from a thread. A workspace
 * can be used by a seat plus several child agents, while `owner_thread_id`
 * remains a compatibility projection for older readers.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workspace_attachments (
      workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      attached_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, thread_id)
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_attachments_thread_id_unique
      ON workspace_attachments(thread_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS workspace_attachments_workspace_id_idx
      ON workspace_attachments(workspace_id)
  `;
  yield* sql`
    INSERT OR IGNORE INTO workspace_attachments (workspace_id, thread_id, attached_at)
    SELECT workspace_id, owner_thread_id, updated_at
    FROM workspaces
    WHERE owner_thread_id IS NOT NULL
  `;
});
