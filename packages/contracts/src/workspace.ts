import { Schema } from "effect";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString, WorkspaceId } from "./baseSchemas";

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
