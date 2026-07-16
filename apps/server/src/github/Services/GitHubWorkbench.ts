import type {
  GitHubConnectionInput,
  GitHubConnectionResult,
  GitHubPullRequestDiffInput,
  GitHubPullRequestDiffResult,
  GitHubWorkItemActionInput,
  GitHubWorkItemActionResult,
  GitHubWorkItemDetailInput,
  GitHubWorkItemDetailResult,
  GitHubWorkListInput,
  GitHubWorkListResult,
} from "@t3tools/contracts";
import { ServiceMap, type Effect } from "effect";

import type { GitHubCliError } from "../../git/Errors";

export interface GitHubWorkbenchShape {
  readonly connection: (
    input: GitHubConnectionInput,
  ) => Effect.Effect<GitHubConnectionResult, GitHubCliError>;
  readonly listWork: (
    input: GitHubWorkListInput,
  ) => Effect.Effect<GitHubWorkListResult, GitHubCliError>;
  readonly workItemDetail: (
    input: GitHubWorkItemDetailInput,
  ) => Effect.Effect<GitHubWorkItemDetailResult, GitHubCliError>;
  readonly pullRequestDiff: (
    input: GitHubPullRequestDiffInput,
  ) => Effect.Effect<GitHubPullRequestDiffResult, GitHubCliError>;
  readonly workItemAction: (
    input: GitHubWorkItemActionInput,
  ) => Effect.Effect<GitHubWorkItemActionResult, GitHubCliError>;
}

export class GitHubWorkbench extends ServiceMap.Service<GitHubWorkbench, GitHubWorkbenchShape>()(
  "t3/github/Services/GitHubWorkbench",
) {}
