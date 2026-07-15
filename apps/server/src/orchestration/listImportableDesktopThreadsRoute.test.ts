import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { ProviderAdapterRegistryShape } from "../provider/Services/ProviderAdapterRegistry";
import type { ProviderSessionDirectoryShape } from "../provider/Services/ProviderSessionDirectory";
import { makeListImportableDesktopThreadsHandler } from "./listImportableDesktopThreadsRoute";

const { listClaudeSessions } = vi.hoisted(() => ({
  listClaudeSessions: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  listSessions: listClaudeSessions,
}));

function makeHandler(input?: { codexFailure?: Error }) {
  const providerAdapterRegistry = {
    getByProvider: () =>
      Effect.succeed({
        listExternalThreads: () =>
          input?.codexFailure
            ? Effect.fail(input.codexFailure)
            : Effect.succeed([
                {
                  externalThreadId: "codex-external-1",
                  title: "Fix reconnect handling",
                  cwd: "/work/chitauri",
                  createdAt: "2026-07-14T10:00:00.000Z",
                  updatedAt: "2026-07-15T11:00:00.000Z",
                },
              ]),
      }),
    listProviders: () => Effect.succeed(["codex", "claudeAgent"]),
  } as unknown as ProviderAdapterRegistryShape;
  const providerSessionDirectory = {
    listBindings: () =>
      Effect.succeed([
        {
          threadId: "thread-imported" as never,
          provider: "codex" as const,
          resumeCursor: { threadId: "codex-external-1" },
        },
      ]),
  } as unknown as ProviderSessionDirectoryShape;

  return makeListImportableDesktopThreadsHandler({
    providerAdapterRegistry,
    providerSessionDirectory,
  });
}

describe("listImportableDesktopThreadsRoute", () => {
  it("merges provider histories and marks already imported desktop threads", async () => {
    listClaudeSessions.mockResolvedValueOnce([
      {
        sessionId: "claude-session-1",
        summary: "Polish the sidebar",
        cwd: "/work/chitauri",
        createdAt: Date.parse("2026-07-13T09:00:00.000Z"),
        lastModified: Date.parse("2026-07-15T12:00:00.000Z"),
      },
    ]);

    const result = await Effect.runPromise(makeHandler()());

    expect(result.warnings).toEqual([]);
    expect(result.threads.map((thread) => thread.provider)).toEqual(["claudeAgent", "codex"]);
    expect(result.threads.find((thread) => thread.provider === "codex")).toMatchObject({
      externalId: "codex-external-1",
      chitauriThreadId: "thread-imported",
    });
    expect(result.threads.find((thread) => thread.provider === "claudeAgent")).toMatchObject({
      externalId: "claude-session-1",
      chitauriThreadId: null,
    });
  });

  it("returns healthy Claude results with a precise Codex warning", async () => {
    listClaudeSessions.mockResolvedValueOnce([
      {
        sessionId: "claude-session-2",
        summary: "Investigate a crash",
        lastModified: Date.parse("2026-07-15T12:00:00.000Z"),
      },
    ]);

    const result = await Effect.runPromise(
      makeHandler({ codexFailure: new Error("Codex app-server is unavailable.") })(),
    );

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]?.provider).toBe("claudeAgent");
    expect(result.warnings).toEqual([
      { provider: "codex", message: "Codex app-server is unavailable." },
    ]);
  });
});
