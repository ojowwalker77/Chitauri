import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect } from "vitest";

import { GitHubCli, type GitHubCliShape } from "../../git/Services/GitHubCli";
import { GitHubWorkbench } from "../Services/GitHubWorkbench";
import { GitHubWorkbenchLive } from "./GitHubWorkbench";

function response(stdout: string) {
  return { stdout, stderr: "", code: 0, signal: null, timedOut: false } as const;
}

function makeLayer(handler: (input: Parameters<GitHubCliShape["execute"]>[0]) => string) {
  const calls: Array<Parameters<GitHubCliShape["execute"]>[0]> = [];
  const execute: GitHubCliShape["execute"] = (input) => {
    calls.push(input);
    return Effect.succeed(response(handler(input)));
  };
  const service = GitHubCli.of({
    execute,
    listOpenPullRequests: () => Effect.succeed([]),
    listPullRequests: () => Effect.succeed([]),
    getPullRequest: () => Effect.die("unused"),
    getPullRequestWithChecks: () => Effect.die("unused"),
    getPullRequestReviewComments: () => Effect.die("unused"),
    getRepositoryCloneUrls: () => Effect.die("unused"),
    createPullRequest: () => Effect.die("unused"),
    getDefaultBranch: () => Effect.die("unused"),
    checkoutPullRequest: () => Effect.die("unused"),
  });
  return {
    calls,
    layer: GitHubWorkbenchLive.pipe(Layer.provide(Layer.succeed(GitHubCli, service))),
  };
}

it.layer(
  makeLayer((input) => {
    if (input.args[0] === "--version") return "gh version 2.77.0\n";
    if (input.args[0] === "auth") {
      return JSON.stringify({
        hosts: {
          "github.com": [{ state: "success", active: true, host: "github.com", login: "octocat" }],
        },
      });
    }
    if (input.args[0] === "repo") {
      return JSON.stringify({
        name: "widgets",
        nameWithOwner: "acme/widgets",
        url: "https://github.com/acme/widgets",
      });
    }
    return "{}";
  }).layer,
)("GitHubWorkbench connection", (it) => {
  it.effect("detects the active gh account and local repository", () =>
    Effect.gen(function* () {
      const workbench = yield* GitHubWorkbench;
      const result = yield* workbench.connection({ cwd: "/repo" });
      assert.isTrue(result.available);
      assert.isTrue(result.authenticated);
      assert.equal(result.account, "octocat");
      assert.equal(result.repository?.nameWithOwner, "acme/widgets");
    }),
  );
});

const listFixture = makeLayer((input) => {
  if (input.args[0] === "search") {
    return JSON.stringify([
      {
        number: 42,
        title: "Review me",
        url: "https://github.com/acme/widgets/pull/42",
        state: "OPEN",
        updatedAt: "2026-07-15T12:00:00Z",
        createdAt: "2026-07-15T10:00:00Z",
        repository: { name: "widgets", nameWithOwner: "acme/widgets" },
        author: { login: "octocat", is_bot: false },
        labels: [{ name: "feature", color: "00ff00", description: "Feature" }],
        assignees: [],
        commentsCount: 2,
      },
    ]);
  }
  return "[]";
});

it.layer(listFixture.layer)("GitHubWorkbench list", (it) => {
  it.effect("lists review requests with normalized repository context", () =>
    Effect.gen(function* () {
      const workbench = yield* GitHubWorkbench;
      const result = yield* workbench.listWork({
        cwd: "/repo",
        kind: "pull_request",
        view: "reviewing",
        query: null,
        repository: "acme/widgets",
        limit: 50,
      });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.repository.nameWithOwner, "acme/widgets");
      assert.equal(result.items[0]?.commentsCount, 2);
    }),
  );

  it.effect("never forwards search text as CLI flags or repository qualifiers", () =>
    Effect.gen(function* () {
      const workbench = yield* GitHubWorkbench;
      yield* workbench.listWork({
        cwd: "/repo",
        kind: "pull_request",
        view: "all",
        query: "--repo=outside/not-attached",
        repository: "acme/widgets",
        limit: 50,
      });

      const args = listFixture.calls.at(-1)?.args ?? [];
      expect(args).toContain("acme/widgets");
      expect(args).not.toContain("--repo=outside/not-attached");
    }),
  );
});

const actionFixture = makeLayer(() => "https://github.com/acme/widgets/issues/8\n");
it.layer(actionFixture.layer)("GitHubWorkbench actions", (it) => {
  it.effect("uses stdin for issue bodies instead of command arguments", () =>
    Effect.gen(function* () {
      const workbench = yield* GitHubWorkbench;
      const result = yield* workbench.workItemAction({
        action: "create_issue",
        cwd: "/repo",
        repository: "acme/widgets",
        title: "Broken widget",
        body: "Secret-free but potentially long body",
        labels: ["bug"],
        assignees: ["@me"],
      });
      assert.equal(result.url, "https://github.com/acme/widgets/issues/8");
      expect(actionFixture.calls[0]?.args).toContain("--body-file");
      expect(actionFixture.calls[0]?.args).not.toContain("Secret-free but potentially long body");
      expect(actionFixture.calls[0]?.stdin).toBe("Secret-free but potentially long body");
    }),
  );
});

it.layer(
  makeLayer((input) => {
    if (input.args[0] === "pr" && input.args[1] === "view") {
      return JSON.stringify({
        number: 9,
        title: "Full detail",
        url: "https://github.com/acme/widgets/pull/9",
        state: "OPEN",
        body: "## Summary",
        createdAt: "2026-07-15T10:00:00Z",
        updatedAt: "2026-07-15T12:00:00Z",
        headRefName: "feature/full-detail",
        baseRefName: "main",
        headRefOid: "abcdef1234567890",
        author: { login: "octocat" },
        comments: [
          {
            id: "c1",
            author: { login: "reviewer" },
            body: "Looks good",
            createdAt: "2026-07-15T11:00:00Z",
            url: "https://example.test/c1",
          },
        ],
        statusCheckRollup: [
          {
            name: "test",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            detailsUrl: "https://github.com/acme/widgets/actions/runs/123",
          },
        ],
      });
    }
    return "{}";
  }).layer,
)("GitHubWorkbench detail", (it) => {
  it.effect("normalizes checks and timeline entries", () =>
    Effect.gen(function* () {
      const workbench = yield* GitHubWorkbench;
      const result = yield* workbench.workItemDetail({
        cwd: "/repo",
        kind: "pull_request",
        repository: "acme/widgets",
        number: 9,
      });
      assert.equal(result.detail.item.checkStatus, "success");
      assert.equal(result.detail.checks[0]?.runId, 123);
      assert.equal(result.detail.timeline[0]?.type, "comment");
    }),
  );
});
