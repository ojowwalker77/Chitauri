/**
 * Grok ACP support - builds the Grok Build stdio command and resolves auth.
 *
 * @module GrokAcpSupport
 */
import { type GrokModelOptions } from "@t3tools/contracts";
import { Effect, Layer, Scope, ServiceMap } from "effect";
import type * as EffectAcpErrors from "effect-acp/errors";
import * as EffectAcpErrorsRuntime from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime.ts";

export interface GrokAcpRuntimeSettings {
  readonly binaryPath?: string;
  readonly model?: string;
  readonly reasoningEffort?: GrokModelOptions["reasoningEffort"];
  readonly alwaysApprove?: boolean;
}

export interface GrokAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "resolveAuthMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly grokSettings: GrokAcpRuntimeSettings | null | undefined;
}

export interface GrokAcpModelSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly method: "session/set_config_option";
}

const GROK_API_KEY_AUTH_METHOD_ID = "xai.api_key";
const GROK_CACHED_TOKEN_AUTH_METHOD_ID = "cached_token";
const GROK_API_KEY_ENV_KEYS = ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"] as const;

export function getGrokApiKeyEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of GROK_API_KEY_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function hasGrokApiKeyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return getGrokApiKeyEnv(env) !== undefined;
}

export function buildGrokAcpSpawnInput(
  grokSettings: GrokAcpRuntimeSettings | null | undefined,
  cwd: string,
): AcpSpawnInput {
  const args = ["agent", "--no-leader"];
  if (grokSettings?.alwaysApprove === true) {
    // Grok's approval flag belongs to `grok agent`, before the `stdio` subcommand.
    args.push("--always-approve");
  }
  const model = grokSettings?.model?.trim();
  if (model) {
    args.push("-m", model);
  }
  const reasoningEffort = grokSettings?.reasoningEffort?.trim();
  if (reasoningEffort) {
    args.push("--reasoning-effort", reasoningEffort);
  }
  args.push("stdio");

  return {
    command: grokSettings?.binaryPath || "grok",
    args,
    cwd,
  };
}

function availableAuthMethodIds(
  initializeResult: EffectAcpSchema.InitializeResponse,
): ReadonlySet<string> {
  return new Set((initializeResult.authMethods ?? []).map((method) => method.id.trim()));
}

// Exported for a future explicit, user-initiated "connect Grok" action only.
// `cached_token` is Grok CLI's fallback ACP auth method whenever no API key
// env var is set, and it is picked here purely based on the CLI *advertising*
// it in `initialize` — not on any confirmation that a token is actually cached
// on disk. Nothing in this codebase (and nothing vendored from xAI) proves
// that calling `authenticate({ methodId: "cached_token" })` is a passive
// no-op when no token is cached rather than a fallback interactive/browser
// login. Per the `authMethodId` gate in AcpSessionRuntime.ts, authenticate()
// must only run when an adapter explicitly opts in — do NOT wire this
// function into `makeGrokAcpRuntime`'s implicit session-start path.
export const resolveGrokAcpAuthMethodId = (
  initializeResult: EffectAcpSchema.InitializeResponse,
): Effect.Effect<string, EffectAcpErrors.AcpError> =>
  Effect.gen(function* () {
    const authMethodIds = availableAuthMethodIds(initializeResult);
    if (hasGrokApiKeyEnv() && authMethodIds.has(GROK_API_KEY_AUTH_METHOD_ID)) {
      return GROK_API_KEY_AUTH_METHOD_ID;
    }
    if (authMethodIds.has(GROK_CACHED_TOKEN_AUTH_METHOD_ID)) {
      return GROK_CACHED_TOKEN_AUTH_METHOD_ID;
    }
    return yield* new EffectAcpErrorsRuntime.AcpRequestError({
      code: -32602,
      errorMessage: "Grok ACP authentication is unavailable.",
      data: {
        authMethods: [...authMethodIds],
        detail: "Run `grok` to authenticate locally, or set XAI_API_KEY.",
      },
    });
  });

export const makeGrokAcpRuntime = (
  input: GrokAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildGrokAcpSpawnInput(input.grokSettings, input.cwd),
        // Do not resolve/pass an auth method here: TeaCode must never trigger
        // an interactive Grok login as a side effect of automatic session
        // startup (see resolveGrokAcpAuthMethodId above and the `authMethodId`
        // gate in AcpSessionRuntime.ts). A user's XAI_API_KEY /
        // GROK_CODE_XAI_API_KEY still works without a browser: the `grok`
        // child process inherits the full parent environment (see the spawn
        // env merge in AcpSessionRuntime.ts) and reads the key itself, same as
        // running `grok` directly from a terminal. A Grok CLI that truly has
        // no cached credentials and no env key simply fails session/new with
        // a normal error instead of TeaCode opening a login browser.
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return ServiceMap.getUnsafe(acpContext, AcpSessionRuntime);
  });

export function applyGrokAcpModelSelection<E>(input: {
  readonly runtime: Pick<
    AcpSessionRuntimeShape,
    "getConfigOptions" | "setConfigOption" | "setModel"
  >;
  readonly model: string;
  readonly options?: GrokModelOptions | null | undefined;
  readonly mapError: (context: GrokAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  void input;
  // Grok ACP 0.1.210 advertises models in initialize/session responses but does
  // not implement `session/set_config_option`. Model and effort are therefore
  // process-start settings supplied by `buildGrokAcpSpawnInput`.
  return Effect.void;
}
