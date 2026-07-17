import { Data, Effect, ServiceMap } from "effect";

import type {
  ProjectId,
  ServerListWorktreesResult,
  ThreadId,
  WorkspaceKind,
  WorkspaceRecord,
  WorkspaceRetentionPolicy,
} from "@t3tools/contracts";

export class WorkspaceLifecycleError extends Data.TaggedError("WorkspaceLifecycleError")<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export interface WorkspaceProvisionInput {
  readonly workspaceId: WorkspaceRecord["id"];
  readonly projectId: ProjectId;
  readonly ownerThreadId?: ThreadId | null;
  readonly kind: WorkspaceKind;
  readonly retentionPolicy: WorkspaceRetentionPolicy;
  /** The primary checkout used to create or inspect git worktrees. */
  readonly workspaceRoot: string;
  readonly path?: string | null;
  /** Existing branch/ref checked out by a regular worktree. */
  readonly branch?: string | null;
  /** Base branch used only when materializing a newly named worktree branch. */
  readonly baseBranch?: string | null;
  /** Commit-ish checked out by a detached worktree. */
  readonly ref?: string | null;
}

export interface WorkspaceAttachInput {
  readonly workspaceId: WorkspaceRecord["id"];
  readonly threadId: ThreadId;
}

export interface WorkspaceManagerShape {
  /** Creates a record first and safely resumes an interrupted provision by id. */
  readonly provision: (
    input: WorkspaceProvisionInput,
  ) => Effect.Effect<WorkspaceRecord, WorkspaceLifecycleError>;
  /** Checks persisted records against `git worktree list` without deleting anything. */
  readonly reconcile: () => Effect.Effect<ServerListWorktreesResult, WorkspaceLifecycleError>;
  readonly listInventory: () => Effect.Effect<ServerListWorktreesResult, WorkspaceLifecycleError>;
  /** Attaches a thread through the durable many-to-one relation and projects legacy fields. */
  readonly attach: (
    input: WorkspaceAttachInput,
  ) => Effect.Effect<WorkspaceRecord, WorkspaceLifecycleError>;
  /** Removes identity ownership while retaining legacy fields for the rollout. */
  readonly detach: (threadId: ThreadId) => Effect.Effect<void, WorkspaceLifecycleError>;
  /** Marks a record as retiring; physical deletion remains an explicit future operation. */
  readonly retire: (
    workspaceId: WorkspaceRecord["id"],
  ) => Effect.Effect<WorkspaceRecord, WorkspaceLifecycleError>;
  /** Applies the non-destructive thread-delete lifecycle guard for opted-in records. */
  readonly retireForThreadDeletion: (threadId: ThreadId) => Effect.Effect<void, WorkspaceLifecycleError>;
}

export class WorkspaceManager extends ServiceMap.Service<WorkspaceManager, WorkspaceManagerShape>()(
  "t3/workspace/Services/WorkspaceManager",
) {}
