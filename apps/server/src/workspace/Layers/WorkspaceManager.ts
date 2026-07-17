import { randomUUID } from "node:crypto";

import { Effect, FileSystem, Layer, Path } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { ServerManagedWorktree, WorkspaceRecord } from "@t3tools/contracts";
import { WorkspaceId } from "@t3tools/contracts";

import { GitCore } from "../../git/Services/GitCore.ts";
import {
  WorkspaceLifecycleError,
  WorkspaceManager,
  type WorkspaceManagerShape,
} from "../Services/WorkspaceManager.ts";

type WorkspaceRow = {
  readonly id: string;
  readonly projectId: string;
  readonly ownerThreadId: string | null;
  readonly kind: WorkspaceRecord["kind"];
  readonly state: WorkspaceRecord["state"];
  readonly retentionPolicy: WorkspaceRecord["retentionPolicy"];
  readonly workspaceRoot: string;
  readonly path: string | null;
  readonly branch: string | null;
  readonly ref: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly retiredAt: string | null;
};

type GitWorktreeEntry = {
  readonly path: string;
  readonly branch: string | null;
  readonly detached: boolean;
};

export function parseGitWorktreePorcelain(output: string): ReadonlyArray<GitWorktreeEntry> {
  const entries: GitWorktreeEntry[] = [];
  let current: { path?: string; branch: string | null; detached: boolean } = {
    branch: null,
    detached: false,
  };
  const flush = () => {
    if (current.path) {
      entries.push({ path: current.path, branch: current.branch, detached: current.detached });
    }
    current = { branch: null, detached: false };
  };
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      flush();
    } else if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (line === "detached") {
      current.detached = true;
    }
  }
  flush();
  return entries;
}

const now = () => new Date().toISOString();

const toRecord = (row: WorkspaceRow): WorkspaceRecord => ({
  ...row,
  id: WorkspaceId.makeUnsafe(row.id),
  projectId: row.projectId as WorkspaceRecord["projectId"],
  ownerThreadId: row.ownerThreadId as WorkspaceRecord["ownerThreadId"],
});

const fail = (operation: string, cause: unknown) =>
  new WorkspaceLifecycleError({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

export const makeWorkspaceManager = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const git = yield* GitCore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const getById = (workspaceId: string) =>
    sql<WorkspaceRow>`
      SELECT
        workspace_id AS id, project_id AS projectId, owner_thread_id AS ownerThreadId,
        kind, state, retention_policy AS retentionPolicy, workspace_root AS workspaceRoot,
        path, branch, ref, created_at AS createdAt, updated_at AS updatedAt, retired_at AS retiredAt
      FROM workspaces WHERE workspace_id = ${workspaceId} LIMIT 1
    `.pipe(
      Effect.map((rows) => rows[0] ?? null),
      Effect.mapError((cause) => fail("workspace.get", cause)),
    );

  const getAll = () =>
    sql<WorkspaceRow>`
      SELECT
        workspace_id AS id, project_id AS projectId, owner_thread_id AS ownerThreadId,
        kind, state, retention_policy AS retentionPolicy, workspace_root AS workspaceRoot,
        path, branch, ref, created_at AS createdAt, updated_at AS updatedAt, retired_at AS retiredAt
      FROM workspaces ORDER BY created_at ASC, workspace_id ASC
    `.pipe(Effect.mapError((cause) => fail("workspace.list", cause)));

  const updateState = (workspaceId: string, state: WorkspaceRecord["state"]) =>
    sql`UPDATE workspaces SET state = ${state}, updated_at = ${now()} WHERE workspace_id = ${workspaceId}`.pipe(
      Effect.mapError((cause) => fail("workspace.updateState", cause)),
    );

  const listInventory: WorkspaceManagerShape["listInventory"] = () =>
    Effect.gen(function* () {
      const records = yield* getAll();
      const roots = [...new Set(records.map((record) => record.workspaceRoot))];
      const liveByRoot = new Map<string, ReadonlyArray<GitWorktreeEntry>>();
      for (const root of roots) {
        const live = yield* git
          .execute({
            operation: "WorkspaceManager.listInventory",
            cwd: root,
            args: ["worktree", "list", "--porcelain"],
          })
          .pipe(
            Effect.map((result) => (result.code === 0 ? parseGitWorktreePorcelain(result.stdout) : [])),
            Effect.catch(() => Effect.succeed([])),
          );
        liveByRoot.set(root, live);
      }

      const worktrees: ServerManagedWorktree[] = [];
      const knownPaths = new Set<string>();
      for (const record of records) {
        if (!record.path || (record.kind !== "worktree" && record.kind !== "detached")) {
          continue;
        }
        knownPaths.add(record.path);
        const live = liveByRoot.get(record.workspaceRoot) ?? [];
        const found = live.some((entry) => entry.path === record.path);
        const inventoryStatus = found ? "managed" : "missing";
        if (record.state !== "retiring" && record.state !== "deleted") {
          const desired = found ? "ready" : "missing";
          if (record.state !== desired) yield* updateState(record.id, desired);
        }
        worktrees.push({
          path: record.path,
          workspaceRoot: record.workspaceRoot,
          workspaceId: WorkspaceId.makeUnsafe(record.id),
          kind: record.kind,
          state:
            record.state === "retiring" || record.state === "deleted"
              ? record.state
              : found
                ? "ready"
                : "missing",
          inventoryStatus,
        });
      }
      for (const [root, live] of liveByRoot) {
        for (const entry of live) {
          // The primary checkout is not a managed worktree inventory item.
          if (entry.path === root || knownPaths.has(entry.path)) continue;
          worktrees.push({
            path: entry.path,
            workspaceRoot: root,
            kind: entry.detached ? "detached" : "worktree",
            state: "ready",
            inventoryStatus: "orphan",
          });
        }
      }
      return { worktrees };
    });

  const provision: WorkspaceManagerShape["provision"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* getById(input.workspaceId);
      if (existing) return toRecord(existing);

      if (input.kind === "worktree" || input.kind === "detached") {
        const conflicts = yield* sql<{ readonly id: string }>`
          SELECT workspace_id AS id FROM workspaces
          WHERE workspace_root = ${input.workspaceRoot}
            AND state != 'deleted'
            AND kind IN ('worktree', 'detached')
            AND (
              (${input.path ?? null} IS NOT NULL AND path = ${input.path ?? null})
              OR (${input.branch ?? null} IS NOT NULL AND branch = ${input.branch ?? null})
              OR (${input.ref ?? null} IS NOT NULL AND ref = ${input.ref ?? null})
            )
          LIMIT 1
        `.pipe(Effect.mapError((cause) => fail("workspace.provision.ownership", cause)));
        if (conflicts[0]) {
          return yield* Effect.fail(
            fail("workspace.provision", new Error("Workspace path, branch, or ref is already owned.")),
          );
        }
      }

      const createdAt = now();
      const basePath = input.path ?? null;
      yield* sql`
        INSERT INTO workspaces (
          workspace_id, project_id, owner_thread_id, kind, state, retention_policy,
          workspace_root, path, branch, ref, created_at, updated_at, retired_at
        ) VALUES (
          ${input.workspaceId}, ${input.projectId}, ${input.ownerThreadId ?? null}, ${input.kind},
          'provisioning', ${input.retentionPolicy}, ${input.workspaceRoot}, ${basePath},
          ${input.branch ?? null}, ${input.ref ?? null}, ${createdAt}, ${createdAt}, NULL
        )
      `.pipe(Effect.mapError((cause) => fail("workspace.provision.insert", cause)));

      let materializedPath = basePath;
      let branch = input.branch ?? null;
      let ref = input.ref ?? null;
      if (input.kind === "worktree") {
        if (!branch) {
          return yield* Effect.fail(
            fail("workspace.provision", new Error("A worktree requires a branch.")),
          );
        }
        const result = yield* git
          .createWorktree({ cwd: input.workspaceRoot, branch, path: materializedPath })
          .pipe(Effect.mapError((cause) => fail("workspace.provision.worktree", cause)));
        materializedPath = result.worktree.path;
        branch = result.worktree.branch;
      } else if (input.kind === "detached") {
        if (!ref) {
          return yield* Effect.fail(
            fail("workspace.provision", new Error("A detached workspace requires a ref.")),
          );
        }
        const result = yield* git
          .createDetachedWorktree({ cwd: input.workspaceRoot, ref, path: materializedPath })
          .pipe(Effect.mapError((cause) => fail("workspace.provision.detached", cause)));
        materializedPath = result.worktree.path;
        branch = result.worktree.branch;
        ref = result.worktree.ref;
      } else if (input.kind === "scratch") {
        materializedPath =
          materializedPath ?? path.join(input.workspaceRoot, ".chitauri", "scratch", randomUUID());
        yield* fileSystem.makeDirectory(materializedPath, { recursive: true }).pipe(
          Effect.mapError((cause) => fail("workspace.provision.scratch", cause)),
        );
      } else {
        materializedPath = input.workspaceRoot;
      }
      const updatedAt = now();
      yield* sql`
        UPDATE workspaces
        SET path = ${materializedPath}, branch = ${branch}, ref = ${ref}, state = 'ready', updated_at = ${updatedAt}
        WHERE workspace_id = ${input.workspaceId}
      `.pipe(Effect.mapError((cause) => fail("workspace.provision.ready", cause)));
      if (input.ownerThreadId) yield* attach({ workspaceId: input.workspaceId, threadId: input.ownerThreadId });
      const record = yield* getById(input.workspaceId);
      if (!record) {
        return yield* Effect.fail(
          fail("workspace.provision", new Error("Workspace record disappeared.")),
        );
      }
      return toRecord(record);
    });

  const attach: WorkspaceManagerShape["attach"] = (input) =>
    Effect.gen(function* () {
      const record = yield* getById(input.workspaceId);
      if (!record) {
        return yield* Effect.fail(fail("workspace.attach", new Error("Workspace does not exist.")));
      }
      if (record.ownerThreadId && record.ownerThreadId !== input.threadId) {
        return yield* Effect.fail(
          fail("workspace.attach", new Error("Workspace is already attached to another thread.")),
        );
      }
      const owner = yield* sql<{ readonly ownerThreadId: string }>`
        SELECT owner_thread_id AS ownerThreadId FROM workspaces
        WHERE owner_thread_id = ${input.threadId} AND workspace_id != ${input.workspaceId} LIMIT 1
      `.pipe(Effect.mapError((cause) => fail("workspace.attach.owner", cause)));
      if (owner[0]) {
        return yield* Effect.fail(
          fail("workspace.attach", new Error("Thread already owns another workspace.")),
        );
      }
      const updatedAt = now();
      yield* sql`
        UPDATE workspaces SET owner_thread_id = ${input.threadId}, updated_at = ${updatedAt}
        WHERE workspace_id = ${input.workspaceId}
      `.pipe(Effect.mapError((cause) => fail("workspace.attach.record", cause)));
      // Preserve the old fields as a projection so existing clients and event
      // paths continue to resolve the exact same cwd/branch during rollout.
      yield* sql`
        UPDATE projection_threads
        SET workspace_id = ${input.workspaceId},
            env_mode = ${record.kind === "local" || record.kind === "scratch" ? "local" : "worktree"},
            worktree_path = ${record.path},
            associated_worktree_path = ${record.path},
            associated_worktree_branch = ${record.branch},
            associated_worktree_ref = ${record.ref ?? record.branch},
            branch = COALESCE(${record.branch}, branch),
            updated_at = ${updatedAt}
        WHERE thread_id = ${input.threadId}
      `.pipe(Effect.mapError((cause) => fail("workspace.attach.threadProjection", cause)));
      const attached = yield* getById(input.workspaceId);
      if (!attached) {
        return yield* Effect.fail(
          fail("workspace.attach", new Error("Workspace record disappeared.")),
        );
      }
      return toRecord(attached);
    });

  const detach: WorkspaceManagerShape["detach"] = (threadId) =>
    Effect.gen(function* () {
      const updatedAt = now();
      yield* sql`
        UPDATE workspaces SET owner_thread_id = NULL, updated_at = ${updatedAt}
        WHERE owner_thread_id = ${threadId}
      `.pipe(Effect.mapError((cause) => fail("workspace.detach.record", cause)));
      yield* sql`
        UPDATE projection_threads SET workspace_id = NULL, updated_at = ${updatedAt}
        WHERE thread_id = ${threadId}
      `.pipe(Effect.mapError((cause) => fail("workspace.detach.threadProjection", cause)));
    });

  const retire: WorkspaceManagerShape["retire"] = (workspaceId) =>
    Effect.gen(function* () {
      const record = yield* getById(workspaceId);
      if (!record) {
        return yield* Effect.fail(fail("workspace.retire", new Error("Workspace does not exist.")));
      }
      if (record.state !== "deleted") {
        const retiredAt = now();
        yield* sql`
          UPDATE workspaces SET state = 'retiring', retired_at = ${retiredAt}, updated_at = ${retiredAt}
          WHERE workspace_id = ${workspaceId}
        `.pipe(Effect.mapError((cause) => fail("workspace.retire", cause)));
      }
      const retired = yield* getById(workspaceId);
      if (!retired) {
        return yield* Effect.fail(
          fail("workspace.retire", new Error("Workspace record disappeared.")),
        );
      }
      return toRecord(retired);
    });

  const retireForThreadDeletion: WorkspaceManagerShape["retireForThreadDeletion"] = (threadId) =>
    sql`
      UPDATE workspaces
      SET state = 'retiring', retired_at = COALESCE(retired_at, ${now()}), updated_at = ${now()}
      WHERE owner_thread_id = ${threadId}
        AND retention_policy = 'delete-on-thread-delete'
        AND state NOT IN ('retiring', 'deleted')
    `.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => fail("workspace.retireForThreadDeletion", cause)),
    );

  return {
    provision,
    reconcile: listInventory,
    listInventory,
    attach,
    detach,
    retire,
    retireForThreadDeletion,
  } satisfies WorkspaceManagerShape;
});

export const WorkspaceManagerLive = Layer.effect(WorkspaceManager, makeWorkspaceManager);
