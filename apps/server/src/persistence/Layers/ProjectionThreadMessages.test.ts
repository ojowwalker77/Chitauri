import { MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ProjectionThreadMessageRepository } from "../Services/ProjectionThreadMessages.ts";
import { ProjectionThreadMessageRepositoryLive } from "./ProjectionThreadMessages.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadMessageRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadMessageRepository", (it) => {
  it.effect("preserves existing attachments when upsert omits attachments", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.makeUnsafe("thread-preserve-attachments");
      const messageId = MessageId.makeUnsafe("message-preserve-attachments");
      const createdAt = "2026-02-28T19:00:00.000Z";
      const updatedAt = "2026-02-28T19:00:01.000Z";
      const persistedAttachments = [
        {
          type: "image" as const,
          id: "thread-preserve-attachments-att-1",
          name: "example.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ];

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "initial",
        attachments: persistedAttachments,
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt,
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "updated",
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt: "2026-02-28T19:00:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "updated");
      assert.deepEqual(rows[0]?.attachments, persistedAttachments);
    }),
  );

  it.effect("allows explicit attachment clearing with an empty array", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.makeUnsafe("thread-clear-attachments");
      const messageId = MessageId.makeUnsafe("message-clear-attachments");
      const createdAt = "2026-02-28T19:10:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "with attachment",
        attachments: [
          {
            type: "image",
            id: "thread-clear-attachments-att-1",
            name: "example.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ],
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt: "2026-02-28T19:10:01.000Z",
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "cleared",
        attachments: [],
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt: "2026-02-28T19:10:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "cleared");
      assert.deepEqual(rows[0]?.attachments, []);
    }),
  );

  it.effect("preserves structured skills and mentions when upsert omits them", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.makeUnsafe("thread-preserve-inline-metadata");
      const messageId = MessageId.makeUnsafe("message-preserve-inline-metadata");
      const createdAt = "2026-02-28T19:20:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "Use @github with $check-code",
        skills: [
          {
            name: "check-code",
            path: "/Users/test/.codex/skills/check-code/SKILL.md",
          },
        ],
        mentions: [
          {
            name: "github",
            path: "plugin://github@curated",
          },
        ],
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt: "2026-02-28T19:20:01.000Z",
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "updated text",
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt: "2026-02-28T19:20:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0]?.skills, [
        {
          name: "check-code",
          path: "/Users/test/.codex/skills/check-code/SKILL.md",
        },
      ]);
      assert.deepEqual(rows[0]?.mentions, [
        {
          name: "github",
          path: "plugin://github@curated",
        },
      ]);
    }),
  );

  it.effect("preserves dispatch mode when later updates omit it", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.makeUnsafe("thread-preserve-dispatch-mode");
      const messageId = MessageId.makeUnsafe("message-preserve-dispatch-mode");
      const createdAt = "2026-02-28T19:30:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "steer this",
        dispatchMode: "steer",
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt: "2026-02-28T19:30:01.000Z",
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "steer this harder",
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt: "2026-02-28T19:30:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.dispatchMode, "steer");
    }),
  );

  it.effect("reports a miss when appending to a message that does not exist yet", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;

      const appended = yield* repository.appendStreamingText({
        messageId: MessageId.makeUnsafe("message-append-missing"),
        threadId: ThreadId.makeUnsafe("thread-append-missing"),
        turnId: null,
        role: "assistant",
        textDelta: "first delta",
        source: "native",
        updatedAt: "2026-02-28T19:40:00.000Z",
      });

      assert.equal(appended, false);
      const rows = yield* repository.listByThreadId({
        threadId: ThreadId.makeUnsafe("thread-append-missing"),
      });
      assert.deepEqual(rows, []);
    }),
  );

  it.effect("appends streaming deltas in place and preserves untouched columns", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.makeUnsafe("thread-append-streaming");
      const messageId = MessageId.makeUnsafe("message-append-streaming");
      const turnId = TurnId.makeUnsafe("turn-append-streaming");
      const createdAt = "2026-02-28T19:41:00.000Z";
      const attachments = [
        {
          type: "image" as const,
          id: "thread-append-streaming-att-1",
          name: "example.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ];

      yield* repository.upsert({
        messageId,
        threadId,
        turnId,
        role: "assistant",
        text: "Hel",
        attachments,
        dispatchOrigin: "automation",
        isStreaming: true,
        source: "native",
        createdAt,
        updatedAt: createdAt,
      });

      const deltas = ["lo, ", "wor", "ld", "!"];
      yield* Effect.forEach(
        deltas,
        (delta, index) =>
          repository.appendStreamingText({
            messageId,
            threadId,
            turnId: null,
            role: "assistant",
            textDelta: delta,
            source: "native",
            updatedAt: `2026-02-28T19:41:0${index + 1}.000Z`,
          }),
        { concurrency: 1 },
      );

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "Hello, world!");
      // A delta must not clear the turn id, attachments, dispatch origin or created_at.
      assert.equal(rows[0]?.turnId, turnId);
      assert.deepEqual(rows[0]?.attachments, attachments);
      assert.equal(rows[0]?.dispatchOrigin, "automation");
      assert.equal(rows[0]?.isStreaming, true);
      assert.equal(rows[0]?.createdAt, createdAt);
      assert.equal(rows[0]?.updatedAt, "2026-02-28T19:41:04.000Z");
    }),
  );

  it.effect("round-trips and preserves the automation dispatch origin", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.makeUnsafe("thread-dispatch-origin");
      const messageId = MessageId.makeUnsafe("message-dispatch-origin");
      const createdAt = "2026-02-28T19:31:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "kick off the review",
        dispatchOrigin: "automation",
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt: "2026-02-28T19:31:01.000Z",
      });

      // A later streaming update omits the origin; it must not be cleared.
      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "kick off the review now",
        isStreaming: false,
        source: "native",
        createdAt,
        updatedAt: "2026-02-28T19:31:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.dispatchOrigin, "automation");
    }),
  );
});
