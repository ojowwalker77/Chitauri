import { Effect, FileSystem, Layer } from "effect";
import type {
  GitPullRequestCheck,
  GitPullRequestCheckStatus,
  GitPullRequestComment,
} from "@t3tools/contracts";

import { GitHubApiClient } from "../../github/Services/GitHubApiClient";
import {
  parseGitHubRepositoryName,
  parseGitHubRepositoryRemote,
  type GitHubRepositoryRef,
} from "../../github/repository";
import { GitHubCliError } from "../Errors";
import { GitCore } from "../Services/GitCore";
import {
  GitHubCli,
  type GitHubCliShape,
  type GitHubPullRequestReviewCommentsResult,
  type GitHubPullRequestSummary,
  type GitHubRepositoryCloneUrls,
} from "../Services/GitHubCli";

type JsonRecord = Record<string, unknown>;

const REVIEW_THREAD_PAGE_SIZE = 50;
const REVIEW_THREAD_PAGE_LIMIT = 5;
const REVIEW_COMMENT_LIMIT = 20;

const PULL_REQUEST_WITH_CHECKS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number title url state mergedAt isDraft mergeable additions deletions changedFiles updatedAt
      baseRefName headRefName isCrossRepository
      headRepository { nameWithOwner }
      headRepositoryOwner { login }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const REVIEW_THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: $first, after: $after) {
        nodes {
          isResolved
          comments(first: 1) {
            nodes { id body path url createdAt author { login } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeState(state: unknown, mergedAt: unknown): "open" | "closed" | "merged" {
  if (stringValue(mergedAt) || state === "MERGED" || state === "merged") return "merged";
  return state === "CLOSED" || state === "closed" ? "closed" : "open";
}

function normalizeMergeability(value: unknown): "mergeable" | "conflicting" | "unknown" {
  if (value === "MERGEABLE" || value === true) return "mergeable";
  if (value === "CONFLICTING" || value === false) return "conflicting";
  return "unknown";
}

function pullRequestSummary(rawValue: unknown): GitHubPullRequestSummary {
  const raw = asRecord(rawValue);
  const base = asRecord(raw.base);
  const head = asRecord(raw.head);
  const baseRepository = asRecord(base.repo);
  const headRepository = asRecord(raw.headRepository ?? head.repo);
  const headOwner = asRecord(raw.headRepositoryOwner ?? head.user);
  const number = numberValue(raw.number);
  const title = stringValue(raw.title);
  const url = stringValue(raw.html_url ?? raw.url);
  const baseRefName = stringValue(raw.baseRefName ?? base.ref);
  const headRefName = stringValue(raw.headRefName ?? head.ref);
  if (!number || !title || !url || !baseRefName || !headRefName) {
    throw new GitHubCliError({
      operation: "decodePullRequest",
      detail: "GitHub returned an incomplete pull request payload.",
    });
  }
  const headRepositoryNameWithOwner = stringValue(
    headRepository.nameWithOwner ?? headRepository.full_name,
  );
  const baseRepositoryNameWithOwner = stringValue(baseRepository.full_name);
  const headRepositoryOwnerLogin =
    stringValue(headOwner.login) ?? headRepositoryNameWithOwner?.split("/")[0] ?? null;
  return {
    number,
    title,
    url,
    baseRefName,
    headRefName,
    state: normalizeState(raw.state, raw.mergedAt ?? raw.merged_at),
    isDraft: raw.isDraft === true || raw.draft === true,
    mergeability: normalizeMergeability(raw.mergeable),
    additions: numberValue(raw.additions),
    deletions: numberValue(raw.deletions),
    changedFiles: numberValue(raw.changedFiles ?? raw.changed_files),
    isCrossRepository:
      typeof raw.isCrossRepository === "boolean"
        ? raw.isCrossRepository
        : Boolean(
            headRepositoryNameWithOwner &&
            baseRepositoryNameWithOwner &&
            headRepositoryNameWithOwner.toLowerCase() !== baseRepositoryNameWithOwner.toLowerCase(),
          ),
    headRepositoryNameWithOwner,
    headRepositoryOwnerLogin,
    updatedAt: stringValue(raw.updatedAt ?? raw.updated_at),
  };
}

function checkStatus(rawValue: unknown): GitPullRequestCheckStatus {
  const raw = asRecord(rawValue);
  const state = stringValue(raw.state)?.toUpperCase();
  if (state) return state === "SUCCESS" ? "success" : state === "PENDING" ? "pending" : "failure";
  const status = stringValue(raw.status)?.toUpperCase();
  if (status && status !== "COMPLETED") return "pending";
  switch (stringValue(raw.conclusion)?.toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failure";
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    case "NEUTRAL":
    case "STALE":
      return "neutral";
    default:
      return "pending";
  }
}

function normalizeChecks(value: unknown): GitPullRequestCheck[] {
  return arrayValue(value).flatMap((entry) => {
    const raw = asRecord(entry);
    const name = stringValue(raw.name ?? raw.context);
    if (!name) return [];
    return [
      {
        name,
        status: checkStatus(raw),
        url: stringValue(raw.detailsUrl ?? raw.targetUrl),
      },
    ];
  });
}

function parsePullRequestReference(reference: string): {
  repository: GitHubRepositoryRef | null;
  number: number | null;
} {
  const url = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(reference.trim());
  if (url) {
    return {
      repository: {
        host: url[1]!,
        owner: url[2]!,
        repo: url[3]!,
      },
      number: Number(url[4]),
    };
  }
  const numeric = /^#?(\d+)$/.exec(reference.trim());
  return { repository: null, number: numeric ? Number(numeric[1]) : null };
}

export const makeGitHubApi = Effect.gen(function* () {
  const api = yield* GitHubApiClient;
  const git = yield* GitCore;
  const fileSystem = yield* FileSystem.FileSystem;

  const repositoryForCwd = (cwd: string) =>
    git.readConfigValue(cwd, "remote.origin.url").pipe(
      Effect.flatMap((remote) => {
        const repository = parseGitHubRepositoryRemote(remote);
        return repository
          ? Effect.succeed(repository)
          : Effect.fail(
              new GitHubCliError({
                operation: "resolveRepository",
                detail: "The origin remote is not a GitHub repository.",
              }),
            );
      }),
      Effect.mapError((cause) =>
        cause instanceof GitHubCliError
          ? cause
          : new GitHubCliError({
              operation: "resolveRepository",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
      ),
    );

  const normalizeHeadSelector = (cwd: string, repository: GitHubRepositoryRef, selector: string) =>
    Effect.gen(function* () {
      const separator = selector.indexOf(":");
      if (separator < 1) return `${repository.owner}:${selector}`;
      const prefix = selector.slice(0, separator);
      const branch = selector.slice(separator + 1);
      const remote = yield* git
        .readConfigValue(cwd, `remote.${prefix}.url`)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      const remoteRepository = parseGitHubRepositoryRemote(remote);
      return `${remoteRepository?.owner ?? prefix}:${branch}`;
    });

  const listPullRequests = (
    input: { readonly cwd: string; readonly headSelector: string; readonly limit?: number },
    state: "open" | "all",
  ) =>
    Effect.gen(function* () {
      const repository = yield* repositoryForCwd(input.cwd);
      const head = yield* normalizeHeadSelector(input.cwd, repository, input.headSelector);
      const raw = yield* api.requestJson<unknown[]>({
        host: repository.host,
        path: `/repos/${repository.owner}/${repository.repo}/pulls`,
        query: {
          state,
          head,
          sort: "updated",
          direction: "desc",
          per_page: input.limit ?? (state === "open" ? 1 : 20),
        },
        cacheTtlMs: 60_000,
      });
      return arrayValue(raw).flatMap((entry) => {
        try {
          return [pullRequestSummary(entry)];
        } catch {
          return [];
        }
      });
    });

  const getPullRequest: GitHubCliShape["getPullRequest"] = (input) =>
    Effect.gen(function* () {
      const parsed = parsePullRequestReference(input.reference);
      const repository = parsed.repository ?? (yield* repositoryForCwd(input.cwd));
      if (parsed.number) {
        const raw = yield* api.requestJson({
          host: repository.host,
          path: `/repos/${repository.owner}/${repository.repo}/pulls/${parsed.number}`,
          cacheTtlMs: 30_000,
        });
        return pullRequestSummary(raw);
      }
      const matches = yield* listPullRequests(
        { cwd: input.cwd, headSelector: input.reference, limit: 20 },
        "all",
      );
      const match = matches[0];
      if (!match) {
        return yield* Effect.fail(
          new GitHubCliError({
            operation: "getPullRequest",
            detail: `Pull request '${input.reference}' was not found.`,
          }),
        );
      }
      return match;
    });

  const getPullRequestWithChecks: GitHubCliShape["getPullRequestWithChecks"] = (input) =>
    Effect.gen(function* () {
      const resolved = yield* getPullRequest(input);
      const parsed = parsePullRequestReference(resolved.url);
      const repository = parsed.repository;
      if (!repository) {
        return yield* Effect.fail(
          new GitHubCliError({
            operation: "getPullRequestWithChecks",
            detail: "Could not resolve the pull request repository.",
          }),
        );
      }
      const response = yield* api.graphql<unknown>({
        host: repository.host,
        query: PULL_REQUEST_WITH_CHECKS_QUERY,
        variables: { owner: repository.owner, repo: repository.repo, number: resolved.number },
        cacheTtlMs: 30_000,
      });
      const root = asRecord(response);
      const errors = arrayValue(root.errors);
      if (errors.length > 0) {
        return yield* Effect.fail(
          new GitHubCliError({
            operation: "getPullRequestWithChecks",
            detail: errors
              .map((error) => stringValue(asRecord(error).message) ?? "GraphQL error")
              .join("; "),
          }),
        );
      }
      const pullRequest = asRecord(asRecord(asRecord(root.data).repository).pullRequest);
      const commitNode = asRecord(arrayValue(asRecord(pullRequest.commits).nodes)[0]);
      const commit = asRecord(commitNode.commit);
      const contexts = asRecord(commit.statusCheckRollup);
      const nodes = asRecord(contexts.contexts).nodes;
      return {
        summary: Object.keys(pullRequest).length > 0 ? pullRequestSummary(pullRequest) : resolved,
        checks: normalizeChecks(nodes),
      };
    });

  const getPullRequestReviewComments: GitHubCliShape["getPullRequestReviewComments"] = (input) =>
    Effect.gen(function* () {
      const comments: GitPullRequestComment[] = [];
      let after: string | null = null;
      let pages = 0;
      let truncated = false;
      do {
        pages += 1;
        const response = asRecord(
          yield* api.graphql({
            host: input.host,
            query: REVIEW_THREADS_QUERY,
            variables: {
              owner: input.owner,
              repo: input.repo,
              number: input.number,
              first: REVIEW_THREAD_PAGE_SIZE,
              after,
            },
            cacheTtlMs: 30_000,
          }),
        );
        const errors = arrayValue(response.errors);
        if (errors.length > 0) {
          return yield* Effect.fail(
            new GitHubCliError({
              operation: "getPullRequestReviewComments",
              detail: errors
                .map((error) => stringValue(asRecord(error).message) ?? "GraphQL error")
                .join("; "),
            }),
          );
        }
        const threads = asRecord(
          asRecord(asRecord(asRecord(response.data).repository).pullRequest).reviewThreads,
        );
        for (const threadValue of arrayValue(threads.nodes)) {
          const thread = asRecord(threadValue);
          if (thread.isResolved === true) continue;
          const comment = asRecord(arrayValue(asRecord(thread.comments).nodes)[0]);
          const id = stringValue(comment.id);
          if (!id) continue;
          comments.push({
            id,
            author: stringValue(asRecord(comment.author).login),
            body: typeof comment.body === "string" ? comment.body : "",
            path: stringValue(comment.path),
            url: stringValue(comment.url),
            createdAt: stringValue(comment.createdAt),
          });
          if (comments.length === REVIEW_COMMENT_LIMIT) break;
        }
        const pageInfo = asRecord(threads.pageInfo);
        const hasNextPage = pageInfo.hasNextPage === true;
        const endCursor = stringValue(pageInfo.endCursor);
        const canContinue =
          hasNextPage &&
          endCursor !== null &&
          pages < REVIEW_THREAD_PAGE_LIMIT &&
          comments.length < REVIEW_COMMENT_LIMIT;
        if (hasNextPage && !canContinue) truncated = true;
        after = canContinue ? endCursor : null;
      } while (after !== null);
      return { comments, truncated } satisfies GitHubPullRequestReviewCommentsResult;
    });

  const getRepositoryCloneUrls: GitHubCliShape["getRepositoryCloneUrls"] = (input) =>
    Effect.gen(function* () {
      const parsed = parseGitHubRepositoryName(input.repository);
      if (!parsed) {
        return yield* Effect.fail(
          new GitHubCliError({
            operation: "getRepositoryCloneUrls",
            detail: `Invalid GitHub repository '${input.repository}'.`,
          }),
        );
      }
      const raw = asRecord(
        yield* api.requestJson({
          host: parsed.host,
          path: `/repos/${parsed.owner}/${parsed.repo}`,
          cacheTtlMs: 5 * 60_000,
        }),
      );
      const nameWithOwner = stringValue(raw.full_name) ?? input.repository;
      const url = stringValue(raw.html_url);
      const sshUrl = stringValue(raw.ssh_url);
      if (!url || !sshUrl) {
        return yield* Effect.fail(
          new GitHubCliError({
            operation: "getRepositoryCloneUrls",
            detail: "GitHub returned incomplete clone URLs.",
          }),
        );
      }
      return { nameWithOwner, url, sshUrl } satisfies GitHubRepositoryCloneUrls;
    });

  const service: GitHubCliShape = {
    execute: () =>
      Effect.fail(
        new GitHubCliError({
          operation: "execute",
          detail: "Arbitrary gh commands are not part of the TeaCode GitHub runtime.",
        }),
      ),
    listOpenPullRequests: (input) => listPullRequests(input, "open"),
    listPullRequests: (input) => listPullRequests(input, "all"),
    getPullRequest,
    getPullRequestWithChecks,
    getPullRequestReviewComments,
    getRepositoryCloneUrls,
    createPullRequest: (input) =>
      Effect.gen(function* () {
        const repository = yield* repositoryForCwd(input.cwd);
        const body = yield* fileSystem.readFileString(input.bodyFile).pipe(
          Effect.mapError(
            (cause) =>
              new GitHubCliError({
                operation: "createPullRequest",
                detail: "Could not read the pull request body.",
                cause,
              }),
          ),
        );
        yield* api.requestJson({
          host: repository.host,
          method: "POST",
          path: `/repos/${repository.owner}/${repository.repo}/pulls`,
          body: {
            title: input.title,
            body,
            base: input.baseBranch,
            head: input.headSelector,
          },
        });
      }),
    getDefaultBranch: (input) =>
      Effect.gen(function* () {
        const repository = yield* repositoryForCwd(input.cwd);
        const raw = asRecord(
          yield* api.requestJson({
            host: repository.host,
            path: `/repos/${repository.owner}/${repository.repo}`,
            cacheTtlMs: 5 * 60_000,
          }),
        );
        return stringValue(raw.default_branch);
      }),
    checkoutPullRequest: (input) =>
      Effect.gen(function* () {
        const pullRequest = yield* getPullRequest(input);
        yield* git.fetchPullRequestBranch({
          cwd: input.cwd,
          prNumber: pullRequest.number,
          branch: pullRequest.headRefName,
        });
        yield* git.execute({
          operation: "GitHubApi.checkoutPullRequest",
          cwd: input.cwd,
          args: ["checkout", ...(input.force ? ["--force"] : []), pullRequest.headRefName],
        });
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof GitHubCliError
            ? cause
            : new GitHubCliError({
                operation: "checkoutPullRequest",
                detail: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
        ),
      ),
  };

  return GitHubCli.of(service);
});

export const GitHubApiLive = Layer.effect(GitHubCli, makeGitHubApi);
