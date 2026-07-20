import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import {
  ChatAttachment,
  MessageDispatchOrigin,
  ProviderMentionReference,
  ProviderSkillReference,
  TurnDispatchMode,
} from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  AppendProjectionThreadMessageTextInput,
  GetProjectionThreadMessageInput,
  ProjectionThreadMessageRepository,
  type ProjectionThreadMessageRepositoryShape,
  DeleteProjectionThreadMessagesInput,
  ListProjectionThreadMessagesInput,
  ProjectionThreadMessage,
} from "../Services/ProjectionThreadMessages.ts";

const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
    skills: Schema.NullOr(Schema.fromJsonString(Schema.Array(ProviderSkillReference))),
    mentions: Schema.NullOr(Schema.fromJsonString(Schema.Array(ProviderMentionReference))),
    dispatchMode: Schema.NullOr(TurnDispatchMode),
    dispatchOrigin: Schema.NullOr(MessageDispatchOrigin),
  }),
);

function toProjectionThreadMessage(
  row: Schema.Schema.Type<typeof ProjectionThreadMessageDbRowSchema>,
): ProjectionThreadMessage {
  return {
    messageId: row.messageId,
    threadId: row.threadId,
    turnId: row.turnId,
    role: row.role,
    text: row.text,
    isStreaming: row.isStreaming === 1,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.attachments !== null ? { attachments: row.attachments } : {}),
    ...(row.skills !== null ? { skills: row.skills } : {}),
    ...(row.mentions !== null ? { mentions: row.mentions } : {}),
    ...(row.dispatchMode ? { dispatchMode: row.dispatchMode } : {}),
    ...(row.dispatchOrigin ? { dispatchOrigin: row.dispatchOrigin } : {}),
  };
}

const AppendedProjectionThreadMessageRowSchema = Schema.Struct({
  messageId: Schema.String,
});

const makeProjectionThreadMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadMessageRow = SqlSchema.void({
    Request: ProjectionThreadMessage,
    execute: (row) => {
      const nextAttachmentsJson =
        row.attachments !== undefined ? JSON.stringify(row.attachments) : null;
      const nextSkillsJson = row.skills !== undefined ? JSON.stringify(row.skills) : null;
      const nextMentionsJson = row.mentions !== undefined ? JSON.stringify(row.mentions) : null;
      return sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          skills_json,
          mentions_json,
          dispatch_mode,
          dispatch_origin,
          is_streaming,
          source,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.threadId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          COALESCE(
            ${nextAttachmentsJson},
            (
              SELECT attachments_json
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          COALESCE(
            ${nextSkillsJson},
            (
              SELECT skills_json
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          COALESCE(
            ${nextMentionsJson},
            (
              SELECT mentions_json
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          COALESCE(
            ${row.dispatchMode ?? null},
            (
              SELECT dispatch_mode
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          COALESCE(
            ${row.dispatchOrigin ?? null},
            (
              SELECT dispatch_origin
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          ${row.isStreaming ? 1 : 0},
          ${row.source},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = excluded.text,
          attachments_json = COALESCE(
            excluded.attachments_json,
            projection_thread_messages.attachments_json
          ),
          skills_json = COALESCE(
            excluded.skills_json,
            projection_thread_messages.skills_json
          ),
          mentions_json = COALESCE(
            excluded.mentions_json,
            projection_thread_messages.mentions_json
          ),
          dispatch_mode = COALESCE(
            excluded.dispatch_mode,
            projection_thread_messages.dispatch_mode
          ),
          dispatch_origin = COALESCE(
            excluded.dispatch_origin,
            projection_thread_messages.dispatch_origin
          ),
          is_streaming = excluded.is_streaming,
          source = excluded.source,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `;
    },
  });

  // Streaming deltas only ever grow `text`, so append in place. Reading the row back
  // and rewriting it per delta turns an n-character message built from k deltas into
  // O(n * k) bytes read and written.
  const appendProjectionThreadMessageText = SqlSchema.findAll({
    Request: AppendProjectionThreadMessageTextInput,
    Result: AppendedProjectionThreadMessageRowSchema,
    execute: (input) => {
      const nextAttachmentsJson =
        input.attachments !== undefined ? JSON.stringify(input.attachments) : null;
      const nextSkillsJson = input.skills !== undefined ? JSON.stringify(input.skills) : null;
      const nextMentionsJson = input.mentions !== undefined ? JSON.stringify(input.mentions) : null;
      return sql`
        UPDATE projection_thread_messages
        SET
          thread_id = ${input.threadId},
          turn_id = COALESCE(turn_id, ${input.turnId}),
          role = ${input.role},
          text = text || ${input.textDelta},
          attachments_json = COALESCE(${nextAttachmentsJson}, attachments_json),
          skills_json = COALESCE(${nextSkillsJson}, skills_json),
          mentions_json = COALESCE(${nextMentionsJson}, mentions_json),
          dispatch_mode = COALESCE(${input.dispatchMode ?? null}, dispatch_mode),
          dispatch_origin = COALESCE(${input.dispatchOrigin ?? null}, dispatch_origin),
          is_streaming = 1,
          source = ${input.source},
          updated_at = ${input.updatedAt}
        WHERE message_id = ${input.messageId}
        RETURNING message_id AS "messageId"
      `;
    },
  });

  const listProjectionThreadMessageRows = SqlSchema.findAll({
    Request: ListProjectionThreadMessagesInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          skills_json AS "skills",
          mentions_json AS "mentions",
          dispatch_mode AS "dispatchMode",
          dispatch_origin AS "dispatchOrigin",
          is_streaming AS "isStreaming",
          source,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, message_id ASC
      `,
  });

  const getProjectionThreadMessageRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadMessageInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ messageId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          skills_json AS "skills",
          mentions_json AS "mentions",
          dispatch_mode AS "dispatchMode",
          dispatch_origin AS "dispatchOrigin",
          is_streaming AS "isStreaming",
          source,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE message_id = ${messageId}
        LIMIT 1
      `,
  });

  const deleteProjectionThreadMessageRows = SqlSchema.void({
    Request: DeleteProjectionThreadMessagesInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_messages
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadMessageRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadMessageRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadMessageRepository.upsert:query")),
    );

  const appendStreamingText: ProjectionThreadMessageRepositoryShape["appendStreamingText"] = (
    input,
  ) =>
    appendProjectionThreadMessageText(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.appendStreamingText:query"),
      ),
      Effect.map((rows) => rows.length > 0),
    );

  const getByMessageId: ProjectionThreadMessageRepositoryShape["getByMessageId"] = (input) =>
    getProjectionThreadMessageRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.getByMessageId:query"),
      ),
      Effect.map(Option.map(toProjectionThreadMessage)),
    );

  const listByThreadId: ProjectionThreadMessageRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.listByThreadId:query"),
      ),
      Effect.map((rows) => rows.map(toProjectionThreadMessage)),
    );

  const deleteByThreadId: ProjectionThreadMessageRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    appendStreamingText,
    getByMessageId,
    listByThreadId,
    deleteByThreadId,
  } satisfies ProjectionThreadMessageRepositoryShape;
});

export const ProjectionThreadMessageRepositoryLive = Layer.effect(
  ProjectionThreadMessageRepository,
  makeProjectionThreadMessageRepository,
);
