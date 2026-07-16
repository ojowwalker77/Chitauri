import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const NullableText = Schema.NullOr(Schema.String);
const NullableTrimmedText = Schema.NullOr(TrimmedNonEmptyString);
const RepositoryName = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const SearchText = Schema.NullOr(Schema.String.check(Schema.isMaxLength(512)));
const BodyText = Schema.String.check(Schema.isMaxLength(100_000));

export const GitHubWorkItemKind = Schema.Literals(["pull_request", "issue"]);
export type GitHubWorkItemKind = typeof GitHubWorkItemKind.Type;

export const GitHubWorkListKind = Schema.Literals(["inbox", "pull_request", "issue"]);
export type GitHubWorkListKind = typeof GitHubWorkListKind.Type;

export const GitHubWorkListView = Schema.Literals([
  "attention",
  "reviewing",
  "authored",
  "assigned",
  "mentioned",
  "participating",
  "all",
]);
export type GitHubWorkListView = typeof GitHubWorkListView.Type;

export const GitHubWorkItemState = Schema.Literals(["open", "closed", "merged"]);
export type GitHubWorkItemState = typeof GitHubWorkItemState.Type;

export const GitHubCheckStatus = Schema.Literals([
  "pending",
  "success",
  "failure",
  "skipped",
  "neutral",
  "cancelled",
]);
export type GitHubCheckStatus = typeof GitHubCheckStatus.Type;

export const GitHubActor = Schema.Struct({
  login: TrimmedNonEmptyString,
  avatarUrl: NullableTrimmedText,
  isBot: Schema.Boolean,
});
export type GitHubActor = typeof GitHubActor.Type;

export const GitHubLabel = Schema.Struct({
  name: TrimmedNonEmptyString,
  color: NullableTrimmedText,
  description: NullableText,
});
export type GitHubLabel = typeof GitHubLabel.Type;

export const GitHubRepositorySummary = Schema.Struct({
  nameWithOwner: RepositoryName,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
});
export type GitHubRepositorySummary = typeof GitHubRepositorySummary.Type;

export const GitHubConnectionInput = Schema.Struct({
  cwd: Schema.NullOr(TrimmedNonEmptyString),
});
export type GitHubConnectionInput = typeof GitHubConnectionInput.Type;

export const GitHubConnectionResult = Schema.Struct({
  available: Schema.Boolean,
  authenticated: Schema.Boolean,
  account: NullableTrimmedText,
  host: NullableTrimmedText,
  version: NullableTrimmedText,
  repository: Schema.NullOr(GitHubRepositorySummary),
  error: NullableText,
});
export type GitHubConnectionResult = typeof GitHubConnectionResult.Type;

export const GitHubWorkListInput = Schema.Struct({
  cwd: Schema.NullOr(TrimmedNonEmptyString),
  kind: GitHubWorkListKind,
  view: GitHubWorkListView,
  query: SearchText,
  repository: Schema.NullOr(RepositoryName),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(100)),
});
export type GitHubWorkListInput = typeof GitHubWorkListInput.Type;

export const GitHubWorkItemSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  notificationId: NullableTrimmedText,
  kind: GitHubWorkItemKind,
  repository: GitHubRepositorySummary,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  state: GitHubWorkItemState,
  isDraft: Schema.Boolean,
  unread: Schema.Boolean,
  reason: NullableTrimmedText,
  author: Schema.NullOr(GitHubActor),
  labels: Schema.Array(GitHubLabel),
  assignees: Schema.Array(GitHubActor),
  commentsCount: NonNegativeInt,
  additions: Schema.NullOr(NonNegativeInt),
  deletions: Schema.NullOr(NonNegativeInt),
  changedFiles: Schema.NullOr(NonNegativeInt),
  reviewDecision: NullableTrimmedText,
  checkStatus: Schema.NullOr(GitHubCheckStatus),
  createdAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type GitHubWorkItemSummary = typeof GitHubWorkItemSummary.Type;

export const GitHubWorkListResult = Schema.Struct({
  items: Schema.Array(GitHubWorkItemSummary),
  totalCount: NonNegativeInt,
  syncedAt: IsoDateTime,
});
export type GitHubWorkListResult = typeof GitHubWorkListResult.Type;

export const GitHubWorkItemDetailInput = Schema.Struct({
  cwd: Schema.NullOr(TrimmedNonEmptyString),
  kind: GitHubWorkItemKind,
  repository: RepositoryName,
  number: PositiveInt,
});
export type GitHubWorkItemDetailInput = typeof GitHubWorkItemDetailInput.Type;

export const GitHubCheck = Schema.Struct({
  name: TrimmedNonEmptyString,
  workflow: NullableTrimmedText,
  status: GitHubCheckStatus,
  url: NullableTrimmedText,
  runId: Schema.NullOr(PositiveInt),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type GitHubCheck = typeof GitHubCheck.Type;

export const GitHubTimelineEntryType = Schema.Literals(["comment", "review", "commit", "state"]);
export type GitHubTimelineEntryType = typeof GitHubTimelineEntryType.Type;

export const GitHubTimelineEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  type: GitHubTimelineEntryType,
  author: Schema.NullOr(GitHubActor),
  body: NullableText,
  title: NullableTrimmedText,
  state: NullableTrimmedText,
  createdAt: IsoDateTime,
  url: NullableTrimmedText,
});
export type GitHubTimelineEntry = typeof GitHubTimelineEntry.Type;

export const GitHubMilestone = Schema.Struct({
  title: TrimmedNonEmptyString,
  number: Schema.NullOr(PositiveInt),
});
export type GitHubMilestone = typeof GitHubMilestone.Type;

export const GitHubWorkItemDetail = Schema.Struct({
  item: GitHubWorkItemSummary,
  body: Schema.String,
  headBranch: NullableTrimmedText,
  baseBranch: NullableTrimmedText,
  headSha: NullableTrimmedText,
  mergeability: NullableTrimmedText,
  mergeStateStatus: NullableTrimmedText,
  milestone: Schema.NullOr(GitHubMilestone),
  reviewers: Schema.Array(
    Schema.Struct({
      actor: GitHubActor,
      state: NullableTrimmedText,
    }),
  ),
  checks: Schema.Array(GitHubCheck),
  timeline: Schema.Array(GitHubTimelineEntry),
  linkedPullRequests: Schema.Array(GitHubWorkItemSummary),
});
export type GitHubWorkItemDetail = typeof GitHubWorkItemDetail.Type;

export const GitHubWorkItemDetailResult = Schema.Struct({
  detail: GitHubWorkItemDetail,
  syncedAt: IsoDateTime,
});
export type GitHubWorkItemDetailResult = typeof GitHubWorkItemDetailResult.Type;

export const GitHubPullRequestDiffInput = Schema.Struct({
  cwd: Schema.NullOr(TrimmedNonEmptyString),
  repository: RepositoryName,
  number: PositiveInt,
});
export type GitHubPullRequestDiffInput = typeof GitHubPullRequestDiffInput.Type;

export const GitHubPullRequestDiffResult = Schema.Struct({
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type GitHubPullRequestDiffResult = typeof GitHubPullRequestDiffResult.Type;

const GitHubItemTarget = {
  cwd: Schema.NullOr(TrimmedNonEmptyString),
  kind: GitHubWorkItemKind,
  repository: RepositoryName,
  number: PositiveInt,
};

export const GitHubWorkItemActionInput = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("comment"),
    ...GitHubItemTarget,
    body: BodyText,
  }),
  Schema.Struct({
    action: Schema.Literal("set_state"),
    ...GitHubItemTarget,
    state: Schema.Literals(["open", "closed"]),
    closeReason: Schema.NullOr(Schema.Literals(["completed", "not planned", "duplicate"])),
  }),
  Schema.Struct({
    action: Schema.Literal("assign_self"),
    ...GitHubItemTarget,
    assigned: Schema.Boolean,
  }),
  Schema.Struct({
    action: Schema.Literal("set_labels"),
    ...GitHubItemTarget,
    add: Schema.Array(TrimmedNonEmptyString),
    remove: Schema.Array(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    action: Schema.Literal("review"),
    ...GitHubItemTarget,
    kind: Schema.Literal("pull_request"),
    verdict: Schema.Literals(["comment", "approve", "request_changes"]),
    body: BodyText,
  }),
  Schema.Struct({
    action: Schema.Literal("ready"),
    ...GitHubItemTarget,
    kind: Schema.Literal("pull_request"),
  }),
  Schema.Struct({
    action: Schema.Literal("update_branch"),
    ...GitHubItemTarget,
    kind: Schema.Literal("pull_request"),
  }),
  Schema.Struct({
    action: Schema.Literal("merge"),
    ...GitHubItemTarget,
    kind: Schema.Literal("pull_request"),
    method: Schema.Literals(["merge", "squash", "rebase"]),
    deleteBranch: Schema.Boolean,
    auto: Schema.Boolean,
    expectedHeadSha: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    action: Schema.Literal("rerun_checks"),
    ...GitHubItemTarget,
    kind: Schema.Literal("pull_request"),
    runId: PositiveInt,
    failedOnly: Schema.Boolean,
  }),
  Schema.Struct({
    action: Schema.Literal("mark_notification"),
    cwd: Schema.NullOr(TrimmedNonEmptyString),
    notificationId: TrimmedNonEmptyString,
    mode: Schema.Literals(["read", "done"]),
  }),
  Schema.Struct({
    action: Schema.Literal("create_issue"),
    cwd: Schema.NullOr(TrimmedNonEmptyString),
    repository: RepositoryName,
    title: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
    body: BodyText,
    labels: Schema.Array(TrimmedNonEmptyString),
    assignees: Schema.Array(TrimmedNonEmptyString),
  }),
]);
export type GitHubWorkItemActionInput = typeof GitHubWorkItemActionInput.Type;

export const GitHubWorkItemActionResult = Schema.Struct({
  ok: Schema.Boolean,
  message: TrimmedNonEmptyString,
  url: NullableTrimmedText,
});
export type GitHubWorkItemActionResult = typeof GitHubWorkItemActionResult.Type;
