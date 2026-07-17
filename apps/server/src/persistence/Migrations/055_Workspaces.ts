import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

/**
 * Introduces server-owned workspace identity without retiring the legacy
 * thread fields. Every existing thread receives one stable record so the
 * rollout can resolve either representation safely.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      owner_thread_id TEXT,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      retention_policy TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      path TEXT,
      branch TEXT,
      ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      retired_at TEXT
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS workspaces_owner_thread_id_unique
      ON workspaces(owner_thread_id)
      WHERE owner_thread_id IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS workspaces_project_id_idx
      ON workspaces(project_id)
  `;

  if (!(yield* columnExists(sql, "projection_threads", "workspace_id"))) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN workspace_id TEXT`;
  }

  // The deterministic prefix avoids relying on unavailable UUID functions in
  // SQLite and makes interrupted/replayed imports idempotent.
  yield* sql`
    INSERT OR IGNORE INTO workspaces (
      workspace_id, project_id, owner_thread_id, kind, state, retention_policy,
      workspace_root, path, branch, ref, created_at, updated_at, retired_at
    )
    SELECT
      'legacy-thread-' || threads.thread_id,
      threads.project_id,
      threads.thread_id,
      CASE
        WHEN threads.env_mode = 'worktree' AND threads.associated_worktree_ref IS NOT NULL
          AND threads.associated_worktree_branch IS NULL THEN 'detached'
        WHEN threads.env_mode = 'worktree' OR threads.worktree_path IS NOT NULL THEN 'worktree'
        ELSE 'local'
      END,
      CASE
        WHEN (threads.worktree_path IS NOT NULL OR threads.env_mode != 'worktree') THEN 'ready'
        ELSE 'provisioning'
      END,
      'retain',
      projects.workspace_root,
      CASE
        WHEN threads.env_mode = 'worktree' OR threads.worktree_path IS NOT NULL
          THEN COALESCE(threads.associated_worktree_path, threads.worktree_path)
        ELSE projects.workspace_root
      END,
      COALESCE(threads.associated_worktree_branch, threads.branch),
      COALESCE(threads.associated_worktree_ref, threads.associated_worktree_branch, threads.branch),
      threads.created_at,
      threads.updated_at,
      NULL
    FROM projection_threads AS threads
    INNER JOIN projection_projects AS projects ON projects.project_id = threads.project_id
    WHERE threads.deleted_at IS NULL
  `;
  yield* sql`
    UPDATE projection_threads
    SET workspace_id = 'legacy-thread-' || thread_id
    WHERE workspace_id IS NULL
      AND deleted_at IS NULL
  `;
});
