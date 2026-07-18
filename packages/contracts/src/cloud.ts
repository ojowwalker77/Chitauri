import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const IdentifierText = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
const WarningText = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
const NullableShortText = Schema.NullOr(ShortText);
const NullableIdentifierText = Schema.NullOr(IdentifierText);
const BoundedWarnings = Schema.Array(WarningText).check(Schema.isMaxLength(64));

export const CloudProvider = Schema.Literals(["aws", "gcp"]);
export type CloudProvider = typeof CloudProvider.Type;

export const CloudAuthState = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "expired",
  "error",
]);
export type CloudAuthState = typeof CloudAuthState.Type;

export const CloudCompleteness = Schema.Literals(["complete", "partial", "unknown"]);
export type CloudCompleteness = typeof CloudCompleteness.Type;

export const CloudOwnershipConfidence = Schema.Literals(["exact", "probable", "untracked"]);
export type CloudOwnershipConfidence = typeof CloudOwnershipConfidence.Type;

export const CloudBindingId = IdentifierText.pipe(Schema.brand("CloudBindingId"));
export type CloudBindingId = typeof CloudBindingId.Type;

export const CloudContextId = IdentifierText.pipe(Schema.brand("CloudContextId"));
export type CloudContextId = typeof CloudContextId.Type;

export const CloudResourceId = IdentifierText.pipe(Schema.brand("CloudResourceId"));
export type CloudResourceId = typeof CloudResourceId.Type;

export const CloudContextSummary = Schema.Struct({
  id: CloudContextId,
  provider: CloudProvider,
  label: ShortText,
  authState: CloudAuthState,
  principalLabel: NullableShortText,
  accountId: NullableShortText,
  projectId: NullableShortText,
  sourceHost: ShortText,
  expiresAt: Schema.NullOr(IsoDateTime),
  setupInstruction: Schema.NullOr(WarningText),
  warnings: BoundedWarnings,
});
export type CloudContextSummary = typeof CloudContextSummary.Type;

export const CloudListContextsInput = Schema.Struct({});
export type CloudListContextsInput = typeof CloudListContextsInput.Type;

export const CloudListContextsResult = Schema.Struct({
  contexts: Schema.Array(CloudContextSummary).check(Schema.isMaxLength(128)),
  sourceHost: ShortText,
  syncedAt: IsoDateTime,
});
export type CloudListContextsResult = typeof CloudListContextsResult.Type;

export const CloudDiscoveryTool = Schema.Literals([
  "terraform",
  "terragrunt",
  "pulumi",
  "cdk",
  "sst",
  "serverless",
  "cloudformation",
  "kubernetes",
  "helm",
  "kustomize",
  "github-actions",
  "provider-cli",
]);
export type CloudDiscoveryTool = typeof CloudDiscoveryTool.Type;

export const CloudDiscoveryEvidence = Schema.Struct({
  path: IdentifierText,
  tool: CloudDiscoveryTool,
  providers: Schema.Array(CloudProvider).check(Schema.isMaxLength(2)),
  reason: ShortText,
});
export type CloudDiscoveryEvidence = typeof CloudDiscoveryEvidence.Type;

export const CloudDiscoverProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type CloudDiscoverProjectInput = typeof CloudDiscoverProjectInput.Type;

export const CloudProjectDiscoveryResult = Schema.Struct({
  projectId: ProjectId,
  providers: Schema.Array(CloudProvider).check(Schema.isMaxLength(2)),
  tools: Schema.Array(CloudDiscoveryTool).check(Schema.isMaxLength(32)),
  evidence: Schema.Array(CloudDiscoveryEvidence).check(Schema.isMaxLength(512)),
  warnings: BoundedWarnings,
  scannedAt: IsoDateTime,
});
export type CloudProjectDiscoveryResult = typeof CloudProjectDiscoveryResult.Type;

export const CloudProjectBinding = Schema.Struct({
  id: CloudBindingId,
  projectId: ProjectId,
  contextId: CloudContextId,
  environment: ShortText,
  regions: Schema.Array(ShortText).check(Schema.isMaxLength(32)),
  expectedAccountId: NullableShortText,
  expectedProjectId: NullableShortText,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CloudProjectBinding = typeof CloudProjectBinding.Type;

export const CloudListBindingsInput = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
});
export type CloudListBindingsInput = typeof CloudListBindingsInput.Type;

export const CloudListBindingsResult = Schema.Struct({
  bindings: Schema.Array(CloudProjectBinding).check(Schema.isMaxLength(512)),
});
export type CloudListBindingsResult = typeof CloudListBindingsResult.Type;

export const CloudUpsertBindingInput = Schema.Struct({
  id: Schema.NullOr(CloudBindingId),
  projectId: ProjectId,
  contextId: CloudContextId,
  environment: ShortText,
  regions: Schema.Array(ShortText).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
});
export type CloudUpsertBindingInput = typeof CloudUpsertBindingInput.Type;

export const CloudOwnershipEvidence = Schema.Struct({
  path: NullableIdentifierText,
  reason: ShortText,
  source: Schema.Literals(["repository", "tag", "provider"]),
});
export type CloudOwnershipEvidence = typeof CloudOwnershipEvidence.Type;

export const CloudOwnership = Schema.Struct({
  confidence: CloudOwnershipConfidence,
  evidence: Schema.Array(CloudOwnershipEvidence).check(Schema.isMaxLength(32)),
});
export type CloudOwnership = typeof CloudOwnership.Type;

const CloudTags = Schema.Record(
  Schema.String.check(Schema.isMaxLength(256)),
  Schema.String.check(Schema.isMaxLength(2_048)),
).check(Schema.isMaxProperties(128));

export const CloudResourceSummary = Schema.Struct({
  id: CloudResourceId,
  provider: CloudProvider,
  externalId: IdentifierText,
  type: ShortText,
  name: ShortText,
  accountId: NullableShortText,
  projectId: NullableShortText,
  location: NullableShortText,
  state: NullableShortText,
  tags: CloudTags,
  consoleUrl: NullableIdentifierText,
  ownership: CloudOwnership,
  observedAt: IsoDateTime,
});
export type CloudResourceSummary = typeof CloudResourceSummary.Type;

export const CloudSearchResourcesInput = Schema.Struct({
  bindingId: CloudBindingId,
  query: Schema.NullOr(Schema.String.check(Schema.isMaxLength(512))),
  types: Schema.Array(ShortText).check(Schema.isMaxLength(32)),
  states: Schema.Array(ShortText).check(Schema.isMaxLength(16)),
  ownership: Schema.Array(CloudOwnershipConfidence).check(Schema.isMaxLength(3)),
  cursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(8_192))),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(100)),
});
export type CloudSearchResourcesInput = typeof CloudSearchResourcesInput.Type;

export const CloudInventoryResult = Schema.Struct({
  binding: CloudProjectBinding,
  context: CloudContextSummary,
  resources: Schema.Array(CloudResourceSummary).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(8_192))),
  completeness: CloudCompleteness,
  syncedAt: IsoDateTime,
  warnings: BoundedWarnings,
});
export type CloudInventoryResult = typeof CloudInventoryResult.Type;

export const CloudResourceDetailInput = Schema.Struct({
  bindingId: CloudBindingId,
  resourceId: CloudResourceId,
});
export type CloudResourceDetailInput = typeof CloudResourceDetailInput.Type;

export const CloudHealthStatus = Schema.Literals([
  "healthy",
  "degraded",
  "unhealthy",
  "unknown",
  "unsupported",
]);
export type CloudHealthStatus = typeof CloudHealthStatus.Type;

const CloudHealthFacts = Schema.Record(
  Schema.String.check(Schema.isMaxLength(128)),
  Schema.String.check(Schema.isMaxLength(2_048)),
).check(Schema.isMaxProperties(64));

export const CloudResourceHealth = Schema.Struct({
  status: CloudHealthStatus,
  summary: WarningText,
  facts: CloudHealthFacts,
  observedAt: IsoDateTime,
});
export type CloudResourceHealth = typeof CloudResourceHealth.Type;

export const CloudResourceActivity = Schema.Struct({
  id: IdentifierText,
  kind: ShortText,
  summary: WarningText,
  occurredAt: IsoDateTime,
  consoleUrl: NullableIdentifierText,
});
export type CloudResourceActivity = typeof CloudResourceActivity.Type;

export const CloudResourceDetailResult = Schema.Struct({
  binding: CloudProjectBinding,
  context: CloudContextSummary,
  resource: CloudResourceSummary,
  health: CloudResourceHealth,
  activity: Schema.Array(CloudResourceActivity).check(Schema.isMaxLength(100)),
  completeness: CloudCompleteness,
  warnings: BoundedWarnings,
  syncedAt: IsoDateTime,
});
export type CloudResourceDetailResult = typeof CloudResourceDetailResult.Type;

export const CloudQueryLogsInput = Schema.Struct({
  bindingId: CloudBindingId,
  resourceId: CloudResourceId,
  startTime: IsoDateTime,
  endTime: IsoDateTime,
  query: Schema.NullOr(Schema.String.check(Schema.isMaxLength(512))),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(200)),
});
export type CloudQueryLogsInput = typeof CloudQueryLogsInput.Type;

export const CloudLogEntry = Schema.Struct({
  id: IdentifierText,
  timestamp: IsoDateTime,
  severity: NullableShortText,
  message: Schema.String.check(Schema.isMaxLength(16_384)),
  source: ShortText,
  truncated: Schema.Boolean,
});
export type CloudLogEntry = typeof CloudLogEntry.Type;

export const CloudQueryLogsResult = Schema.Struct({
  binding: CloudProjectBinding,
  context: CloudContextSummary,
  resourceId: CloudResourceId,
  entries: Schema.Array(CloudLogEntry).check(Schema.isMaxLength(200)),
  startTime: IsoDateTime,
  endTime: IsoDateTime,
  completeness: CloudCompleteness,
  warnings: BoundedWarnings,
  queriedAt: IsoDateTime,
});
export type CloudQueryLogsResult = typeof CloudQueryLogsResult.Type;

export const CloudErrorCode = Schema.Literals([
  "auth_required",
  "identity_mismatch",
  "binding_not_found",
  "project_not_found",
  "invalid_scope",
  "access_denied",
  "not_configured",
  "rate_limited",
  "unsupported",
  "provider_error",
]);
export type CloudErrorCode = typeof CloudErrorCode.Type;

export class CloudError extends Schema.TaggedErrorClass<CloudError>()("CloudError", {
  code: CloudErrorCode,
  message: WarningText,
  retryable: Schema.Boolean,
  setupInstruction: Schema.NullOr(WarningText),
}) {}

export const CloudOperationReceipt = Schema.Struct({
  provider: CloudProvider,
  bindingId: CloudBindingId,
  resourceId: CloudResourceId,
  observedAt: IsoDateTime,
  logEntryCount: NonNegativeInt,
});
export type CloudOperationReceipt = typeof CloudOperationReceipt.Type;
