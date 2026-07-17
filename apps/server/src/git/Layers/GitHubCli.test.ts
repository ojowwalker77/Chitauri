import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  GitHubApiClient,
  type GitHubApiClientShape,
  type GitHubApiRequest,
} from "../../github/Services/GitHubApiClient";
import { GitCore, type GitCoreShape } from "../Services/GitCore";
import { GitHubCli } from "../Services/GitHubCli";
import { GitHubApiLive } from "./GitHubApi";
import { decodePullRequestListJson } from "./GitHubCli";

type RequestCall =
  | { readonly kind: "json"; readonly input: GitHubApiRequest }
  | {
      readonly kind: "graphql";
      readonly input: Parameters<GitHubApiClientShape["graphql"]>[0];
    };

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: "Direct API",
    html_url: "https://github.com/acme/widgets/pull/42",
    state: "open",
    merged_at: null,
    draft: true,
    mergeable: false,
    additions: 38,
    deletions: 12,
    changed_files: 4,
    updated_at: "2026-07-17T12:00:00Z",
    base: { ref: "main", repo: { full_name: "acme/widgets" } },
    head: {
      ref: "feature/direct-api",
      repo: { full_name: "octocat/widgets" },
      user: { login: "octocat" },
    },
    ...overrides,
  };
}

function makeLayer(handler: (call: RequestCall) => unknown) {
  const calls: RequestCall[] = [];
  const api = GitHubApiClient.of({
    requestJson: (input) => {
      const call = { kind: "json" as const, input };
      calls.push(call);
      return Effect.succeed(handler(call)) as never;
    },
    requestText: () => Effect.die("unused"),
    graphql: (input) => {
      const call = { kind: "graphql" as const, input };
      calls.push(call);
      return Effect.succeed(handler(call)) as never;
    },
    viewer: () => Effect.die("unused"),
    invalidate: () => Effect.void,
  });
  const git = {
    readConfigValue: () => Effect.succeed("git@github.com:acme/widgets.git"),
  } as unknown as GitCoreShape;
  return {
    calls,
    layer: GitHubApiLive.pipe(
      Layer.provideMerge(Layer.succeed(GitHubApiClient, api)),
      Layer.provideMerge(Layer.succeed(GitCore, git)),
      Layer.provideMerge(NodeServices.layer),
    ),
  };
}

it.layer(makeLayer(() => pullRequest()).layer)("GitHubApiLive pull requests", (it) => {
  it.effect("normalizes a direct REST pull request response", () =>
    Effect.gen(function* () {
      const github = yield* GitHubCli;
      const result = yield* github.getPullRequest({ cwd: "/repo", reference: "#42" });
      assert.equal(result.number, 42);
      assert.equal(result.mergeability, "conflicting");
      assert.equal(result.headRepositoryNameWithOwner, "octocat/widgets");
      assert.isTrue(result.isCrossRepository);
    }),
  );
});

const listFixture = makeLayer(() => [pullRequest()]);
it.layer(listFixture.layer)("GitHubApiLive list", (it) => {
  it.effect("resolves a Git remote alias before querying the API", () =>
    Effect.gen(function* () {
      const github = yield* GitHubCli;
      const result = yield* github.listPullRequests({
        cwd: "/repo",
        headSelector: "origin:feature/direct-api",
      });
      assert.equal(result.length, 1);
      const call = listFixture.calls.find((entry) => entry.kind === "json");
      assert.equal(call?.kind, "json");
      if (!call || call.kind !== "json") return;
      assert.equal(call.input.query?.head, "acme:feature/direct-api");
    }),
  );
});

it.effect("keeps historical test fixtures tolerant of malformed entries", () =>
  Effect.gen(function* () {
    const result = yield* decodePullRequestListJson(
      JSON.stringify([
        { number: -1 },
        {
          number: 7,
          title: "Healthy",
          url: "https://github.com/acme/widgets/pull/7",
          baseRefName: "main",
          headRefName: "feature/healthy",
          state: "MERGED",
          mergedAt: "2026-07-17T12:00:00Z",
        },
      ]),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.state, "merged");
  }),
);
