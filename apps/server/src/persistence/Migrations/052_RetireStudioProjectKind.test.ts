import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("052_RetireStudioProjectKind", (it) => {
  it.effect("registers the compatibility migration", () =>
    Effect.sync(() => {
      const entry = migrationEntries.find(([id]) => id === 52);
      assert.deepStrictEqual(entry?.slice(0, 2), [52, "RetireStudioProjectKind"]);
    }),
  );

  it.effect(
    "converts persisted Studio projects and event payloads without changing their data",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 51 });

        yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, default_model_selection_json,
          scripts_json, is_pinned, created_at, updated_at, deleted_at
        ) VALUES (
          'project-studio', 'studio', 'Studio', '/Users/tester/Documents/Chitauri/Studio',
          NULL, '[{"name":"build","command":"bun run build"}]', 0,
          '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', NULL
        )
      `;
        yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, env_mode, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-studio', 'project-studio', 'Existing chat',
          '{"instanceId":"codex","model":"gpt-5"}', 'full-access', 'default', 'local',
          '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', NULL
        )
      `;
        yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
        ) VALUES (
          'message-studio', 'thread-studio', NULL, 'user', 'Keep this chat', 0,
          '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'
        )
      `;
        yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
        ) VALUES (
          'event-studio', 'project', 'project-studio', 1, 'project.created',
          '2026-07-15T00:00:00.000Z', NULL, NULL, NULL, 'system',
          '{"projectId":"project-studio","kind":"studio","title":"Studio","workspaceRoot":"/Users/tester/Documents/Chitauri/Studio"}',
          '{}'
        )
      `;
        yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
        ) VALUES (
          'event-studio-meta', 'project', 'project-studio', 2, 'project.meta-updated',
          '2026-07-15T00:01:00.000Z', NULL, NULL, NULL, 'system',
          '{"projectId":"project-studio","kind":"studio","title":"Renamed Studio","updatedAt":"2026-07-15T00:01:00.000Z"}',
          '{}'
        )
      `;

        yield* runMigrations();

        const projects = yield* sql<{
          readonly kind: string;
          readonly scripts_json: string;
          readonly title: string;
          readonly workspace_root: string;
        }>`
        SELECT kind, title, workspace_root, scripts_json
        FROM projection_projects
        WHERE project_id = 'project-studio'
      `;
        assert.deepStrictEqual(projects, [
          {
            kind: "project",
            scripts_json: '[{"name":"build","command":"bun run build"}]',
            title: "Studio",
            workspace_root: "/Users/tester/Documents/Chitauri/Studio",
          },
        ]);

        const events = yield* sql<{
          readonly event_type: string;
          readonly kind: string;
          readonly title: string;
        }>`
        SELECT
          event_type,
          json_extract(payload_json, '$.kind') AS kind,
          json_extract(payload_json, '$.title') AS title
        FROM orchestration_events
        WHERE event_id IN ('event-studio', 'event-studio-meta')
        ORDER BY stream_version
      `;
        assert.deepStrictEqual(events, [
          { event_type: "project.created", kind: "project", title: "Studio" },
          { event_type: "project.meta-updated", kind: "project", title: "Renamed Studio" },
        ]);

        const chats = yield* sql<{
          readonly text: string;
          readonly thread_id: string;
          readonly title: string;
        }>`
        SELECT threads.thread_id, threads.title, messages.text
        FROM projection_threads AS threads
        INNER JOIN projection_thread_messages AS messages
          ON messages.thread_id = threads.thread_id
        WHERE threads.project_id = 'project-studio'
      `;
        assert.deepStrictEqual(chats, [
          { thread_id: "thread-studio", title: "Existing chat", text: "Keep this chat" },
        ]);
      }),
  );
});
