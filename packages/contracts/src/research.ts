// FILE: research.ts
// Purpose: Typed contracts for Chitauri's durable research document library.
// Layer: Shared schema-only contracts

import { Schema } from "effect";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

export const ResearchDocumentFormat = Schema.Literal("markdown");
export type ResearchDocumentFormat = typeof ResearchDocumentFormat.Type;

export const ResearchReferenceKind = Schema.Literals([
  "file",
  "url",
  "command",
  "issue",
  "pull-request",
  "other",
]);
export type ResearchReferenceKind = typeof ResearchReferenceKind.Type;

export const ResearchReference = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  kind: ResearchReferenceKind,
  target: TrimmedNonEmptyString,
  description: Schema.NullOr(TrimmedNonEmptyString),
  line: Schema.NullOr(PositiveInt),
});
export type ResearchReference = typeof ResearchReference.Type;

export const ResearchDocumentSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  summary: Schema.NullOr(TrimmedNonEmptyString),
  format: ResearchDocumentFormat,
  repositoryName: TrimmedNonEmptyString,
  repositoryRoot: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
  archivedAt: Schema.NullOr(TrimmedNonEmptyString),
  storagePath: TrimmedNonEmptyString,
  referenceCount: NonNegativeInt,
  tags: Schema.Array(TrimmedNonEmptyString),
});
export type ResearchDocumentSummary = typeof ResearchDocumentSummary.Type;

export const ResearchListInput = Schema.Struct({});
export type ResearchListInput = typeof ResearchListInput.Type;

export const ResearchListResult = Schema.Struct({
  documents: Schema.Array(ResearchDocumentSummary),
  plansRoot: TrimmedNonEmptyString,
});
export type ResearchListResult = typeof ResearchListResult.Type;

export const ResearchReadInput = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
});
export type ResearchReadInput = typeof ResearchReadInput.Type;

export const ResearchDocument = Schema.Struct({
  ...ResearchDocumentSummary.fields,
  content: Schema.String,
  documentPath: TrimmedNonEmptyString,
  manifestPath: Schema.NullOr(TrimmedNonEmptyString),
  references: Schema.Array(ResearchReference),
});
export type ResearchDocument = typeof ResearchDocument.Type;

export const ResearchReadResult = Schema.Struct({
  document: ResearchDocument,
});
export type ResearchReadResult = typeof ResearchReadResult.Type;

export const ResearchSetArchivedInput = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
  archived: Schema.Boolean,
});
export type ResearchSetArchivedInput = typeof ResearchSetArchivedInput.Type;

export const ResearchSetArchivedResult = Schema.Struct({
  document: ResearchDocument,
});
export type ResearchSetArchivedResult = typeof ResearchSetArchivedResult.Type;
