import type {
  GitHubActor,
  GitHubCheck,
  GitHubCheckStatus,
  GitHubLabel,
  GitHubRepositorySummary,
  GitHubTimelineEntry,
  GitHubWorkItemDetail,
  GitHubWorkItemKind,
  GitHubWorkItemState,
  GitHubWorkItemSummary,
  GitHubWorkListInput,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { GitHubCliError } from "../../git/Errors";
import { GitCore } from "../../git/Services/GitCore";
import { GitHubApiClient } from "../Services/GitHubApiClient";
import {
  parseGitHubRepositoryName,
  parseGitHubRepositoryRemote,
  repositorySummary,
  type GitHubRepositoryRef,
} from "../repository";
import { GitHubWorkbench, type GitHubWorkbenchShape } from "../Services/GitHubWorkbench";

const MAX_DIFF_BYTES = 8 * 1024 * 1024;

const PULL_REQUEST_DETAIL_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id number title url state isDraft body createdAt updatedAt additions deletions changedFiles
      baseRefName headRefName headRefOid mergeable mergeStateStatus reviewDecision
      author { login avatarUrl }
      assignees(first: 50) { nodes { login avatarUrl } }
      labels(first: 50) { nodes { name color description } }
      milestone { title number }
      reviewRequests(first: 50) {
        nodes { requestedReviewer { ... on User { login avatarUrl } ... on Team { login: slug avatarUrl } } }
      }
      latestReviews(first: 50) { nodes { id state body submittedAt url author { login avatarUrl } } }
      reviews(first: 50) { nodes { id state body submittedAt url author { login avatarUrl } } }
      comments(first: 50) { nodes { id body createdAt url author { login avatarUrl } } }
      commits(first: 50) {
        nodes {
          commit {
            oid messageHeadline messageBody committedDate authoredDate
            authors(first: 10) { nodes { user { login avatarUrl } } }
          }
        }
      }
      headCommit: commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  ... on CheckRun { name status conclusion detailsUrl startedAt completedAt }
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

const ISSUE_DETAIL_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id number title url state stateReason body createdAt updatedAt closedAt
      author { login avatarUrl }
      assignees(first: 50) { nodes { login avatarUrl } }
      labels(first: 50) { nodes { name color description } }
      milestone { title number }
      comments(first: 50) { nodes { id body createdAt url author { login avatarUrl } } }
      closedByPullRequestsReferences(first: 20) {
        nodes { number title url state mergedAt isDraft createdAt updatedAt author { login avatarUrl } }
      }
    }
  }
}`;

const PULL_REQUEST_NODE_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { id headRefName headRepository { nameWithOwner } }
  }
}`;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const number = numberValue(value);
  return number !== null && number > 0 ? number : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function actorFrom(value: unknown): GitHubActor | null {
  const record = asRecord(value);
  const login = stringValue(record.login);
  if (!login) return null;
  return {
    login,
    avatarUrl: stringValue(record.avatarUrl),
    isBot: record.is_bot === true || record.isBot === true || /\[bot\]$/i.test(login),
  };
}

function actorsFrom(value: unknown): GitHubActor[] {
  return arrayValue(value).flatMap((entry) => {
    const actor = actorFrom(entry);
    return actor ? [actor] : [];
  });
}

function labelsFrom(value: unknown): GitHubLabel[] {
  return arrayValue(value).flatMap((entry) => {
    const label = asRecord(entry);
    const name = stringValue(label.name);
    if (!name) return [];
    return [
      {
        name,
        color: stringValue(label.color),
        description: typeof label.description === "string" ? label.description : null,
      },
    ];
  });
}

function repositoryFrom(value: unknown, fallback?: string): GitHubRepositorySummary | null {
  const record = asRecord(value);
  const nameWithOwner =
    stringValue(record.nameWithOwner) ?? stringValue(record.full_name) ?? fallback ?? null;
  if (!nameWithOwner) return null;
  const name = stringValue(record.name) ?? nameWithOwner.split("/").at(-1) ?? nameWithOwner;
  return {
    nameWithOwner,
    name,
    url:
      stringValue(record.url) ??
      stringValue(record.html_url) ??
      `https://github.com/${nameWithOwner}`,
  };
}

function stateFrom(value: unknown, mergedAt?: unknown): GitHubWorkItemState {
  if (stringValue(mergedAt) || value === "MERGED" || value === "merged") return "merged";
  if (value === "CLOSED" || value === "closed") return "closed";
  return "open";
}

function checkStatusFromRaw(value: unknown): GitHubCheckStatus {
  const record = asRecord(value);
  const status = stringValue(record.status)?.toUpperCase();
  const conclusion = stringValue(record.conclusion)?.toUpperCase();
  const state = stringValue(record.state)?.toUpperCase();
  if (status !== "COMPLETED" && !conclusion && state !== "SUCCESS" && state !== "FAILURE") {
    return "pending";
  }
  switch (conclusion ?? state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failure";
    case "SKIPPED":
      return "skipped";
    case "NEUTRAL":
    case "STALE":
      return "neutral";
    case "CANCELLED":
      return "cancelled";
    default:
      return "pending";
  }
}

function aggregateCheckStatus(checks: readonly GitHubCheck[]): GitHubCheckStatus | null {
  if (checks.length === 0) return null;
  if (checks.some((check) => check.status === "failure")) return "failure";
  if (checks.some((check) => check.status === "pending")) return "pending";
  if (checks.every((check) => check.status === "success" || check.status === "skipped")) {
    return "success";
  }
  return checks[0]?.status ?? null;
}

function checksFrom(value: unknown): GitHubCheck[] {
  return arrayValue(value).flatMap((entry) => {
    const check = asRecord(entry);
    const name = stringValue(check.name) ?? stringValue(check.context);
    if (!name) return [];
    const url = stringValue(check.detailsUrl) ?? stringValue(check.targetUrl);
    const runIdMatch = url?.match(/\/actions\/runs\/(\d+)/);
    return [
      {
        name,
        workflow: stringValue(check.workflowName),
        status: checkStatusFromRaw(check),
        url,
        runId: runIdMatch ? positiveNumber(Number(runIdMatch[1])) : null,
        startedAt: stringValue(check.startedAt),
        completedAt: stringValue(check.completedAt),
      },
    ];
  });
}

function summaryFromSearch(value: unknown, kind: GitHubWorkItemKind): GitHubWorkItemSummary | null {
  const record = asRecord(value);
  const repository = repositoryFrom(record.repository);
  const number = positiveNumber(record.number);
  const title = stringValue(record.title);
  const url = stringValue(record.url);
  const updatedAt = stringValue(record.updatedAt);
  if (!repository || !number || !title || !url || !updatedAt) return null;
  return {
    id: `${kind}:${repository.nameWithOwner}:${number}`,
    kind,
    repository,
    number,
    title,
    url,
    state: stateFrom(record.state, record.mergedAt),
    isDraft: record.isDraft === true,
    author: actorFrom(record.author),
    labels: labelsFrom(record.labels),
    assignees: actorsFrom(record.assignees),
    commentsCount: numberValue(record.commentsCount) ?? 0,
    additions: numberValue(record.additions),
    deletions: numberValue(record.deletions),
    changedFiles: numberValue(record.changedFiles),
    reviewDecision: stringValue(record.reviewDecision),
    checkStatus: null,
    createdAt: stringValue(record.createdAt),
    updatedAt,
  };
}

function summaryFromDetail(
  raw: JsonRecord,
  input: { kind: GitHubWorkItemKind; repository: string; number: number },
  checks: readonly GitHubCheck[],
): GitHubWorkItemSummary {
  const repository = repositoryFrom({}, input.repository)!;
  const title = stringValue(raw.title) ?? `#${input.number}`;
  const url =
    stringValue(raw.url) ??
    `${repository.url}/${input.kind === "pull_request" ? "pull" : "issues"}/${input.number}`;
  return {
    id: `${input.kind}:${input.repository}:${input.number}`,
    kind: input.kind,
    repository,
    number: positiveNumber(raw.number) ?? input.number,
    title,
    url,
    state: stateFrom(raw.state, raw.mergedAt),
    isDraft: raw.isDraft === true,
    author: actorFrom(raw.author),
    labels: labelsFrom(raw.labels),
    assignees: actorsFrom(raw.assignees),
    commentsCount: arrayValue(raw.comments).length,
    additions: numberValue(raw.additions),
    deletions: numberValue(raw.deletions),
    changedFiles: numberValue(raw.changedFiles),
    reviewDecision: stringValue(raw.reviewDecision),
    checkStatus: aggregateCheckStatus(checks),
    createdAt: stringValue(raw.createdAt),
    updatedAt: stringValue(raw.updatedAt) ?? new Date().toISOString(),
  };
}

function timelineFrom(raw: JsonRecord): GitHubTimelineEntry[] {
  const comments = arrayValue(raw.comments).flatMap((value, index) => {
    const comment = asRecord(value);
    const createdAt = stringValue(comment.createdAt);
    if (!createdAt) return [];
    return [
      {
        id: stringValue(comment.id) ?? `comment:${index}:${createdAt}`,
        type: "comment" as const,
        author: actorFrom(comment.author),
        body: typeof comment.body === "string" ? comment.body : null,
        title: null,
        state: null,
        createdAt,
        url: stringValue(comment.url),
      },
    ];
  });
  const reviews = arrayValue(raw.reviews ?? raw.latestReviews).flatMap((value, index) => {
    const review = asRecord(value);
    const createdAt = stringValue(review.submittedAt) ?? stringValue(review.createdAt);
    if (!createdAt) return [];
    return [
      {
        id: stringValue(review.id) ?? `review:${index}:${createdAt}`,
        type: "review" as const,
        author: actorFrom(review.author),
        body: typeof review.body === "string" ? review.body : null,
        title: null,
        state: stringValue(review.state),
        createdAt,
        url: stringValue(review.url),
      },
    ];
  });
  const commits = arrayValue(raw.commits).flatMap((value, index) => {
    const commit = asRecord(value);
    const createdAt = stringValue(commit.committedDate) ?? stringValue(commit.authoredDate);
    if (!createdAt) return [];
    const authors = actorsFrom(commit.authors);
    return [
      {
        id: stringValue(commit.oid) ?? `commit:${index}:${createdAt}`,
        type: "commit" as const,
        author: authors[0] ?? null,
        body: stringValue(commit.messageBody),
        title: stringValue(commit.messageHeadline),
        state: null,
        createdAt,
        url: null,
      },
    ];
  });
  return [...comments, ...reviews, ...commits].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function reviewersFrom(raw: JsonRecord): GitHubWorkItemDetail["reviewers"] {
  const latest = arrayValue(raw.latestReviews).flatMap((value) => {
    const review = asRecord(value);
    const actor = actorFrom(review.author);
    return actor ? [{ actor, state: stringValue(review.state) }] : [];
  });
  const requested = arrayValue(raw.reviewRequests).flatMap((value) => {
    const request = asRecord(value);
    const actor = actorFrom(request);
    return actor ? [{ actor, state: "REQUESTED" }] : [];
  });
  const byLogin = new Map<string, (typeof latest)[number]>();
  for (const reviewer of [...requested, ...latest]) byLogin.set(reviewer.actor.login, reviewer);
  return [...byLogin.values()];
}

function linkedPullRequestsFrom(raw: JsonRecord, repository: string): GitHubWorkItemSummary[] {
  return arrayValue(raw.closedByPullRequestsReferences).flatMap((value) => {
    const record = asRecord(value);
    const number = positiveNumber(record.number);
    const title = stringValue(record.title);
    const url = stringValue(record.url);
    const updatedAt = stringValue(record.updatedAt) ?? stringValue(record.closedAt);
    if (!number || !title || !url || !updatedAt) return [];
    const normalized = summaryFromSearch(
      {
        ...record,
        repository: { nameWithOwner: repository },
        number,
        title,
        url,
        updatedAt,
      },
      "pull_request",
    );
    return normalized ? [normalized] : [];
  });
}

function connectionNodes(value: unknown): unknown[] {
  return arrayValue(asRecord(value).nodes);
}

function graphQlErrors(value: unknown): string | null {
  const messages = arrayValue(asRecord(value).errors)
    .map((error) => stringValue(asRecord(error).message))
    .filter((message): message is string => message !== null);
  return messages.length > 0 ? messages.join("; ") : null;
}

function repositoryFromApiUrl(value: unknown): GitHubRepositoryRef | null {
  const url = stringValue(value);
  if (!url) return null;
  const match = /^https?:\/\/([^/]+)\/(?:api\/v3\/)?repos\/([^/]+)\/([^/]+)/i.exec(url);
  return match
    ? {
        host: match[1] === "api.github.com" ? "github.com" : match[1]!,
        owner: match[2]!,
        repo: match[3]!,
      }
    : null;
}

function restActor(value: unknown): unknown {
  const actor = asRecord(value);
  return {
    login: actor.login,
    avatarUrl: actor.avatar_url,
    isBot: actor.type === "Bot",
  };
}

function restSearchEntry(value: unknown, fallbackRepository: GitHubRepositoryRef | null): unknown {
  const raw = asRecord(value);
  const repository = repositoryFromApiUrl(raw.repository_url) ?? fallbackRepository;
  return {
    ...raw,
    url: raw.html_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at,
    commentsCount: raw.comments,
    isDraft: raw.draft,
    author: restActor(raw.user),
    assignees: arrayValue(raw.assignees).map(restActor),
    repository: repository ? repositorySummary(repository) : null,
  };
}

function detailNode(value: unknown, kind: GitHubWorkItemKind): JsonRecord {
  const response = asRecord(value);
  const data = asRecord(response.data);
  const repository = asRecord(data.repository);
  return asRecord(kind === "pull_request" ? repository.pullRequest : repository.issue);
}

function normalizeDetailNode(node: JsonRecord, kind: GitHubWorkItemKind): JsonRecord {
  const comments = connectionNodes(node.comments);
  const assignees = connectionNodes(node.assignees);
  const labels = connectionNodes(node.labels);
  if (kind === "issue") {
    return {
      ...node,
      comments,
      assignees,
      labels,
      closedByPullRequestsReferences: connectionNodes(node.closedByPullRequestsReferences),
    };
  }

  const commits = connectionNodes(node.commits).map((entry) => {
    const commit = asRecord(asRecord(entry).commit);
    return {
      ...commit,
      authors: connectionNodes(commit.authors).map((author) => asRecord(author).user),
    };
  });
  const headCommit = asRecord(asRecord(connectionNodes(node.headCommit)[0]).commit);
  const checks = connectionNodes(asRecord(headCommit.statusCheckRollup).contexts);
  return {
    ...node,
    comments,
    assignees,
    labels,
    latestReviews: connectionNodes(node.latestReviews),
    reviews: connectionNodes(node.reviews),
    reviewRequests: connectionNodes(node.reviewRequests).map(
      (request) => asRecord(request).requestedReviewer,
    ),
    commits,
    statusCheckRollup: checks,
  };
}

function searchQuery(input: GitHubWorkListInput): string {
  const qualifiers = [
    input.query?.trim() ?? "",
    input.kind === "pull_request" ? "is:pr" : "is:issue",
    "is:open",
    "archived:false",
  ];
  switch (input.view) {
    case "reviewing":
      qualifiers.push(input.kind === "pull_request" ? "review-requested:@me" : "involves:@me");
      break;
    case "authored":
      qualifiers.push("author:@me");
      break;
    case "assigned":
      qualifiers.push("assignee:@me");
      break;
    case "mentioned":
      qualifiers.push("mentions:@me");
      break;
    case "participating":
      qualifiers.push("involves:@me");
      break;
    case "all":
      break;
  }
  if (input.repository) qualifiers.push(`repo:${input.repository}`);
  return qualifiers.filter(Boolean).join(" ");
}

export const GitHubWorkbenchLive = Layer.effect(
  GitHubWorkbench,
  Effect.gen(function* () {
    const api = yield* GitHubApiClient;
    const git = yield* GitCore;

    const repositoryForCwd = (cwd: string | null) =>
      cwd
        ? git.readConfigValue(cwd, "remote.origin.url").pipe(
            Effect.map(parseGitHubRepositoryRemote),
            Effect.catch(() => Effect.succeed(null)),
          )
        : Effect.succeed(null);

    const requireRepository = (nameWithOwner: string, cwd: string | null) => {
      const repository = parseGitHubRepositoryName(nameWithOwner);
      if (!repository) {
        return Effect.fail(
          new GitHubCliError({
            operation: "repository",
            detail: `Invalid GitHub repository '${nameWithOwner}'.`,
          }),
        );
      }
      return repositoryForCwd(cwd).pipe(
        Effect.map((local) =>
          local && `${local.owner}/${local.repo}`.toLowerCase() === nameWithOwner.toLowerCase()
            ? local
            : repository,
        ),
      );
    };

    const pullRequestNode = (repository: GitHubRepositoryRef, number: number) =>
      api
        .graphql({
          host: repository.host,
          query: PULL_REQUEST_NODE_QUERY,
          variables: { owner: repository.owner, repo: repository.repo, number },
        })
        .pipe(
          Effect.flatMap((response) => {
            const errors = graphQlErrors(response);
            if (errors) {
              return Effect.fail(
                new GitHubCliError({ operation: "pullRequestNode", detail: errors }),
              );
            }
            const node = asRecord(
              asRecord(asRecord(asRecord(response).data).repository).pullRequest,
            );
            const id = stringValue(node.id);
            return id
              ? Effect.succeed(node)
              : Effect.fail(
                  new GitHubCliError({
                    operation: "pullRequestNode",
                    detail: `Pull request #${number} was not found.`,
                  }),
                );
          }),
        );

    const connection: GitHubWorkbenchShape["connection"] = (input) =>
      Effect.gen(function* () {
        const localRepository = yield* repositoryForCwd(input.cwd);
        const host = localRepository?.host ?? "github.com";
        const viewer = yield* api.viewer(host);
        const repository = localRepository
          ? yield* api
              .requestJson({
                host,
                path: `/repos/${localRepository.owner}/${localRepository.repo}`,
                cacheTtlMs: 5 * 60_000,
              })
              .pipe(
                Effect.map((value) =>
                  repositoryFrom(value, `${localRepository.owner}/${localRepository.repo}`),
                ),
                Effect.catch(() => Effect.succeed(repositorySummary(localRepository))),
              )
          : null;
        return {
          available: true,
          authenticated: true,
          account: viewer.login,
          host,
          version: "GitHub API 2022-11-28",
          repository,
          error: null,
        };
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            available: true,
            authenticated: false,
            account: null,
            host: null,
            version: "GitHub API 2022-11-28",
            repository: null,
            error: error.detail,
          }),
        ),
      );

    const listWork: GitHubWorkbenchShape["listWork"] = (input) =>
      Effect.gen(function* () {
        const localRepository = yield* repositoryForCwd(input.cwd);
        const fallbackRepository = input.repository
          ? parseGitHubRepositoryName(input.repository)
          : localRepository;
        const host = localRepository?.host ?? fallbackRepository?.host ?? "github.com";
        const raw = asRecord(
          yield* api.requestJson({
            host,
            path: "/search/issues",
            query: {
              q: searchQuery(input),
              per_page: input.limit,
              sort: "updated",
              order: "desc",
            },
            cacheTtlMs: 60_000,
          }),
        );
        const items = arrayValue(raw.items).flatMap((entry) => {
          const item = summaryFromSearch(restSearchEntry(entry, fallbackRepository), input.kind);
          return item ? [item] : [];
        });
        return {
          items,
          totalCount: numberValue(raw.total_count) ?? items.length,
          syncedAt: new Date().toISOString(),
        };
      });

    const workItemDetail: GitHubWorkbenchShape["workItemDetail"] = (input) =>
      Effect.gen(function* () {
        const repository = yield* requireRepository(input.repository, input.cwd);
        const response = yield* api.graphql({
          host: repository.host,
          query: input.kind === "pull_request" ? PULL_REQUEST_DETAIL_QUERY : ISSUE_DETAIL_QUERY,
          variables: { owner: repository.owner, repo: repository.repo, number: input.number },
          cacheTtlMs: 30_000,
        });
        const errors = graphQlErrors(response);
        if (errors) {
          return yield* Effect.fail(
            new GitHubCliError({ operation: "workItemDetail", detail: errors }),
          );
        }
        const raw = normalizeDetailNode(detailNode(response, input.kind), input.kind);
        const checks = checksFrom(raw.statusCheckRollup);
        const detail: GitHubWorkItemDetail = {
          item: summaryFromDetail(raw, input, checks),
          body: typeof raw.body === "string" ? raw.body : "",
          headBranch: stringValue(raw.headRefName),
          baseBranch: stringValue(raw.baseRefName),
          headSha: stringValue(raw.headRefOid),
          mergeability: stringValue(raw.mergeable)?.toLowerCase() ?? null,
          mergeStateStatus: stringValue(raw.mergeStateStatus)?.toLowerCase() ?? null,
          milestone: (() => {
            const milestone = asRecord(raw.milestone);
            const title = stringValue(milestone.title);
            return title ? { title, number: positiveNumber(milestone.number) } : null;
          })(),
          reviewers: reviewersFrom(raw),
          checks,
          timeline: timelineFrom(raw),
          linkedPullRequests: linkedPullRequestsFrom(raw, input.repository),
        };
        return { detail, syncedAt: new Date().toISOString() };
      });

    const pullRequestDiff: GitHubWorkbenchShape["pullRequestDiff"] = (input) =>
      Effect.gen(function* () {
        const repository = yield* requireRepository(input.repository, input.cwd);
        const response = yield* api.requestText({
          host: repository.host,
          path: `/repos/${repository.owner}/${repository.repo}/pulls/${input.number}`,
          accept: "application/vnd.github.v3.diff",
          cacheTtlMs: 5 * 60_000,
          maxBytes: MAX_DIFF_BYTES,
        });
        return { patch: response.body, truncated: response.truncated };
      });

    const workItemAction: GitHubWorkbenchShape["workItemAction"] = (input) =>
      Effect.gen(function* () {
        const repository = yield* requireRepository(input.repository, input.cwd);
        const issuePath = `/repos/${repository.owner}/${repository.repo}/issues`;
        const pullPath = `/repos/${repository.owner}/${repository.repo}/pulls`;
        let message: string;
        let url: string | null = null;

        switch (input.action) {
          case "create_issue": {
            const viewer = input.assignees.includes("@me")
              ? yield* api.viewer(repository.host)
              : null;
            const created = asRecord(
              yield* api.requestJson({
                host: repository.host,
                method: "POST",
                path: issuePath,
                body: {
                  title: input.title,
                  body: input.body,
                  labels: input.labels,
                  assignees: input.assignees.map((assignee) =>
                    assignee === "@me" ? viewer!.login : assignee,
                  ),
                },
              }),
            );
            message = "Issue created.";
            url = stringValue(created.html_url);
            break;
          }
          case "comment":
            yield* api.requestJson({
              host: repository.host,
              method: "POST",
              path: `${issuePath}/${input.number}/comments`,
              body: { body: input.body },
            });
            message = "Comment posted.";
            break;
          case "set_state":
            yield* api.requestJson({
              host: repository.host,
              method: "PATCH",
              path: `${input.kind === "pull_request" ? pullPath : issuePath}/${input.number}`,
              body: {
                state: input.state,
                ...(input.kind === "issue" && input.state === "closed" && input.closeReason
                  ? { state_reason: input.closeReason.replace(" ", "_") }
                  : {}),
              },
            });
            message = input.state === "open" ? "Item reopened." : "Item closed.";
            break;
          case "assign_self": {
            const viewer = yield* api.viewer(repository.host);
            yield* api.requestJson({
              host: repository.host,
              method: input.assigned ? "POST" : "DELETE",
              path: `${issuePath}/${input.number}/assignees`,
              body: { assignees: [viewer.login] },
            });
            message = input.assigned ? "Assigned to you." : "Unassigned from you.";
            break;
          }
          case "set_labels":
            if (input.add.length > 0) {
              yield* api.requestJson({
                host: repository.host,
                method: "POST",
                path: `${issuePath}/${input.number}/labels`,
                body: { labels: input.add },
              });
            }
            for (const label of input.remove) {
              yield* api.requestJson({
                host: repository.host,
                method: "DELETE",
                path: `${issuePath}/${input.number}/labels/${encodeURIComponent(label)}`,
              });
            }
            message = "Labels updated.";
            break;
          case "review":
            yield* api.requestJson({
              host: repository.host,
              method: "POST",
              path: `${pullPath}/${input.number}/reviews`,
              body: {
                body: input.body,
                event:
                  input.verdict === "approve"
                    ? "APPROVE"
                    : input.verdict === "request_changes"
                      ? "REQUEST_CHANGES"
                      : "COMMENT",
              },
            });
            message = "Review submitted.";
            break;
          case "ready": {
            const node = yield* pullRequestNode(repository, input.number);
            const response = yield* api.graphql({
              host: repository.host,
              query: `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }`,
              variables: { id: node.id },
            });
            const errors = graphQlErrors(response);
            if (errors) {
              return yield* Effect.fail(new GitHubCliError({ operation: "ready", detail: errors }));
            }
            message = "Pull request marked ready.";
            break;
          }
          case "update_branch":
            yield* api.requestJson({
              host: repository.host,
              method: "PUT",
              path: `${pullPath}/${input.number}/update-branch`,
            });
            message = "Pull request branch update started.";
            break;
          case "merge": {
            const node = yield* pullRequestNode(repository, input.number);
            if (input.auto) {
              const response = yield* api.graphql({
                host: repository.host,
                query: `mutation($id: ID!, $method: PullRequestMergeMethod!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { pullRequest { id } } }`,
                variables: { id: node.id, method: input.method.toUpperCase() },
              });
              const errors = graphQlErrors(response);
              if (errors) {
                return yield* Effect.fail(
                  new GitHubCliError({ operation: "merge", detail: errors }),
                );
              }
              message = "Auto-merge enabled.";
            } else {
              yield* api.requestJson({
                host: repository.host,
                method: "PUT",
                path: `${pullPath}/${input.number}/merge`,
                body: { merge_method: input.method, sha: input.expectedHeadSha },
              });
              message = "Pull request merged.";
              if (
                input.deleteBranch &&
                stringValue(asRecord(node.headRepository).nameWithOwner)?.toLowerCase() ===
                  input.repository.toLowerCase()
              ) {
                const headRefName = stringValue(node.headRefName);
                if (headRefName) {
                  yield* api.requestJson({
                    host: repository.host,
                    method: "DELETE",
                    path: `/repos/${repository.owner}/${repository.repo}/git/refs/heads/${headRefName
                      .split("/")
                      .map(encodeURIComponent)
                      .join("/")}`,
                  });
                }
              }
            }
            break;
          }
          case "rerun_checks":
            yield* api.requestJson({
              host: repository.host,
              method: "POST",
              path: `/repos/${repository.owner}/${repository.repo}/actions/runs/${input.runId}/${
                input.failedOnly ? "rerun-failed-jobs" : "rerun"
              }`,
            });
            message = "Workflow rerun started.";
            break;
        }

        return {
          ok: true,
          message,
          url:
            url ??
            ("number" in input
              ? `https://${repository.host}/${input.repository}/${input.kind === "pull_request" ? "pull" : "issues"}/${input.number}`
              : null),
        };
      });

    return GitHubWorkbench.of({
      connection,
      listWork,
      workItemDetail,
      pullRequestDiff,
      workItemAction,
    });
  }),
);
