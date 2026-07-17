import { Schema } from "effect";

import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  WorkspaceId,
} from "./baseSchemas";

/** A durable execution location owned by the server, not a transient thread field. */
export const WorkspaceKind = Schema.Literals(["local", "worktree", "detached", "scratch"]);
export type WorkspaceKind = typeof WorkspaceKind.Type;

export const WorkspaceState = Schema.Literals([
  "provisioning",
  "ready",
  "missing",
  "retiring",
  "deleted",
]);
export type WorkspaceState = typeof WorkspaceState.Type;

export const WorkspaceRetentionPolicy = Schema.Literals([
  "retain",
  "delete-on-thread-delete",
  "delete-on-task-complete",
]);
export type WorkspaceRetentionPolicy = typeof WorkspaceRetentionPolicy.Type;

export const WorkspaceRecord = Schema.Struct({
  id: WorkspaceId,
  projectId: ProjectId,
  ownerThreadId: Schema.NullOr(ThreadId),
  kind: WorkspaceKind,
  state: WorkspaceState,
  retentionPolicy: WorkspaceRetentionPolicy,
  workspaceRoot: TrimmedNonEmptyString,
  path: Schema.NullOr(TrimmedNonEmptyString),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  ref: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
});
export type WorkspaceRecord = typeof WorkspaceRecord.Type;

export const WorkspaceInventoryStatus = Schema.Literals(["managed", "orphan", "missing"]);
export type WorkspaceInventoryStatus = typeof WorkspaceInventoryStatus.Type;

export const WorkspaceThreadMode = Schema.Literals(["local", "worktree"]);
export type WorkspaceThreadMode = typeof WorkspaceThreadMode.Type;

/** Server-side first-send operation. The browser never sequences Git + thread metadata. */
export const WorkspaceProvisionThreadWorktreeInput = Schema.Struct({
  threadId: ThreadId,
  baseBranch: TrimmedNonEmptyString,
  newBranch: TrimmedNonEmptyString,
});
export type WorkspaceProvisionThreadWorktreeInput =
  typeof WorkspaceProvisionThreadWorktreeInput.Type;

/** Server-side handoff operation; current paths and branches are resolved from the projection. */
export const WorkspaceHandoffThreadInput = Schema.Struct({
  threadId: ThreadId,
  targetMode: WorkspaceThreadMode,
  preferredNewWorktreeName: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkspaceHandoffThreadInput = typeof WorkspaceHandoffThreadInput.Type;

export const WorkspaceThreadOperationResult = Schema.Struct({
  workspace: WorkspaceRecord,
  envMode: WorkspaceThreadMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  associatedWorktreePath: Schema.NullOr(TrimmedNonEmptyString),
  associatedWorktreeBranch: Schema.NullOr(TrimmedNonEmptyString),
  associatedWorktreeRef: Schema.NullOr(TrimmedNonEmptyString),
  changesTransferred: Schema.Boolean,
  conflictsDetected: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
});
export type WorkspaceThreadOperationResult = typeof WorkspaceThreadOperationResult.Type;
