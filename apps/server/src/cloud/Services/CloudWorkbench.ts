import type {
  CloudDiscoverProjectInput,
  CloudInventoryResult,
  CloudListBindingsInput,
  CloudListBindingsResult,
  CloudListContextsResult,
  CloudProjectBinding,
  CloudProjectDiscoveryResult,
  CloudQueryLogsInput,
  CloudQueryLogsResult,
  CloudResourceDetailInput,
  CloudResourceDetailResult,
  CloudSearchResourcesInput,
  CloudUpsertBindingInput,
} from "@t3tools/contracts";
import { ServiceMap, type Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors";
import type { CloudOperationError } from "../Errors";

export type CloudWorkbenchError = CloudOperationError | ProjectionRepositoryError;

export interface CloudWorkbenchShape {
  readonly listContexts: () => Effect.Effect<CloudListContextsResult, CloudWorkbenchError>;
  readonly discoverProject: (
    input: CloudDiscoverProjectInput,
  ) => Effect.Effect<CloudProjectDiscoveryResult, CloudWorkbenchError>;
  readonly listBindings: (
    input: CloudListBindingsInput,
  ) => Effect.Effect<CloudListBindingsResult, CloudWorkbenchError>;
  readonly upsertBinding: (
    input: CloudUpsertBindingInput,
  ) => Effect.Effect<CloudProjectBinding, CloudWorkbenchError>;
  readonly searchResources: (
    input: CloudSearchResourcesInput,
  ) => Effect.Effect<CloudInventoryResult, CloudWorkbenchError>;
  readonly resourceDetail: (
    input: CloudResourceDetailInput,
  ) => Effect.Effect<CloudResourceDetailResult, CloudWorkbenchError>;
  readonly queryLogs: (
    input: CloudQueryLogsInput,
  ) => Effect.Effect<CloudQueryLogsResult, CloudWorkbenchError>;
}

export class CloudWorkbench extends ServiceMap.Service<CloudWorkbench, CloudWorkbenchShape>()(
  "t3/cloud/Services/CloudWorkbench",
) {}
