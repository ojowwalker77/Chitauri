import { CloudProjectBinding, type CloudBindingId, type ProjectId } from "@t3tools/contracts";
import { Effect, Layer, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../../persistence/Errors";
import {
  CloudProjectBindings,
  type CloudProjectBindingsShape,
} from "../Services/CloudProjectBindings";

const CloudProjectBindingDbRow = CloudProjectBinding.mapFields(
  Struct.assign({ regions: Schema.fromJsonString(Schema.Array(Schema.String)) }),
);

const makeCloudProjectBindings = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listRows = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.NullOr(Schema.String) }),
    Result: CloudProjectBindingDbRow,
    execute: ({ projectId }) => sql`
      SELECT
        bindings.binding_id AS "id",
        bindings.project_id AS "projectId",
        bindings.context_id AS "contextId",
        bindings.environment,
        bindings.regions_json AS "regions",
        bindings.expected_account_id AS "expectedAccountId",
        bindings.expected_project_id AS "expectedProjectId",
        bindings.created_at AS "createdAt",
        bindings.updated_at AS "updatedAt"
      FROM cloud_project_bindings AS bindings
      INNER JOIN projection_projects AS projects ON projects.project_id = bindings.project_id
      WHERE (${projectId} IS NULL OR bindings.project_id = ${projectId})
        AND projects.deleted_at IS NULL
      ORDER BY bindings.environment ASC, bindings.created_at ASC, bindings.binding_id ASC
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ bindingId: Schema.String }),
    Result: CloudProjectBindingDbRow,
    execute: ({ bindingId }) => sql`
      SELECT
        bindings.binding_id AS "id",
        bindings.project_id AS "projectId",
        bindings.context_id AS "contextId",
        bindings.environment,
        bindings.regions_json AS "regions",
        bindings.expected_account_id AS "expectedAccountId",
        bindings.expected_project_id AS "expectedProjectId",
        bindings.created_at AS "createdAt",
        bindings.updated_at AS "updatedAt"
      FROM cloud_project_bindings AS bindings
      INNER JOIN projection_projects AS projects ON projects.project_id = bindings.project_id
      WHERE bindings.binding_id = ${bindingId}
        AND projects.deleted_at IS NULL
    `,
  });

  const upsertRow = SqlSchema.void({
    Request: CloudProjectBinding,
    execute: (binding) => sql`
      INSERT INTO cloud_project_bindings (
        binding_id,
        project_id,
        context_id,
        environment,
        regions_json,
        expected_account_id,
        expected_project_id,
        created_at,
        updated_at
      ) VALUES (
        ${binding.id},
        ${binding.projectId},
        ${binding.contextId},
        ${binding.environment},
        ${JSON.stringify(binding.regions)},
        ${binding.expectedAccountId},
        ${binding.expectedProjectId},
        ${binding.createdAt},
        ${binding.updatedAt}
      )
      ON CONFLICT (binding_id) DO UPDATE SET
        project_id = excluded.project_id,
        context_id = excluded.context_id,
        environment = excluded.environment,
        regions_json = excluded.regions_json,
        expected_account_id = excluded.expected_account_id,
        expected_project_id = excluded.expected_project_id,
        updated_at = excluded.updated_at
    `,
  });

  const removeRow = SqlSchema.void({
    Request: Schema.Struct({ bindingId: Schema.String }),
    execute: ({ bindingId }) => sql`
      DELETE FROM cloud_project_bindings WHERE binding_id = ${bindingId}
    `,
  });

  const list: CloudProjectBindingsShape["list"] = (projectId: ProjectId | null) =>
    listRows({ projectId }).pipe(
      Effect.mapError(toPersistenceSqlError("CloudProjectBindings.list:query")),
    );

  const getById: CloudProjectBindingsShape["getById"] = (bindingId: CloudBindingId) =>
    getRow({ bindingId }).pipe(
      Effect.mapError(toPersistenceSqlError("CloudProjectBindings.getById:query")),
    );

  const upsert: CloudProjectBindingsShape["upsert"] = (binding) =>
    upsertRow(binding).pipe(
      Effect.as(binding),
      Effect.mapError(toPersistenceSqlError("CloudProjectBindings.upsert:query")),
    );

  const remove: CloudProjectBindingsShape["remove"] = (bindingId) =>
    removeRow({ bindingId }).pipe(
      Effect.mapError(toPersistenceSqlError("CloudProjectBindings.remove:query")),
    );

  return { list, getById, upsert, remove } satisfies CloudProjectBindingsShape;
});

export const CloudProjectBindingsLive = Layer.effect(
  CloudProjectBindings,
  makeCloudProjectBindings,
);
