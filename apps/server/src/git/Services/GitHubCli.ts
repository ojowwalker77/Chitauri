/**
 * GitHub workflow service contract.
 *
 * The historical service name is retained for downstream compatibility. Live
 * runtime methods use the direct GitHub API.
 *
 * @module GitHubCli
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { GitPullRequestCheck, GitPullRequestComment } from "@t3tools/contracts";

import type { ProcessRunResult } from "../../processRunner";
import type { GitHubCliError } from "../Errors.ts";

/**
 * Historical fixture field list retained by GitManager tests.
 *
 * Note: `mergeable` is computed lazily by GitHub (it answers UNKNOWN while recomputing),
 * so list calls may pay a small extra API cost for it. The remote-status cache bounds
 * that cost; if status polling ever feels slow, this field is the first suspect.
 */
export const PULL_REQUEST_SUMMARY_JSON_FIELDS =
  "number,title,url,baseRefName,headRefName,state,mergedAt,isDraft,mergeable,additions,deletions,changedFiles,isCrossRepository,headRepository,headRepositoryOwner,updatedAt";

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isDraft?: boolean;
  readonly mergeability?: "mergeable" | "conflicting" | "unknown";
  readonly additions?: number | null;
  readonly deletions?: number | null;
  readonly changedFiles?: number | null;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
  /** ISO timestamp of the last PR update; used to rank multiple PRs for one branch. */
  readonly updatedAt?: string | null;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export interface GitHubPullRequestReviewCommentsResult {
  readonly comments: ReadonlyArray<GitPullRequestComment>;
  readonly truncated: boolean;
}

/**
 * GitHubCliShape - Service API for GitHub-backed Git workflows.
 */
export interface GitHubCliShape {
  /** @deprecated Arbitrary CLI execution is unavailable in the live API layer. */
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
    readonly stdin?: string;
    readonly maxBufferBytes?: number;
    readonly outputMode?: "error" | "truncate";
  }) => Effect.Effect<ProcessRunResult, GitHubCliError>;

  /**
   * List open pull requests for a head branch.
   */
  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  /**
   * List pull requests for a head branch in any state (open, closed, merged).
   * Used to resolve the branch's most relevant PR when no open PR exists.
   */
  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  /**
   * Resolve a pull request by URL, number, or branch-ish identifier.
   */
  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  /**
   * Resolve a pull request together with its CI checks in a single GraphQL request.
   */
  readonly getPullRequestWithChecks: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<
    {
      readonly summary: GitHubPullRequestSummary;
      readonly checks: ReadonlyArray<GitPullRequestCheck>;
    },
    GitHubCliError
  >;

  /**
   * List the root comments of unresolved review threads for a pull request.
   * Owner/repo are passed explicitly (parsed from the PR URL) so fork checkouts whose
   * remotes point at a different repository still query the repo that owns the PR.
   */
  readonly getPullRequestReviewComments: (input: {
    readonly cwd: string;
    readonly host: string;
    readonly owner: string;
    readonly repo: string;
    readonly number: number;
  }) => Effect.Effect<GitHubPullRequestReviewCommentsResult, GitHubCliError>;

  /**
   * Resolve clone URLs for a GitHub repository.
   */
  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  /**
   * Create a pull request from branch context and body file.
   */
  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Resolve repository default branch through GitHub metadata.
   */
  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  /**
   * Checkout a pull request into the current repository worktree.
   */
  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;
}

/**
 * Compatibility service tag for direct GitHub workflow operations.
 */
export class GitHubCli extends ServiceMap.Service<GitHubCli, GitHubCliShape>()(
  "t3/git/Services/GitHubCli",
) {}
