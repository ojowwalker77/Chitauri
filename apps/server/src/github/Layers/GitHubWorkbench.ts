import type {
  GitHubActor,
  GitHubCheck,
  GitHubCheckStatus,
  GitHubLabel,
  GitHubRepositorySummary,
  GitHubTimelineEntry,
  GitHubWorkItemActionInput,
  GitHubWorkItemDetail,
  GitHubWorkItemKind,
  GitHubWorkItemState,
  GitHubWorkItemSummary,
  GitHubWorkListInput,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { GitHubCliError } from "../../git/Errors";
import { GitHubCli } from "../../git/Services/GitHubCli";
import { GitHubWorkbench, type GitHubWorkbenchShape } from "../Services/GitHubWorkbench";

const SEARCH_FIELDS =
  "assignees,author,body,closedAt,commentsCount,createdAt,id,isDraft,labels,number,repository,state,title,updatedAt,url";
const PR_DETAIL_FIELDS = [
  "additions",
  "assignees",
  "author",
  "baseRefName",
  "body",
  "changedFiles",
  "comments",
  "commits",
  "createdAt",
  "deletions",
  "headRefName",
  "headRefOid",
  "isDraft",
  "labels",
  "latestReviews",
  "mergeStateStatus",
  "mergeable",
  "milestone",
  "number",
  "reviewDecision",
  "reviewRequests",
  "reviews",
  "state",
  "statusCheckRollup",
  "title",
  "updatedAt",
  "url",
].join(",");
const ISSUE_DETAIL_FIELDS = [
  "assignees",
  "author",
  "body",
  "closedAt",
  "closedByPullRequestsReferences",
  "comments",
  "createdAt",
  "labels",
  "milestone",
  "number",
  "state",
  "stateReason",
  "title",
  "updatedAt",
  "url",
].join(",");
const MAX_DIFF_BYTES = 8 * 1024 * 1024;

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

function parseJson(raw: string, operation: string): Effect.Effect<unknown, GitHubCliError> {
  return Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) =>
      new GitHubCliError({
        operation,
        detail: "GitHub CLI returned invalid JSON.",
        cause,
      }),
  });
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
    notificationId: null,
    kind,
    repository,
    number,
    title,
    url,
    state: stateFrom(record.state, record.mergedAt),
    isDraft: record.isDraft === true,
    unread: false,
    reason: null,
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

function notificationSummary(value: unknown): GitHubWorkItemSummary | null {
  const record = asRecord(value);
  const subject = asRecord(record.subject);
  const repository = repositoryFrom(record.repository);
  const apiUrl = stringValue(subject.url);
  const match = apiUrl?.match(/\/repos\/([^/]+)\/([^/]+)\/(pulls|issues)\/(\d+)/);
  const notificationId = stringValue(record.id);
  const title = stringValue(subject.title);
  const updatedAt = stringValue(record.updated_at);
  if (!repository || !match || !notificationId || !title || !updatedAt) return null;
  const kind: GitHubWorkItemKind = match[3] === "pulls" ? "pull_request" : "issue";
  const number = Number(match[4]);
  const webSegment = kind === "pull_request" ? "pull" : "issues";
  return {
    id: `${kind}:${repository.nameWithOwner}:${number}`,
    notificationId,
    kind,
    repository,
    number,
    title,
    url: `${repository.url}/${webSegment}/${number}`,
    state: "open",
    isDraft: false,
    unread: record.unread !== false,
    reason: stringValue(record.reason),
    author: null,
    labels: [],
    assignees: [],
    commentsCount: 0,
    additions: null,
    deletions: null,
    changedFiles: null,
    reviewDecision: null,
    checkStatus: null,
    createdAt: null,
    updatedAt,
  };
}

function searchArgs(input: GitHubWorkListInput): string[] {
  const kind = input.kind === "issue" ? "issues" : "prs";
  const args = ["search", kind];
  if (input.query?.trim()) args.push(input.query.trim());
  args.push("--state", "open", "--archived=false");
  switch (input.view) {
    case "reviewing":
      if (kind === "prs") args.push("--review-requested", "@me");
      else args.push("--involves", "@me");
      break;
    case "authored":
      args.push("--author", "@me");
      break;
    case "assigned":
      args.push("--assignee", "@me");
      break;
    case "mentioned":
      args.push("--mentions", "@me");
      break;
    case "participating":
      args.push("--involves", "@me");
      break;
    case "attention":
      args.push(kind === "prs" ? "--review-requested" : "--assignee", "@me");
      break;
    case "all":
      break;
  }
  if (input.repository) args.push("--repo", input.repository);
  args.push(
    "--limit",
    String(input.limit),
    "--sort",
    "updated",
    "--order",
    "desc",
    "--json",
    SEARCH_FIELDS,
  );
  return args;
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
    notificationId: null,
    kind: input.kind,
    repository,
    number: positiveNumber(raw.number) ?? input.number,
    title,
    url,
    state: stateFrom(raw.state, raw.mergedAt),
    isDraft: raw.isDraft === true,
    unread: false,
    reason: null,
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

function targetArgs(input: { repository: string; number: number }): string[] {
  return [String(input.number), "--repo", input.repository];
}

function actionCommand(input: GitHubWorkItemActionInput): {
  args: string[];
  stdin?: string;
  message: string;
} {
  if (input.action === "mark_notification") {
    return {
      args: [
        "api",
        `notifications/threads/${input.notificationId}`,
        "--method",
        input.mode === "done" ? "DELETE" : "PATCH",
      ],
      message: input.mode === "done" ? "Notification marked done." : "Notification marked read.",
    };
  }
  if (input.action === "create_issue") {
    const args = [
      "issue",
      "create",
      "--repo",
      input.repository,
      "--title",
      input.title,
      "--body-file",
      "-",
    ];
    for (const label of input.labels) args.push("--label", label);
    for (const assignee of input.assignees) args.push("--assignee", assignee);
    return { args, stdin: input.body, message: "Issue created." };
  }
  const noun = input.kind === "pull_request" ? "pr" : "issue";
  const target = targetArgs(input);
  switch (input.action) {
    case "comment":
      return {
        args: [noun, "comment", ...target, "--body-file", "-"],
        stdin: input.body,
        message: "Comment posted.",
      };
    case "set_state":
      if (input.state === "open") {
        return { args: [noun, "reopen", ...target], message: "Item reopened." };
      }
      return {
        args: [
          noun,
          "close",
          ...target,
          ...(input.kind === "issue" && input.closeReason ? ["--reason", input.closeReason] : []),
        ],
        message: "Item closed.",
      };
    case "assign_self":
      return {
        args: [
          noun,
          "edit",
          ...target,
          input.assigned ? "--add-assignee" : "--remove-assignee",
          "@me",
        ],
        message: input.assigned ? "Assigned to you." : "Unassigned from you.",
      };
    case "set_labels": {
      const args = [noun, "edit", ...target];
      for (const label of input.add) args.push("--add-label", label);
      for (const label of input.remove) args.push("--remove-label", label);
      return { args, message: "Labels updated." };
    }
    case "review":
      return {
        args: [
          "pr",
          "review",
          ...target,
          input.verdict === "approve"
            ? "--approve"
            : input.verdict === "request_changes"
              ? "--request-changes"
              : "--comment",
          "--body-file",
          "-",
        ],
        stdin: input.body,
        message: "Review submitted.",
      };
    case "ready":
      return { args: ["pr", "ready", ...target], message: "Pull request marked ready." };
    case "update_branch":
      return {
        args: ["pr", "update-branch", ...target],
        message: "Pull request branch update started.",
      };
    case "merge":
      return {
        args: [
          "pr",
          "merge",
          ...target,
          `--${input.method}`,
          "--match-head-commit",
          input.expectedHeadSha,
          ...(input.deleteBranch ? ["--delete-branch"] : []),
          ...(input.auto ? ["--auto"] : []),
        ],
        message: input.auto ? "Auto-merge enabled." : "Pull request merged.",
      };
    case "rerun_checks":
      return {
        args: [
          "run",
          "rerun",
          String(input.runId),
          "--repo",
          input.repository,
          ...(input.failedOnly ? ["--failed"] : []),
        ],
        message: "Workflow rerun started.",
      };
  }
}

export const GitHubWorkbenchLive = Layer.effect(
  GitHubWorkbench,
  Effect.gen(function* () {
    const cli = yield* GitHubCli;
    const cwdFor = (cwd: string | null): string => cwd ?? process.cwd();

    const connection: GitHubWorkbenchShape["connection"] = (input) =>
      cli.execute({ cwd: cwdFor(input.cwd), args: ["--version"] }).pipe(
        Effect.flatMap((versionResult) =>
          cli
            .execute({
              cwd: cwdFor(input.cwd),
              args: ["auth", "status", "--active", "--json", "hosts"],
            })
            .pipe(
              Effect.flatMap((authResult) =>
                parseJson(authResult.stdout, "connection.auth").pipe(
                  Effect.flatMap((authValue) => {
                    const hosts = asRecord(asRecord(authValue).hosts);
                    const active = Object.values(hosts)
                      .flatMap(arrayValue)
                      .map(asRecord)
                      .find((entry) => entry.active === true && entry.state === "success");
                    const account = stringValue(active?.login);
                    const host = stringValue(active?.host);
                    return input.cwd
                      ? cli
                          .execute({
                            cwd: input.cwd,
                            args: ["repo", "view", "--json", "name,nameWithOwner,url"],
                          })
                          .pipe(
                            Effect.flatMap((repoResult) =>
                              parseJson(repoResult.stdout, "connection.repository"),
                            ),
                            Effect.map((repoValue) => repositoryFrom(repoValue)),
                            Effect.catch(() => Effect.succeed(null)),
                            Effect.map((repository) => ({
                              available: true,
                              authenticated: account !== null,
                              account,
                              host,
                              version: versionResult.stdout.split("\n")[0]?.trim() || null,
                              repository,
                              error: account ? null : "GitHub CLI is not authenticated.",
                            })),
                          )
                      : Effect.succeed({
                          available: true,
                          authenticated: account !== null,
                          account,
                          host,
                          version: versionResult.stdout.split("\n")[0]?.trim() || null,
                          repository: null,
                          error: account ? null : "GitHub CLI is not authenticated.",
                        });
                  }),
                ),
              ),
            ),
        ),
        Effect.catch((error) =>
          Effect.succeed({
            available: !error.detail.includes("not available on PATH"),
            authenticated: false,
            account: null,
            host: null,
            version: null,
            repository: null,
            error: error.detail,
          }),
        ),
      );

    const listWork: GitHubWorkbenchShape["listWork"] = (input) => {
      const args =
        input.kind === "inbox"
          ? [
              "api",
              "notifications",
              "--method",
              "GET",
              "-f",
              "all=false",
              "-f",
              `per_page=${input.limit}`,
            ]
          : searchArgs(input);
      return cli.execute({ cwd: cwdFor(input.cwd), args }).pipe(
        Effect.flatMap((result) => parseJson(result.stdout, "listWork")),
        Effect.map((value) => {
          const items = arrayValue(value)
            .flatMap((entry) => {
              const item =
                input.kind === "inbox"
                  ? notificationSummary(entry)
                  : summaryFromSearch(entry, input.kind);
              return item ? [item] : [];
            })
            .filter(
              (item) => !input.repository || item.repository.nameWithOwner === input.repository,
            )
            .filter((item) => {
              const query = input.query?.trim().toLowerCase();
              return (
                !query ||
                `${item.repository.nameWithOwner} ${item.title} #${item.number}`
                  .toLowerCase()
                  .includes(query)
              );
            });
          return { items, totalCount: items.length, syncedAt: new Date().toISOString() };
        }),
      );
    };

    const workItemDetail: GitHubWorkbenchShape["workItemDetail"] = (input) =>
      cli
        .execute({
          cwd: cwdFor(input.cwd),
          args: [
            input.kind === "pull_request" ? "pr" : "issue",
            "view",
            String(input.number),
            "--repo",
            input.repository,
            "--json",
            input.kind === "pull_request" ? PR_DETAIL_FIELDS : ISSUE_DETAIL_FIELDS,
          ],
        })
        .pipe(
          Effect.flatMap((result) => parseJson(result.stdout, "workItemDetail")),
          Effect.map(asRecord),
          Effect.map((raw) => {
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
          }),
        );

    const pullRequestDiff: GitHubWorkbenchShape["pullRequestDiff"] = (input) =>
      cli
        .execute({
          cwd: cwdFor(input.cwd),
          args: ["pr", "diff", String(input.number), "--repo", input.repository, "--patch"],
          maxBufferBytes: MAX_DIFF_BYTES,
          outputMode: "truncate",
          timeoutMs: 60_000,
        })
        .pipe(
          Effect.map((result) => ({
            patch: result.stdout,
            truncated: result.stdoutTruncated === true,
          })),
        );

    const workItemAction: GitHubWorkbenchShape["workItemAction"] = (input) => {
      const command = actionCommand(input);
      return cli
        .execute({
          cwd: cwdFor(input.cwd),
          args: command.args,
          ...(command.stdin !== undefined ? { stdin: command.stdin } : {}),
          timeoutMs: input.action === "merge" ? 120_000 : 60_000,
        })
        .pipe(
          Effect.map((result) => ({
            ok: true,
            message: command.message,
            url:
              input.action === "create_issue"
                ? stringValue(result.stdout)
                : "repository" in input && "number" in input
                  ? `https://github.com/${input.repository}/${input.kind === "pull_request" ? "pull" : "issues"}/${input.number}`
                  : null,
          })),
        );
    };

    return GitHubWorkbench.of({
      connection,
      listWork,
      workItemDetail,
      pullRequestDiff,
      workItemAction,
    });
  }),
);
