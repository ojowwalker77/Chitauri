import type {
  GitHubWorkItemSummary,
  GitHubWorkListKind,
  GitHubWorkListView,
} from "@t3tools/contracts";

import type { Project } from "./types";

export const GITHUB_WORK_VIEWS: Record<
  GitHubWorkListKind,
  ReadonlyArray<{ value: GitHubWorkListView; label: string }>
> = {
  inbox: [{ value: "attention", label: "Action needed" }],
  pull_request: [
    { value: "reviewing", label: "Reviewing" },
    { value: "authored", label: "Authored" },
    { value: "assigned", label: "Assigned" },
    { value: "mentioned", label: "Mentioned" },
    { value: "participating", label: "Participating" },
    { value: "all", label: "All" },
  ],
  issue: [
    { value: "assigned", label: "Assigned" },
    { value: "authored", label: "Authored" },
    { value: "mentioned", label: "Mentioned" },
    { value: "participating", label: "Participating" },
    { value: "all", label: "All" },
  ],
};

export function defaultGitHubView(kind: GitHubWorkListKind): GitHubWorkListView {
  return GITHUB_WORK_VIEWS[kind][0]!.value;
}

export function githubReasonLabel(reason: string | null): string | null {
  switch (reason) {
    case "review_requested":
      return "Review requested";
    case "approval_requested":
      return "Approval requested";
    case "mention":
      return "Mentioned you";
    case "team_mention":
      return "Team mentioned";
    case "assign":
      return "Assigned to you";
    case "ci_activity":
      return "CI activity";
    case "comment":
      return "New comment";
    case "author":
      return "Your item changed";
    case "state_change":
      return "State changed";
    case "manual":
    case "subscribed":
      return "Subscribed update";
    default:
      return reason ? reason.replaceAll("_", " ") : null;
  }
}

const ACTIONABLE_GITHUB_REASONS = new Set([
  "review_requested",
  "approval_requested",
  "mention",
  "team_mention",
  "assign",
  "ci_activity",
]);

export function isActionableGitHubReason(reason: string | null): boolean {
  return reason !== null && ACTIONABLE_GITHUB_REASONS.has(reason);
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
    return `Review pull request ${target}: ${item.title}\n\nUse the checked-out PR as the source of truth. Inspect the full diff and relevant callers, verify every finding, and do not post anything to GitHub without my explicit approval.\n\n${item.url}`;
  }
  if (intent === "fix_ci") {
    return `Diagnose and fix the failing CI for pull request ${target}: ${item.title}. Inspect the exact failing checks and logs first, make the smallest robust fix, run focused verification, and leave all GitHub posting or merging for my explicit approval.\n\n${item.url}`;
  }
  return item.kind === "pull_request"
    ? `Work on pull request ${target}: ${item.title}. Inspect the PR description, checks, and unresolved review feedback, then implement and verify the required changes in this worktree. Do not merge or post to GitHub without my explicit approval.\n\n${item.url}`
    : `Implement GitHub issue ${target}: ${item.title}. Read the issue and repository context, identify the real acceptance criteria, implement a robust solution, and run focused verification. Do not create, close, or post to GitHub without my explicit approval.\n\n${item.url}`;
}

export function isGithubItemSnoozed(
  itemId: string,
  snoozedUntilByItemId: Readonly<Record<string, string>>,
  now = Date.now(),
): boolean {
  const until = snoozedUntilByItemId[itemId];
  return typeof until === "string" && Date.parse(until) > now;
}
