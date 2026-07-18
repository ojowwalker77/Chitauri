import type {
  CloudContextId,
  CloudContextSummary,
  CloudInventoryResult,
  CloudProjectBinding,
  CloudQueryLogsInput,
  CloudQueryLogsResult,
  CloudResourceDetailInput,
  CloudResourceDetailResult,
  CloudResourceSummary,
  CloudSearchResourcesInput,
} from "@t3tools/contracts";
import { Effect, Layer, ServiceMap } from "effect";

import { makeAwsCloudProviderAdapter } from "./adapters/aws";
import { makeGcpCloudProviderAdapter } from "./adapters/gcp";
import { CloudOperationError } from "./Errors";

export type CloudProviderInventoryPage = Pick<
  CloudInventoryResult,
  "nextCursor" | "completeness" | "warnings"
> & {
  readonly resources: ReadonlyArray<CloudResourceSummary>;
};

export type CloudProviderResourceDetail = Pick<
  CloudResourceDetailResult,
  "resource" | "health" | "activity" | "completeness" | "warnings"
>;

export type CloudProviderLogPage = Pick<
  CloudQueryLogsResult,
  "entries" | "completeness" | "warnings"
>;

export interface CloudProviderAdapter {
  readonly provider: "aws" | "gcp";
  readonly listContexts: () => Effect.Effect<ReadonlyArray<CloudContextSummary>>;
  readonly resolveContext: (
    contextId: CloudContextId,
  ) => Effect.Effect<CloudContextSummary, CloudOperationError>;
  readonly searchResources: (input: {
    readonly binding: CloudProjectBinding;
    readonly context: CloudContextSummary;
    readonly request: CloudSearchResourcesInput;
  }) => Effect.Effect<CloudProviderInventoryPage, CloudOperationError>;
  readonly resourceDetail: (input: {
    readonly binding: CloudProjectBinding;
    readonly context: CloudContextSummary;
    readonly request: CloudResourceDetailInput;
  }) => Effect.Effect<CloudProviderResourceDetail, CloudOperationError>;
  readonly queryLogs: (input: {
    readonly binding: CloudProjectBinding;
    readonly context: CloudContextSummary;
    readonly request: CloudQueryLogsInput;
  }) => Effect.Effect<CloudProviderLogPage, CloudOperationError>;
}

export interface CloudProviderRegistryShape {
  readonly listContexts: () => Effect.Effect<ReadonlyArray<CloudContextSummary>>;
  readonly resolveContext: (
    contextId: CloudContextId,
  ) => Effect.Effect<CloudContextSummary, CloudOperationError>;
  readonly searchResources: CloudProviderAdapter["searchResources"];
  readonly resourceDetail: CloudProviderAdapter["resourceDetail"];
  readonly queryLogs: CloudProviderAdapter["queryLogs"];
}

export class CloudProviderRegistry extends ServiceMap.Service<
  CloudProviderRegistry,
  CloudProviderRegistryShape
>()("t3/cloud/CloudProviderRegistry") {}

export function makeCloudProviderRegistry(
  adapters: ReadonlyArray<CloudProviderAdapter>,
): CloudProviderRegistryShape {
  const adapterForContext = (
    contextId: CloudContextId,
  ): Effect.Effect<CloudProviderAdapter, CloudOperationError> => {
    const adapter = adapters.find((candidate) => contextId.startsWith(`${candidate.provider}:`));
    if (adapter) return Effect.succeed(adapter);
    return Effect.fail(
      new CloudOperationError({
        code: "invalid_scope",
        operation: "resolveContext",
        detail: `Cloud context '${contextId}' uses an unsupported provider.`,
        retryable: false,
      }),
    );
  };

  const listContexts = () =>
    Effect.forEach(adapters, (adapter) => adapter.listContexts(), {
      concurrency: Math.min(adapters.length, 2),
    }).pipe(Effect.map((contexts) => contexts.flat()));

  const resolveContext: CloudProviderRegistryShape["resolveContext"] = (contextId) =>
    adapterForContext(contextId).pipe(
      Effect.flatMap((adapter) => adapter.resolveContext(contextId)),
    );

  const searchResources: CloudProviderRegistryShape["searchResources"] = (input) =>
    adapterForContext(input.context.id).pipe(
      Effect.flatMap((adapter) => adapter.searchResources(input)),
    );

  const resourceDetail: CloudProviderRegistryShape["resourceDetail"] = (input) =>
    adapterForContext(input.context.id).pipe(
      Effect.flatMap((adapter) => adapter.resourceDetail(input)),
    );

  const queryLogs: CloudProviderRegistryShape["queryLogs"] = (input) =>
    adapterForContext(input.context.id).pipe(Effect.flatMap((adapter) => adapter.queryLogs(input)));

  return { listContexts, resolveContext, searchResources, resourceDetail, queryLogs };
}

export const CloudProviderRegistryLive = Layer.succeed(
  CloudProviderRegistry,
  makeCloudProviderRegistry([makeAwsCloudProviderAdapter(), makeGcpCloudProviderAdapter()]),
);
