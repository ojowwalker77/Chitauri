import { Effect, ServiceMap } from "effect";

import type { GitHubCliError } from "../../git/Errors";

export interface GitHubApiRequest {
  readonly host?: string;
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly body?: unknown;
  readonly accept?: string;
  readonly cacheTtlMs?: number;
  readonly cacheable?: boolean;
  readonly maxBytes?: number;
}

export interface GitHubApiTextResponse {
  readonly body: string;
  readonly status: number;
  readonly truncated: boolean;
  readonly etag: string | null;
  readonly rateLimitRemaining: number | null;
  readonly rateLimitResetAt: string | null;
}

export interface GitHubViewer {
  readonly login: string;
  readonly avatarUrl: string | null;
}

export interface GitHubApiClientShape {
  readonly requestJson: <T = unknown>(
    input: GitHubApiRequest,
  ) => Effect.Effect<T, GitHubCliError>;
  readonly requestText: (
    input: GitHubApiRequest,
  ) => Effect.Effect<GitHubApiTextResponse, GitHubCliError>;
  readonly graphql: <T = unknown>(input: {
    readonly host?: string;
    readonly query: string;
    readonly variables?: Readonly<Record<string, unknown>>;
    readonly cacheTtlMs?: number;
  }) => Effect.Effect<T, GitHubCliError>;
  readonly viewer: (host?: string) => Effect.Effect<GitHubViewer, GitHubCliError>;
  readonly invalidate: () => Effect.Effect<void>;
}

export class GitHubApiClient extends ServiceMap.Service<GitHubApiClient, GitHubApiClientShape>()(
  "t3/github/Services/GitHubApiClient",
) {}
