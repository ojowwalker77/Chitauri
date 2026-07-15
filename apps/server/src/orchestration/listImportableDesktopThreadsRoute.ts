import { listSessions as listClaudeSessions } from "@anthropic-ai/claude-agent-sdk";
import type {
  ImportableDesktopThread,
  ImportableDesktopThreadProvider,
  ImportableDesktopThreadWarning,
  OrchestrationListImportableDesktopThreadsResult,
} from "@t3tools/contracts";
import { Effect } from "effect";

import type { ProviderAdapterRegistryShape } from "../provider/Services/ProviderAdapterRegistry";
import type {
  ProviderRuntimeBinding,
  ProviderSessionDirectoryShape,
} from "../provider/Services/ProviderSessionDirectory";

const DESKTOP_THREAD_IMPORT_LIMIT = 200;

function readableFailure(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (cause && typeof cause === "object") {
    const detail = "detail" in cause ? cause.detail : undefined;
    if (typeof detail === "string" && detail.trim().length > 0) return detail;
    const message = "message" in cause ? cause.message : undefined;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return fallback;
}

function readResumeExternalId(binding: ProviderRuntimeBinding): string | null {
  const cursor = binding.resumeCursor;
  if (!cursor || typeof cursor !== "object") return null;

  if (binding.provider === "codex" && "threadId" in cursor && typeof cursor.threadId === "string") {
    return cursor.threadId.trim() || null;
  }
  if (
    binding.provider === "claudeAgent" &&
    "resume" in cursor &&
    typeof cursor.resume === "string"
  ) {
    return cursor.resume.trim() || null;
  }
  return null;
}

function importedThreadKey(provider: ImportableDesktopThreadProvider, externalId: string): string {
  return `${provider}:${externalId}`;
}

function isoFromMilliseconds(value: number | undefined, fallback: string | null): string | null {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function sourceResult(
  provider: ImportableDesktopThreadProvider,
  effect: Effect.Effect<ReadonlyArray<Omit<ImportableDesktopThread, "chitauriThreadId">>, unknown>,
  fallbackMessage: string,
) {
  return effect.pipe(
    Effect.map((threads) => ({ threads, warning: null })),
    Effect.catch((cause) =>
      Effect.succeed({
        threads: [],
        warning: {
          provider,
          message: readableFailure(cause, fallbackMessage),
        } satisfies ImportableDesktopThreadWarning,
      }),
    ),
  );
}

export interface ListImportableDesktopThreadsHandlerOptions {
  readonly providerAdapterRegistry: ProviderAdapterRegistryShape;
  readonly providerSessionDirectory: ProviderSessionDirectoryShape;
}

export function makeListImportableDesktopThreadsHandler(
  options: ListImportableDesktopThreadsHandlerOptions,
) {
  return Effect.fnUntraced(function* () {
    const importedBindings = yield* options.providerSessionDirectory
      .listBindings()
      .pipe(Effect.catch(() => Effect.succeed([])));
    const importedThreadIdByExternalKey = new Map(
      importedBindings.flatMap((binding) => {
        const externalId = readResumeExternalId(binding);
        if (!externalId || (binding.provider !== "codex" && binding.provider !== "claudeAgent")) {
          return [];
        }
        return [[importedThreadKey(binding.provider, externalId), binding.threadId] as const];
      }),
    );

    const codexThreads = sourceResult(
      "codex",
      Effect.gen(function* () {
        const adapter = yield* options.providerAdapterRegistry.getByProvider("codex");
        if (!adapter.listExternalThreads) {
          return yield* Effect.fail(new Error("This Codex build does not expose local threads."));
        }
        const threads = yield* adapter.listExternalThreads({ limit: DESKTOP_THREAD_IMPORT_LIMIT });
        return threads.map((thread) => ({
          provider: "codex" as const,
          externalId: thread.externalThreadId,
          title: thread.title,
          cwd: thread.cwd?.trim() || null,
          createdAt: thread.createdAt ?? null,
          updatedAt: thread.updatedAt,
        }));
      }),
      "Codex Desktop threads could not be loaded.",
    );

    const claudeThreads = sourceResult(
      "claudeAgent",
      Effect.tryPromise({
        try: async () => {
          const sessions = await listClaudeSessions({ limit: DESKTOP_THREAD_IMPORT_LIMIT });
          const discoveredAt = new Date().toISOString();
          return sessions.map((session) => ({
            provider: "claudeAgent" as const,
            externalId: session.sessionId,
            title: session.summary.trim() || `Claude session ${session.sessionId.slice(-8)}`,
            cwd: session.cwd?.trim() || null,
            createdAt: isoFromMilliseconds(session.createdAt, null),
            updatedAt: isoFromMilliseconds(session.lastModified, discoveredAt) ?? discoveredAt,
          }));
        },
        catch: (cause) => cause,
      }),
      "Claude Desktop threads could not be loaded.",
    );

    const sources = yield* Effect.all([codexThreads, claudeThreads], { concurrency: 2 });
    const warnings = sources.flatMap((source) => (source.warning ? [source.warning] : []));
    const threads = sources
      .flatMap((source) => source.threads)
      .map((thread) => ({
        ...thread,
        chitauriThreadId:
          importedThreadIdByExternalKey.get(
            importedThreadKey(thread.provider, thread.externalId),
          ) ?? null,
      }))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return { threads, warnings } satisfies OrchestrationListImportableDesktopThreadsResult;
  });
}
