import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect } from "vitest";

import { GitCore, type GitCoreShape } from "../../git/Services/GitCore";
import {
  GitHubApiClient,
  type GitHubApiClientShape,
  type GitHubApiRequest,
} from "../Services/GitHubApiClient";
import { GitHubWorkbench } from "../Services/GitHubWorkbench";
import { GitHubWorkbenchLive } from "./GitHubWorkbench";

type ApiCall =
  | { readonly kind: "json"; readonly input: GitHubApiRequest }
  | {
      readonly kind: "graphql";
      readonly input: Parameters<GitHubApiClientShape["graphql"]>[0];
    };

function makeLayer(handler: (call: ApiCall) => unknown) {
  const calls: ApiCall[] = [];
  const api = GitHubApiClient.of({
    requestJson: (input) => {
      const call = { kind: "json" as const, input };
      calls.push(call);
      return Effect.succeed(handler(call)) as never;
    },
    requestText: () =>
      Effect.succeed({
        body: "",
        status: 200,
        truncated: false,
        etag: null,
        rateLimitRemaining: 5_000,
        rateLimitResetAt: null,
      }),
    graphql: (input) => {
      const call = { kind: "graphql" as const, input };
      calls.push(call);
      return Effect.succeed(handler(call)) as never;
    },
    viewer: () => Effect.succeed({ login: "octocat", avatarUrl: null }),
    invalidate: () => Effect.void,
  });
  const git = {
    readConfigValue: () => Effect.succeed("git@github.com:acme/widgets.git"),
  } as unknown as GitCoreShape;
  return {
    calls,
    layer: GitHubWorkbenchLive.pipe(
      Layer.provideMerge(Layer.succeed(GitHubApiClient, api)),
      Layer.provideMerge(Layer.succeed(GitCore, git)),
    ),
  };
}

it.layer(
  makeLayer((call) =>
    call.kind === "json"
      ? {
          name: "widgets",
          full_name: "acme/widgets",
          html_url: "https://github.com/acme/widgets",
        }
      : {},
  ).layer,
)("GitHubWorkbench connection", (it) => {
  it.effect("detects the API account and local repository", () =>
    Effect.gen(function* () {
      const workbench = yield* GitHubWorkbench;
      const result = yield* workbench.connection({ cwd: "/repo" });
      assert.isTrue(result.available);
      assert.isTrue(result.authenticated);
      assert.equal(result.account, "octocat");
      assert.equal(result.repository?.nameWithOwner, "acme/widgets");
      assert.equal(result.version, "GitHub API 2022-11-28");
    }),
  );
});

it.layer(
  makeLayer((call) =>
    call.kind === "json"
      ? {
          total_count: 1,
          items: [
            {
              number: 42,
              title: "Review me",
              html_url: "https://github.com/acme/widgets/pull/42",
              repository_url: "https://api.github.com/repos/acme/widgets",
              state: "open",
              updated_at: "2026-07-15T12:00:00Z",
              created_at: "2026-07-15T10:00:00Z",
              user: { login: "octocat", type: "User" },
              labels: [{ name: "feature", color: "00ff00", description: "Feature" }],
              assignees: [],
              comments: 2,
            },
          ],
        }
      : {},
  ).layer,
)("GitHubWorkbench list", (it) => {
  it.effect("lists review requests with normalized repository context", () =>
    Effect.gen(function* () {
      const workbench = yield* GitHubWorkbench;
      const result = yield* workbench.listWork({
        cwd: "/repo",
        kind: "pull_request",
        view: "reviewing",
        query: null,
        repository: null,
        limit: 50,
      });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.repository.nameWithOwner, "acme/widgets");
      assert.equal(result.items[0]?.commentsCount, 2);
    }),
  );
});

const actionFixture = makeLayer((call) =>
  call.kind === "json" ? { html_url: "https://github.com/acme/widgets/issues/8" } : {},
);
it.layer(actionFixture.layer)("GitHubWorkbench actions", (it) => {
  it.effect("sends issue bodies directly to the API and resolves @me", () =>
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
      const request = actionFixture.calls.find((call) => call.kind === "json");
      assert.equal(request?.kind, "json");
      if (!request || request.kind !== "json") return;
      expect(request.input.body).toEqual(
        expect.objectContaining({
          body: "Secret-free but potentially long body",
          assignees: ["octocat"],
        }),
      );
    }),
  );
});

it.layer(
  makeLayer((call) =>
    call.kind === "graphql"
      ? {
          data: {
            repository: {
              pullRequest: {
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
                assignees: { nodes: [] },
                labels: { nodes: [] },
                comments: {
                  nodes: [
                    {
                      id: "c1",
                      author: { login: "reviewer" },
                      body: "Looks good",
                      createdAt: "2026-07-15T11:00:00Z",
                      url: "https://example.test/c1",
                    },
                  ],
                },
                latestReviews: { nodes: [] },
                reviews: { nodes: [] },
                reviewRequests: { nodes: [] },
                commits: { nodes: [] },
                headCommit: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup: {
                          contexts: {
                            nodes: [
                              {
                                name: "test",
                                status: "COMPLETED",
                                conclusion: "SUCCESS",
                                detailsUrl: "https://github.com/acme/widgets/actions/runs/123",
                              },
                            ],
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        }
      : {},
  ).layer,
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
