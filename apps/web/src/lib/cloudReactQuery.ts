import type {
  CloudListBindingsInput,
  CloudQueryLogsInput,
  CloudResourceDetailInput,
  CloudSearchResourcesInput,
  CloudUpsertBindingInput,
  ProjectId,
} from "@t3tools/contracts";
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const cloudQueryKeys = {
  all: ["cloud-workbench"] as const,
  contexts: () => ["cloud-workbench", "contexts"] as const,
  discovery: (projectId: ProjectId) => ["cloud-workbench", "discovery", projectId] as const,
  bindings: (input: CloudListBindingsInput) => ["cloud-workbench", "bindings", input] as const,
  inventory: (input: Omit<CloudSearchResourcesInput, "cursor">) =>
    ["cloud-workbench", "inventory", input] as const,
  aggregateInventory: (input: Omit<CloudSearchResourcesInput, "cursor">) =>
    ["cloud-workbench", "aggregate-inventory", input] as const,
  detail: (input: CloudResourceDetailInput | null) => ["cloud-workbench", "detail", input] as const,
};

export function cloudContextsQueryOptions() {
  return queryOptions({
    queryKey: cloudQueryKeys.contexts(),
    queryFn: () => ensureNativeApi().cloud.listContexts(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always" as const,
  });
}

export function cloudDiscoveryQueryOptions(projectId: ProjectId | null) {
  return queryOptions({
    queryKey: projectId
      ? cloudQueryKeys.discovery(projectId)
      : (["cloud-workbench", "discovery", null] as const),
    queryFn: () => {
      if (!projectId) throw new Error("Choose a repository before discovery.");
      return ensureNativeApi().cloud.discoverProject({ projectId });
    },
    enabled: projectId !== null,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function cloudBindingsQueryOptions(input: CloudListBindingsInput) {
  return queryOptions({
    queryKey: cloudQueryKeys.bindings(input),
    queryFn: () => ensureNativeApi().cloud.listBindings(input),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always" as const,
  });
}

export function cloudInventoryInfiniteQueryOptions(
  input: Omit<CloudSearchResourcesInput, "cursor"> | null,
) {
  return infiniteQueryOptions({
    queryKey: input
      ? cloudQueryKeys.inventory(input)
      : (["cloud-workbench", "inventory", null] as const),
    queryFn: ({ pageParam }) => {
      if (!input) throw new Error("Choose a cloud binding before loading inventory.");
      return ensureNativeApi().cloud.searchResources({ ...input, cursor: pageParam });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: input !== null,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function cloudInventoryPageQueryOptions(input: Omit<CloudSearchResourcesInput, "cursor">) {
  return queryOptions({
    queryKey: cloudQueryKeys.aggregateInventory(input),
    queryFn: () => ensureNativeApi().cloud.searchResources({ ...input, cursor: null }),
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function cloudResourceDetailQueryOptions(input: CloudResourceDetailInput | null) {
  return queryOptions({
    queryKey: cloudQueryKeys.detail(input),
    queryFn: () => {
      if (!input) throw new Error("Choose a cloud resource before loading detail.");
      return ensureNativeApi().cloud.resourceDetail(input);
    },
    enabled: input !== null,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function cloudUpsertBindingMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: ["cloud-workbench", "upsert-binding"] as const,
    mutationFn: (input: CloudUpsertBindingInput) => ensureNativeApi().cloud.upsertBinding(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cloudQueryKeys.all });
    },
  });
}

export function cloudQueryLogsMutationOptions() {
  return mutationOptions({
    mutationKey: ["cloud-workbench", "query-logs"] as const,
    mutationFn: (input: CloudQueryLogsInput) => ensureNativeApi().cloud.queryLogs(input),
  });
}
