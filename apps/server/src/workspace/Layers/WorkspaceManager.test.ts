import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { WorkspaceManager } from "../Services/WorkspaceManager.ts";
import { WorkspaceManagerLive, parseGitWorktreePorcelain } from "./WorkspaceManager.ts";

const gitWorktreeOutput = [
  "worktree /tmp/project",
  "HEAD abcdef",
  "branch refs/heads/main",
  "",
  "worktree /tmp/project/.worktrees/managed",
  "HEAD 123456",
  "branch refs/heads/feature/managed",
  "",
  "worktree /tmp/project/.worktrees/orphan",
  "HEAD 654321",
  "detached",
  "",
].join("\n");

const git: Pick<GitCoreShape, "execute" | "createWorktree"> = {
  execute: () => Effect.succeed({ code: 0, stdout: gitWorktreeOutput, stderr: "" }),
  createWorktree: (input) =>
    Effect.succeed({
      worktree: { path: input.path ?? "/tmp/project/.worktrees/provisioned", branch: input.branch },
    }),
};

const layer = it.layer(
  WorkspaceManagerLive.pipe(
    Layer.provideMerge(NodeSqliteClient.layerMemory()),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(Layer.succeed(GitCore, git as GitCoreShape)),
  ),
);

layer("WorkspaceManager", (it) => {
  it.effect("parses worktree porcelain entries including detached checkouts", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(parseGitWorktreePorcelain(gitWorktreeOutput), [
        { path: "/tmp/project", branch: "main", detached: false },
        { path: "/tmp/project/.worktrees/managed", branch: "feature/managed", detached: false },
        { path: "/tmp/project/.worktrees/orphan", branch: null, detached: true },
      ]);
    }),
  );

  it.effect("reconciles managed, missing, and orphan worktrees without deleting anything", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const manager = yield* WorkspaceManager;
      yield* runMigrations();
      yield* sql`
        INSERT INTO workspaces (workspace_id, project_id, owner_thread_id, kind, state, retention_policy, workspace_root, path, branch, ref, created_at, updated_at, retired_at)
        VALUES
          ('managed', 'project-1', NULL, 'worktree', 'provisioning', 'retain', '/tmp/project', '/tmp/project/.worktrees/managed', 'feature/managed', 'feature/managed', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL),
          ('missing', 'project-1', NULL, 'worktree', 'ready', 'retain', '/tmp/project', '/tmp/project/.worktrees/missing', 'feature/missing', 'feature/missing', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL)
      `;

      const inventory = yield* manager.reconcile();
      assert.deepStrictEqual(
        inventory.worktrees.map(({ path, inventoryStatus }) => ({ path, inventoryStatus })),
        [
          { path: "/tmp/project/.worktrees/managed", inventoryStatus: "managed" },
          { path: "/tmp/project/.worktrees/missing", inventoryStatus: "missing" },
          { path: "/tmp/project/.worktrees/orphan", inventoryStatus: "orphan" },
        ],
      );
      const states = yield* sql<{ readonly workspace_id: string; readonly state: string }>`
        SELECT workspace_id, state FROM workspaces ORDER BY workspace_id
      `;
      assert.deepStrictEqual(states, [
        { workspace_id: "managed", state: "ready" },
        { workspace_id: "missing", state: "missing" },
      ]);
    }),
  );

  it.effect("attaches a durable identity while projecting legacy cwd and branch fields", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const manager = yield* WorkspaceManager;
      yield* runMigrations();
      yield* sql`
        INSERT INTO projection_projects (project_id, kind, title, workspace_root, scripts_json, is_pinned, created_at, updated_at, deleted_at)
        VALUES ('project-1', 'project', 'Project', '/tmp/project', '[]', 0, '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL)
      `;
      yield* sql`
        INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, env_mode, created_at, updated_at, deleted_at)
        VALUES ('thread-1', 'project-1', 'Thread', '{"provider":"codex","model":"gpt-5.4"}', 'full-access', 'local', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL)
      `;
      yield* manager.provision({
        workspaceId: "workspace-1" as never,
        projectId: "project-1" as never,
        kind: "worktree",
        retentionPolicy: "retain",
        workspaceRoot: "/tmp/project",
        path: "/tmp/project/.worktrees/attached",
        branch: "feature/attached",
      });
      yield* manager.attach({ workspaceId: "workspace-1" as never, threadId: "thread-1" as never });
      const rows = yield* sql<{
        readonly workspace_id: string;
        readonly env_mode: string;
        readonly worktree_path: string;
        readonly associated_worktree_branch: string;
      }>`SELECT workspace_id, env_mode, worktree_path, associated_worktree_branch FROM projection_threads WHERE thread_id = 'thread-1'`;
      assert.deepStrictEqual(rows, [
        {
          workspace_id: "workspace-1",
          env_mode: "worktree",
          worktree_path: "/tmp/project/.worktrees/attached",
          associated_worktree_branch: "feature/attached",
        },
      ]);
      yield* manager.detach("thread-1" as never);
      const detached = yield* sql<{
        readonly workspace_id: string | null;
        readonly worktree_path: string;
      }>`
        SELECT workspace_id, worktree_path FROM projection_threads WHERE thread_id = 'thread-1'
      `;
      assert.deepStrictEqual(detached, [
        { workspace_id: null, worktree_path: "/tmp/project/.worktrees/attached" },
      ]);
    }),
  );

  it.effect("does not assign the same path or branch to two active workspaces", () =>
    Effect.gen(function* () {
      const manager = yield* WorkspaceManager;
      yield* runMigrations();
      yield* manager.provision({
        workspaceId: "workspace-owner-a" as never,
        projectId: "project-1" as never,
        kind: "worktree",
        retentionPolicy: "retain",
        workspaceRoot: "/tmp/project",
        path: "/tmp/project/.worktrees/owned",
        branch: "feature/owned",
      });
      const error = yield* manager
        .provision({
          workspaceId: "workspace-owner-b" as never,
          projectId: "project-1" as never,
          kind: "worktree",
          retentionPolicy: "retain",
          workspaceRoot: "/tmp/project",
          path: "/tmp/project/.worktrees/other",
          branch: "feature/owned",
        })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "WorkspaceLifecycleError");
      assert.include(error.detail, "already owned");
    }),
  );

  it.effect(
    "attaches multiple threads to one workspace while retaining a primary legacy owner",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const manager = yield* WorkspaceManager;
        yield* runMigrations();
        yield* sql`
        INSERT INTO projection_projects (project_id, kind, title, workspace_root, scripts_json, is_pinned, created_at, updated_at, deleted_at)
        VALUES ('project-shared', 'project', 'Shared', '/tmp/project', '[]', 0, '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL)
      `;
        yield* sql`
        INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, env_mode, created_at, updated_at, deleted_at)
        VALUES
          ('thread-seat', 'project-shared', 'Seat', '{"provider":"codex","model":"gpt-5.4"}', 'full-access', 'local', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL),
          ('thread-agent', 'project-shared', 'Agent', '{"provider":"codex","model":"gpt-5.4"}', 'full-access', 'local', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL)
      `;
        yield* sql`
        INSERT INTO workspaces (workspace_id, project_id, owner_thread_id, kind, state, retention_policy, workspace_root, path, branch, ref, created_at, updated_at, retired_at)
        VALUES ('shared-workspace', 'project-shared', NULL, 'worktree', 'ready', 'retain', '/tmp/project', '/tmp/project/.worktrees/managed', 'feature/managed', 'feature/managed', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL)
      `;
        yield* manager.attach({
          workspaceId: "shared-workspace" as never,
          threadId: "thread-seat" as never,
        });
        yield* manager.attach({
          workspaceId: "shared-workspace" as never,
          threadId: "thread-agent" as never,
        });
        const attachments = yield* sql<{ readonly thread_id: string }>`
        SELECT thread_id FROM workspace_attachments WHERE workspace_id = 'shared-workspace' ORDER BY thread_id
      `;
        const owner = yield* sql<{ readonly owner_thread_id: string }>`
        SELECT owner_thread_id FROM workspaces WHERE workspace_id = 'shared-workspace'
      `;
        assert.deepStrictEqual(attachments, [
          { thread_id: "thread-agent" },
          { thread_id: "thread-seat" },
        ]);
        assert.deepStrictEqual(owner, [{ owner_thread_id: "thread-seat" }]);
      }),
  );

  it.effect("resumes an interrupted provision from the already materialized Git worktree", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const manager = yield* WorkspaceManager;
      yield* runMigrations();
      yield* sql`
        INSERT INTO workspaces (workspace_id, project_id, owner_thread_id, kind, state, retention_policy, workspace_root, path, branch, ref, created_at, updated_at, retired_at)
        VALUES ('interrupted', 'project-1', NULL, 'worktree', 'provisioning', 'retain', '/tmp/project', '/tmp/project/.worktrees/managed', 'feature/managed', 'feature/managed', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL)
      `;
      const workspace = yield* manager.provision({
        workspaceId: "interrupted" as never,
        projectId: "project-1" as never,
        kind: "worktree",
        retentionPolicy: "retain",
        workspaceRoot: "/tmp/project",
        path: "/tmp/project/.worktrees/managed",
        branch: "feature/managed",
      });
      assert.strictEqual(workspace.state, "ready");
      assert.strictEqual(workspace.path, "/tmp/project/.worktrees/managed");
    }),
  );

  it.effect("retires only records opted into delete-on-thread-delete without removing them", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const manager = yield* WorkspaceManager;
      yield* runMigrations();
      yield* sql`
        INSERT INTO workspaces (workspace_id, project_id, owner_thread_id, kind, state, retention_policy, workspace_root, path, branch, ref, created_at, updated_at, retired_at)
        VALUES
          ('retain-me', 'project-1', 'thread-2', 'worktree', 'ready', 'retain', '/tmp/project', '/tmp/project/.worktrees/retain', 'feature/retain', 'feature/retain', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL),
          ('retire-me', 'project-1', 'thread-3', 'worktree', 'ready', 'delete-on-thread-delete', '/tmp/project', '/tmp/project/.worktrees/retire', 'feature/retire', 'feature/retire', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL)
      `;
      yield* sql`
        INSERT INTO workspace_attachments (workspace_id, thread_id, attached_at)
        VALUES
          ('retain-me', 'thread-2', '2026-07-17T00:00:00.000Z'),
          ('retire-me', 'thread-3', '2026-07-17T00:00:00.000Z')
      `;
      yield* manager.retireForThreadDeletion("thread-3" as never);
      const rows = yield* sql<{ readonly workspace_id: string; readonly state: string }>`
        SELECT workspace_id, state
        FROM workspaces
        WHERE workspace_id IN ('retain-me', 'retire-me')
        ORDER BY workspace_id
      `;
      assert.deepStrictEqual(rows, [
        { workspace_id: "retain-me", state: "ready" },
        { workspace_id: "retire-me", state: "retiring" },
      ]);
    }),
  );
});
