import type { CloudBindingId, CloudProjectBinding, ProjectId } from "@t3tools/contracts";
import { ServiceMap, type Effect, type Option } from "effect";

import type { PersistenceSqlError } from "../../persistence/Errors";

export interface CloudProjectBindingsShape {
  readonly list: (
    projectId: ProjectId | null,
  ) => Effect.Effect<ReadonlyArray<CloudProjectBinding>, PersistenceSqlError>;
  readonly getById: (
    bindingId: CloudBindingId,
  ) => Effect.Effect<Option.Option<CloudProjectBinding>, PersistenceSqlError>;
  readonly upsert: (
    binding: CloudProjectBinding,
  ) => Effect.Effect<CloudProjectBinding, PersistenceSqlError>;
  readonly remove: (bindingId: CloudBindingId) => Effect.Effect<void, PersistenceSqlError>;
}

export class CloudProjectBindings extends ServiceMap.Service<
  CloudProjectBindings,
  CloudProjectBindingsShape
>()("t3/cloud/Services/CloudProjectBindings") {}
