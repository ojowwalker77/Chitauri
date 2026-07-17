import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner";
import { ServerSecretStore } from "../../auth/Services/ServerSecretStore";
import { GitHubCliError } from "../../git/Errors";
import {
  GitHubApiClient,
  type GitHubApiClientShape,
  type GitHubApiRequest,
  type GitHubApiTextResponse,
  type GitHubViewer,
} from "../Services/GitHubApiClient";

const API_VERSION = "2022-11-28";
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const TOKEN_SECRET_NAME = "github-api-token";

interface CacheEntry {
  readonly body: string;
  readonly etag: string | null;
  readonly expiresAt: number;
  readonly status: number;
  readonly truncated: boolean;
  readonly rateLimitRemaining: number | null;
  readonly rateLimitResetAt: string | null;
}

function apiBaseUrl(host: string): string {
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}

function graphqlUrl(host: string): string {
  return host === "github.com" ? "https://api.github.com/graphql" : `https://${host}/api/graphql`;
}

function rateLimitResetAt(headers: Headers): string | null {
  const seconds = Number(headers.get("x-ratelimit-reset"));
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function rateLimitRemaining(headers: Headers): number | null {
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  return Number.isInteger(remaining) && remaining >= 0 ? remaining : null;
}

function cacheKey(input: GitHubApiRequest): string {
  const query = Object.entries(input.query ?? {})
    .filter(([, value]) => value !== null && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([
    input.host ?? "github.com",
    input.method ?? "GET",
    input.path,
    query,
    input.accept ?? "application/vnd.github+json",
    input.cacheable === true ? input.body : null,
  ]);
}

function requestUrl(input: GitHubApiRequest): string {
  const host = input.host ?? "github.com";
  const url = new URL(input.path, `${apiBaseUrl(host)}/`);
  for (const [name, value] of Object.entries(input.query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(name, String(value));
  }
  return url.toString();
}

function truncateUtf8(value: string, maxBytes: number): { body: string; truncated: boolean } {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return { body: value, truncated: false };
  return { body: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function errorDetail(status: number, body: string, headers: Headers): string {
  let message = body.trim();
  try {
    const decoded = JSON.parse(body) as { message?: unknown; errors?: unknown };
    if (typeof decoded.message === "string") message = decoded.message;
    if (Array.isArray(decoded.errors) && decoded.errors.length > 0) {
      message = `${message}: ${decoded.errors
        .map((error) =>
          typeof error === "string"
            ? error
            : typeof error === "object" && error && "message" in error
              ? String(error.message)
              : JSON.stringify(error),
        )
        .join("; ")}`;
    }
  } catch {
    // Non-JSON errors are already useful as text.
  }
  const remaining = rateLimitRemaining(headers);
  const resetAt = rateLimitResetAt(headers);
  const rateDetail = remaining === 0 && resetAt ? ` Rate limit resets at ${resetAt}.` : "";
  return `GitHub API returned ${status}: ${message || "Request failed."}${rateDetail}`;
}

export const makeGitHubApiClient = Effect.gen(function* () {
  const secretStore = yield* ServerSecretStore;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<GitHubApiTextResponse>>();

  const resolveToken = yield* Effect.cached(
    Effect.gen(function* () {
      const environmentToken =
        process.env.TEACODE_GITHUB_TOKEN?.trim() ||
        process.env.GH_TOKEN?.trim() ||
        process.env.GITHUB_TOKEN?.trim();
      if (environmentToken) return environmentToken;

      const stored = yield* secretStore
        .get(TOKEN_SECRET_NAME)
        .pipe(Effect.orElseSucceed(() => null));
      if (stored) {
        const token = new TextDecoder().decode(stored).trim();
        if (token) return token;
      }

      // One-time migration for existing installations. Runtime GitHub traffic
      // never shells through gh; a successfully imported token is persisted.
      const imported = yield* Effect.tryPromise({
        try: () => runProcess("gh", ["auth", "token"], { timeoutMs: 5_000 }),
        catch: () => null,
      }).pipe(
        Effect.map((result) => result?.stdout.trim() || null),
        Effect.catch(() => Effect.succeed(null)),
      );
      if (imported) {
        yield* secretStore
          .set(TOKEN_SECRET_NAME, new TextEncoder().encode(imported))
          .pipe(Effect.catch(() => Effect.void));
        return imported;
      }

      return yield* Effect.fail(
        new GitHubCliError({
          operation: "authenticate",
          detail:
            "No GitHub token is configured. Set TEACODE_GITHUB_TOKEN once, or authenticate gh once so TeaCode can import its token.",
        }),
      );
    }),
  );

  const requestText: GitHubApiClientShape["requestText"] = (input) =>
    Effect.gen(function* () {
      const method = input.method ?? "GET";
      const cacheable = method === "GET" || input.cacheable === true;
      const key = cacheKey(input);
      const cached = cacheable ? cache.get(key) : undefined;
      if (cached && cached.expiresAt > Date.now()) return cached;

      const token = yield* resolveToken;
      const existing = cacheable ? inFlight.get(key) : undefined;
      if (existing) {
        return yield* Effect.tryPromise({
          try: () => existing,
          catch: (cause) =>
            cause instanceof GitHubCliError
              ? cause
              : new GitHubCliError({ operation: "request", detail: String(cause), cause }),
        });
      }

      const run = async (): Promise<GitHubApiTextResponse> => {
        const headers = new Headers({
          Accept: input.accept ?? "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "TeaCode",
          "X-GitHub-Api-Version": API_VERSION,
        });
        if (input.body !== undefined) headers.set("Content-Type", "application/json");
        if (cached?.etag) headers.set("If-None-Match", cached.etag);

        let response: Response | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            response = await fetch(requestUrl(input), {
              method,
              headers,
              body: input.body === undefined ? undefined : JSON.stringify(input.body),
              signal: AbortSignal.timeout(60_000),
            });
            if (![502, 503, 504].includes(response.status) || attempt === 2) break;
          } catch (cause) {
            lastError = cause;
            if (attempt === 2) break;
          }
          await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 250 : 1_000));
        }
        if (!response) {
          throw new GitHubCliError({
            operation: `${method} ${input.path}`,
            detail: lastError instanceof Error ? lastError.message : "Network request failed.",
            cause: lastError,
          });
        }

        if (response.status === 304 && cached) {
          const refreshed = {
            ...cached,
            expiresAt: Date.now() + (input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
          };
          cache.set(key, refreshed);
          return refreshed;
        }

        const rawBody = await response.text();
        if (!response.ok) {
          throw new GitHubCliError({
            operation: `${method} ${input.path}`,
            detail: errorDetail(response.status, rawBody, response.headers),
          });
        }

        const limited = truncateUtf8(rawBody, input.maxBytes ?? DEFAULT_MAX_BYTES);
        const result: GitHubApiTextResponse = {
          body: limited.body,
          status: response.status,
          truncated: limited.truncated,
          etag: response.headers.get("etag"),
          rateLimitRemaining: rateLimitRemaining(response.headers),
          rateLimitResetAt: rateLimitResetAt(response.headers),
        };
        if (cacheable) {
          cache.set(key, {
            ...result,
            expiresAt: Date.now() + (input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
          });
        } else {
          cache.clear();
        }
        return result;
      };

      const promise = run();
      if (cacheable) inFlight.set(key, promise);
      return yield* Effect.tryPromise({
        try: () => promise.finally(() => inFlight.delete(key)),
        catch: (cause) =>
          cause instanceof GitHubCliError
            ? cause
            : new GitHubCliError({
                operation: `${method} ${input.path}`,
                detail: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
      });
    });

  const requestJson: GitHubApiClientShape["requestJson"] = <T = unknown>(input: GitHubApiRequest) =>
    requestText(input).pipe(
      Effect.flatMap((response) =>
        Effect.try({
          try: () => (response.body.length === 0 ? null : JSON.parse(response.body)) as T,
          catch: (cause) =>
            new GitHubCliError({
              operation: `${input.method ?? "GET"} ${input.path}`,
              detail: "GitHub API returned invalid JSON.",
              cause,
            }),
        }),
      ),
    );

  const graphql: GitHubApiClientShape["graphql"] = (input) => {
    const host = input.host ?? "github.com";
    const cacheable = !input.query.trimStart().startsWith("mutation");
    return requestJson({
      host,
      method: "POST",
      path: graphqlUrl(host),
      body: { query: input.query, variables: input.variables ?? {} },
      cacheTtlMs: input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      cacheable,
    });
  };

  const viewer: GitHubApiClientShape["viewer"] = (host = "github.com") =>
    requestJson<{ login?: unknown; avatar_url?: unknown }>({
      host,
      path: "/user",
      cacheTtlMs: 5 * 60_000,
    }).pipe(
      Effect.flatMap((raw) => {
        if (typeof raw.login !== "string" || raw.login.trim().length === 0) {
          return Effect.fail(
            new GitHubCliError({ operation: "viewer", detail: "GitHub returned no viewer login." }),
          );
        }
        return Effect.succeed({
          login: raw.login,
          avatarUrl: typeof raw.avatar_url === "string" ? raw.avatar_url : null,
        } satisfies GitHubViewer);
      }),
    );

  return GitHubApiClient.of({
    requestJson,
    requestText,
    graphql,
    viewer,
    invalidate: () => Effect.sync(() => cache.clear()),
  });
});

export const GitHubApiClientLive = Layer.effect(GitHubApiClient, makeGitHubApiClient);
