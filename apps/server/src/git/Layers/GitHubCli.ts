/**
 * Compatibility exports for tests and downstream imports while the service
 * tag retains its historical name. Production runtime uses GitHubApiLive and
 * never executes arbitrary gh commands.
 */
import { Effect, Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";

import { GitHubCliError } from "../Errors";
import type { GitHubPullRequestSummary } from "../Services/GitHubCli";

export { GitHubApiLive as GitHubCliLive } from "./GitHubApi";

const RawPullRequest = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  isDraft: Schema.optional(Schema.NullOr(Schema.Boolean)),
  mergeable: Schema.optional(Schema.NullOr(Schema.String)),
  additions: Schema.optional(Schema.NullOr(Schema.Number)),
  deletions: Schema.optional(Schema.NullOr(Schema.Number)),
  changedFiles: Schema.optional(Schema.NullOr(Schema.Number)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepository: Schema.optional(
    Schema.NullOr(Schema.Struct({ nameWithOwner: Schema.String })),
  ),
  headRepositoryOwner: Schema.optional(
    Schema.NullOr(Schema.Struct({ login: Schema.String })),
  ),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

const decodeEntry = Schema.decodeUnknownSync(RawPullRequest);

function normalizeCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeEntry(
  raw: Schema.Schema.Type<typeof RawPullRequest>,
): GitHubPullRequestSummary {
  const headRepositoryNameWithOwner = raw.headRepository?.nameWithOwner ?? null;
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state:
      raw.mergedAt || raw.state === "MERGED"
        ? "merged"
        : raw.state === "CLOSED"
          ? "closed"
          : "open",
    isDraft: raw.isDraft === true,
    mergeability:
      raw.mergeable === "MERGEABLE"
        ? "mergeable"
        : raw.mergeable === "CONFLICTING"
          ? "conflicting"
          : "unknown",
    additions: normalizeCount(raw.additions),
    deletions: normalizeCount(raw.deletions),
    changedFiles: normalizeCount(raw.changedFiles),
    updatedAt: raw.updatedAt?.trim() || null,
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(raw.headRepositoryOwner?.login
      ? { headRepositoryOwnerLogin: raw.headRepositoryOwner.login }
      : {}),
  };
}

/** Decodes historical gh-shaped fixtures used by the GitManager test fake. */
export function decodePullRequestListJson(
  raw: string,
  operation: "listOpenPullRequests" | "listPullRequests" = "listPullRequests",
): Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError> {
  if (raw.trim().length === 0) return Effect.succeed([]);
  return Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) =>
      new GitHubCliError({ operation, detail: "GitHub returned invalid PR list JSON.", cause }),
  }).pipe(
    Effect.flatMap((value) =>
      Array.isArray(value)
        ? Effect.succeed(value)
        : Effect.fail(
            new GitHubCliError({
              operation,
              detail: "GitHub returned a non-array PR list payload.",
            }),
          ),
    ),
    Effect.map((entries) =>
      entries.flatMap((entry) => {
        try {
          return [normalizeEntry(decodeEntry(entry))];
        } catch {
          return [];
        }
      }),
    ),
  );
}
