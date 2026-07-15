import type {
  GitHubPullRequestDiffInput,
  GitHubWorkItemActionInput,
  GitHubWorkItemDetailInput,
  GitHubWorkListInput,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const githubQueryKeys = {
  all: ["github-workbench"] as const,
  connection: (cwd: string | null) => ["github-workbench", "connection", cwd] as const,
  list: (input: GitHubWorkListInput) => ["github-workbench", "list", input] as const,
  detail: (input: GitHubWorkItemDetailInput) => ["github-workbench", "detail", input] as const,
  diff: (input: GitHubPullRequestDiffInput) => ["github-workbench", "diff", input] as const,
};

export function githubConnectionQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: githubQueryKeys.connection(cwd),
    queryFn: () => ensureNativeApi().github.connection({ cwd }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always" as const,
  });
}

export function githubWorkListQueryOptions(input: GitHubWorkListInput) {
  return queryOptions({
    queryKey: githubQueryKeys.list(input),
    queryFn: () => ensureNativeApi().github.listWork(input),
    staleTime: input.kind === "inbox" ? 30_000 : 60_000,
    refetchInterval: input.kind === "inbox" ? 60_000 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always" as const,
  });
}

export function githubWorkItemDetailQueryOptions(
  input: GitHubWorkItemDetailInput | null,
) {
  return queryOptions({
    queryKey: input ? githubQueryKeys.detail(input) : ["github-workbench", "detail", null],
    queryFn: () => {
      if (!input) throw new Error("No GitHub item is selected.");
      return ensureNativeApi().github.workItemDetail(input);
    },
    enabled: input !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always" as const,
  });
}

export function githubPullRequestDiffQueryOptions(
  input: GitHubPullRequestDiffInput | null,
  enabled = true,
) {
  return queryOptions({
    queryKey: input ? githubQueryKeys.diff(input) : ["github-workbench", "diff", null],
    queryFn: () => {
      if (!input) throw new Error("No pull request is selected.");
      return ensureNativeApi().github.pullRequestDiff(input);
    },
    enabled: enabled && input !== null,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function githubWorkItemActionMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: ["github-workbench", "action"] as const,
    mutationFn: (input: GitHubWorkItemActionInput) =>
      ensureNativeApi().github.workItemAction(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: githubQueryKeys.all });
    },
  });
}
