import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const ComputerScriptId = makeEntityId("ComputerScriptId");
export type ComputerScriptId = typeof ComputerScriptId.Type;
export const ComputerScriptAnalysisId = makeEntityId("ComputerScriptAnalysisId");
export type ComputerScriptAnalysisId = typeof ComputerScriptAnalysisId.Type;
export const ComputerScriptRunId = makeEntityId("ComputerScriptRunId");
export type ComputerScriptRunId = typeof ComputerScriptRunId.Type;
export const ComputerScriptCandidateId = makeEntityId("ComputerScriptCandidateId");
export type ComputerScriptCandidateId = typeof ComputerScriptCandidateId.Type;

export const ComputerScriptRisk = Schema.Literals(["low", "redownload", "disruptive"]);
export type ComputerScriptRisk = typeof ComputerScriptRisk.Type;
export const ComputerScriptPlatform = Schema.Literals(["darwin", "linux", "win32"]);
export type ComputerScriptPlatform = typeof ComputerScriptPlatform.Type;
export const ComputerScriptCategory = Schema.Literals([
  "developer-cleanup",
  "package-cache",
  "project-artifact",
]);
export type ComputerScriptCategory = typeof ComputerScriptCategory.Type;

export const ComputerScriptState = Schema.Literals([
  "idle",
  "analyzing",
  "review",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "interrupted",
]);
export type ComputerScriptState = typeof ComputerScriptState.Type;

export const ComputerScriptErrorCode = Schema.Literals([
  "active_target",
  "cancelled",
  "changed_since_analysis",
  "command_failed",
  "invalid_target",
  "permission_denied",
  "tool_unavailable",
  "unsupported_platform",
  "unknown",
]);
export type ComputerScriptErrorCode = typeof ComputerScriptErrorCode.Type;

const NullableText = Schema.NullOr(Schema.String);
const BoundedText = Schema.String.check(Schema.isMaxLength(4_000));
const BoundedPath = TrimmedNonEmptyString.check(Schema.isMaxLength(2_000));
const MetadataRecord = Schema.Record(
  TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  Schema.String.check(Schema.isMaxLength(512)),
).check(Schema.isMaxProperties(32));

export const ComputerScriptDescriptor = Schema.Struct({
  id: ComputerScriptId,
  title: TrimmedNonEmptyString,
  summary: BoundedText,
  category: ComputerScriptCategory,
  platforms: Schema.Array(ComputerScriptPlatform).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  risk: ComputerScriptRisk,
  consequence: BoundedText,
  capabilities: Schema.Struct({
    analyze: Schema.Literal(true),
    cancel: Schema.Literal(true),
  }),
});
export type ComputerScriptDescriptor = typeof ComputerScriptDescriptor.Type;

export const ComputerScriptAvailability = Schema.Struct({
  utilityId: ComputerScriptId,
  available: Schema.Boolean,
  reason: NullableText,
});
export type ComputerScriptAvailability = typeof ComputerScriptAvailability.Type;

export const ComputerScriptsCatalogResult = Schema.Struct({
  utilities: Schema.Array(ComputerScriptDescriptor),
  availability: Schema.Array(ComputerScriptAvailability),
  syncedAt: IsoDateTime,
});
export type ComputerScriptsCatalogResult = typeof ComputerScriptsCatalogResult.Type;

export const ComputerScriptsOptions = Schema.Struct({
  roots: Schema.Array(BoundedPath).check(Schema.isMaxLength(16)),
  minAgeDays: NonNegativeInt.check(Schema.isLessThanOrEqualTo(3650)),
  minBytes: NonNegativeInt,
  includeProtected: Schema.Boolean,
});
export type ComputerScriptsOptions = typeof ComputerScriptsOptions.Type;

export const ComputerScriptsStartAnalysisInput = Schema.Struct({
  utilityId: ComputerScriptId,
  options: ComputerScriptsOptions,
});
export type ComputerScriptsStartAnalysisInput = typeof ComputerScriptsStartAnalysisInput.Type;

export const ComputerScriptsAnalysisInput = Schema.Struct({
  analysisId: ComputerScriptAnalysisId,
});
export type ComputerScriptsAnalysisInput = typeof ComputerScriptsAnalysisInput.Type;

export const ComputerScriptsCancelAnalysisInput = ComputerScriptsAnalysisInput;
export type ComputerScriptsCancelAnalysisInput = typeof ComputerScriptsCancelAnalysisInput.Type;

export const ComputerScriptCandidate = Schema.Struct({
  id: ComputerScriptCandidateId,
  label: TrimmedNonEmptyString,
  path: Schema.NullOr(BoundedPath),
  bytes: Schema.NullOr(NonNegativeInt),
  selectedByDefault: Schema.Boolean,
  protectedReason: NullableText,
  fingerprint: TrimmedNonEmptyString,
  metadata: MetadataRecord,
});
export type ComputerScriptCandidate = typeof ComputerScriptCandidate.Type;

export const ComputerScriptProgress = Schema.Struct({
  current: NonNegativeInt,
  total: Schema.NullOr(NonNegativeInt),
  label: NullableText,
  bytes: NonNegativeInt,
});
export type ComputerScriptProgress = typeof ComputerScriptProgress.Type;

export const ComputerScriptLogLevel = Schema.Literals(["info", "warning", "error"]);
export type ComputerScriptLogLevel = typeof ComputerScriptLogLevel.Type;

export const ComputerScriptLogEntry = Schema.Struct({
  at: IsoDateTime,
  level: ComputerScriptLogLevel,
  message: BoundedText,
  target: Schema.NullOr(BoundedPath),
});
export type ComputerScriptLogEntry = typeof ComputerScriptLogEntry.Type;

export const ComputerScriptsAnalysisSnapshot = Schema.Struct({
  id: ComputerScriptAnalysisId,
  utilityId: ComputerScriptId,
  state: ComputerScriptState,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  options: ComputerScriptsOptions,
  candidates: Schema.Array(ComputerScriptCandidate),
  estimatedBytes: NonNegativeInt,
  progress: ComputerScriptProgress,
  logs: Schema.Array(ComputerScriptLogEntry).check(Schema.isMaxLength(200)),
  error: NullableText,
});
export type ComputerScriptsAnalysisSnapshot = typeof ComputerScriptsAnalysisSnapshot.Type;

export const ComputerScriptsRunItemResult = Schema.Struct({
  candidateId: ComputerScriptCandidateId,
  label: TrimmedNonEmptyString,
  path: Schema.NullOr(BoundedPath),
  status: Schema.Literals(["removed", "skipped", "failed"]),
  reason: Schema.NullOr(ComputerScriptErrorCode),
  message: BoundedText,
  bytes: NonNegativeInt,
});
export type ComputerScriptsRunItemResult = typeof ComputerScriptsRunItemResult.Type;

export const ComputerScriptsRunSnapshot = Schema.Struct({
  id: ComputerScriptRunId,
  analysisId: ComputerScriptAnalysisId,
  utilityId: ComputerScriptId,
  state: ComputerScriptState,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  selectedCandidateIds: Schema.Array(ComputerScriptCandidateId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(500),
  ),
  estimatedBytes: NonNegativeInt,
  reclaimedBytes: NonNegativeInt,
  removedCount: NonNegativeInt,
  skippedCount: NonNegativeInt,
  failedCount: NonNegativeInt,
  progress: ComputerScriptProgress,
  logs: Schema.Array(ComputerScriptLogEntry).check(Schema.isMaxLength(200)),
  results: Schema.Array(ComputerScriptsRunItemResult).check(Schema.isMaxLength(500)),
  error: NullableText,
});
export type ComputerScriptsRunSnapshot = typeof ComputerScriptsRunSnapshot.Type;

export const ComputerScriptsStartAnalysisResult = Schema.Struct({
  snapshot: ComputerScriptsAnalysisSnapshot,
});
export type ComputerScriptsStartAnalysisResult = typeof ComputerScriptsStartAnalysisResult.Type;

export const ComputerScriptsStartRunInput = Schema.Struct({
  analysisId: ComputerScriptAnalysisId,
  utilityId: ComputerScriptId,
  candidateIds: Schema.Array(ComputerScriptCandidateId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(500),
  ),
});
export type ComputerScriptsStartRunInput = typeof ComputerScriptsStartRunInput.Type;

export const ComputerScriptsStartRunResult = Schema.Struct({
  snapshot: ComputerScriptsRunSnapshot,
});
export type ComputerScriptsStartRunResult = typeof ComputerScriptsStartRunResult.Type;

export const ComputerScriptsRunInput = Schema.Struct({
  runId: ComputerScriptRunId,
});
export type ComputerScriptsRunInput = typeof ComputerScriptsRunInput.Type;

export const ComputerScriptsCancelRunInput = ComputerScriptsRunInput;
export type ComputerScriptsCancelRunInput = typeof ComputerScriptsCancelRunInput.Type;

export const ComputerScriptsListHistoryInput = Schema.Struct({
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(50)),
});
export type ComputerScriptsListHistoryInput = typeof ComputerScriptsListHistoryInput.Type;

export const ComputerScriptsHistoryEntry = Schema.Struct({
  id: ComputerScriptRunId,
  utilityId: ComputerScriptId,
  state: ComputerScriptState,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  estimatedBytes: NonNegativeInt,
  reclaimedBytes: NonNegativeInt,
  removedCount: NonNegativeInt,
  skippedCount: NonNegativeInt,
  failedCount: NonNegativeInt,
});
export type ComputerScriptsHistoryEntry = typeof ComputerScriptsHistoryEntry.Type;

export const ComputerScriptsListHistoryResult = Schema.Struct({
  runs: Schema.Array(ComputerScriptsHistoryEntry),
});
export type ComputerScriptsListHistoryResult = typeof ComputerScriptsListHistoryResult.Type;

export const ComputerScriptsStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("analysis"),
    snapshot: ComputerScriptsAnalysisSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("run"),
    snapshot: ComputerScriptsRunSnapshot,
  }),
]);
export type ComputerScriptsStreamEvent = typeof ComputerScriptsStreamEvent.Type;
