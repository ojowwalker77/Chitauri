import type {
  GitHubWorkItemSummary,
  GitHubWorkListView,
  GitHubRepositorySummary,
} from "@t3tools/contracts";

import type { Project } from "./types";

export const GITHUB_WORK_VIEWS: ReadonlyArray<{ value: GitHubWorkListView; label: string }> = [
  { value: "all", label: "All" },
  { value: "reviewing", label: "Reviewing" },
  { value: "authored", label: "Authored" },
  { value: "assigned", label: "Assigned" },
  { value: "mentioned", label: "Mentioned" },
  { value: "participating", label: "Participating" },
];

export const DEFAULT_GITHUB_VIEW: GitHubWorkListView = "all";

export interface GitHubRepositoryGroup {
  repository: GitHubRepositorySummary;
  items: GitHubWorkItemSummary[];
}

// Merges pull requests and issues into repository sections. Groups are ordered by
// their most recently updated item, items within a group newest-first with pull
// requests and issues interleaved.
export function groupGitHubItemsByRepository(
  lists: ReadonlyArray<readonly GitHubWorkItemSummary[]>,
): GitHubRepositoryGroup[] {
  const byRepo = new Map<string, GitHubRepositoryGroup>();
  const seenIds = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      const key = item.repository.nameWithOwner.toLowerCase();
      const group = byRepo.get(key);
      if (group) group.items.push(item);
      else byRepo.set(key, { repository: item.repository, items: [item] });
    }
  }
  const groups = [...byRepo.values()];
  for (const group of groups) {
    group.items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  groups.sort((left, right) =>
    (right.items[0]?.updatedAt ?? "").localeCompare(left.items[0]?.updatedAt ?? ""),
  );
  return groups;
}

export function findProjectForGitHubItem(
  projects: readonly Project[],
  item: Pick<GitHubWorkItemSummary, "repository">,
): Project | null {
  const ownerRepo = item.repository.nameWithOwner.toLowerCase();
  const repoName = item.repository.name.toLowerCase();
  return (
    projects.find((project) => {
      const candidates = [
        project.name,
        project.remoteName,
        project.localName,
        project.folderName,
        project.cwd.split("/").at(-1),
      ]
        .filter((candidate): candidate is string => typeof candidate === "string")
        .map((candidate) => candidate.toLowerCase());
      return candidates.includes(ownerRepo) || candidates.includes(repoName);
    }) ?? null
  );
}

export function buildGitHubAgentPrompt(
  item: GitHubWorkItemSummary,
  intent: "work" | "review" | "fix_ci",
): string {
  const target = `${item.repository.nameWithOwner}#${item.number}`;
  if (intent === "review") {
    return `$Splus PR Review\n\nReview pull request ${target}: ${item.title}\n\nUse the checked-out PR as the source of truth. Run the full Splus PR Review workflow and post the verified review to GitHub.\n\n${item.url}`;
  }
  if (intent === "fix_ci") {
    return `Diagnose and fix the failing CI for pull request ${target}: ${item.title}. Inspect the exact failing checks and logs first, make the smallest robust fix, run focused verification, and leave all GitHub posting or merging for my explicit approval.\n\n${item.url}`;
  }
  return item.kind === "pull_request"
    ? `Work on pull request ${target}: ${item.title}. Inspect the PR description, checks, and unresolved review feedback, then implement and verify the required changes in this worktree. Do not merge or post to GitHub without my explicit approval.\n\n${item.url}`
    : `Implement GitHub issue ${target}: ${item.title}. Read the issue and repository context, identify the real acceptance criteria, implement a robust solution, and run focused verification. Do not create, close, or post to GitHub without my explicit approval.\n\n${item.url}`;
}
