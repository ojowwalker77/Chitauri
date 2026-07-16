import { describe, expect, it } from "vitest";
import { ProjectId } from "@t3tools/contracts";

import {
  buildGitHubAgentPrompt,
  defaultGitHubView,
  findProjectForGitHubItem,
  githubReasonLabel,
  isActionableGitHubReason,
  isGithubItemSnoozed,
} from "./githubWorkbench.logic";
import type { Project } from "./types";

const project: Project = {
  id: ProjectId.makeUnsafe("project-1"),
  kind: "project",
  name: "Chitauri",
  remoteName: "ojowwalker77/Chitauri",
  folderName: "Chitauri",
  localName: null,
  cwd: "/repo/Chitauri",
  defaultModelSelection: null,
  expanded: true,
  scripts: [],
};

const item = {
  id: "pull_request:ojowwalker77/Chitauri:9",
  notificationId: null,
  kind: "pull_request" as const,
  repository: {
    nameWithOwner: "ojowwalker77/Chitauri",
    name: "Chitauri",
    url: "https://github.com/ojowwalker77/Chitauri",
  },
  number: 9,
  title: "Fix right panel keybinding",
  url: "https://github.com/ojowwalker77/Chitauri/pull/9",
  state: "open" as const,
  isDraft: false,
  unread: false,
  reason: null,
  author: null,
  labels: [],
  assignees: [],
  commentsCount: 0,
  additions: 10,
  deletions: 2,
  changedFiles: 2,
  reviewDecision: null,
  checkStatus: null,
  createdAt: "2026-07-15T00:00:00Z",
  updatedAt: "2026-07-15T00:00:00Z",
};

describe("GitHub workbench logic", () => {
  it("chooses daily-work defaults per surface", () => {
    expect(defaultGitHubView("inbox")).toBe("attention");
    expect(defaultGitHubView("pull_request")).toBe("reviewing");
    expect(defaultGitHubView("issue")).toBe("assigned");
  });

  it("separates actionable reasons from noisy authored updates", () => {
    expect(githubReasonLabel("review_requested")).toBe("Review requested");
    expect(isActionableGitHubReason("review_requested")).toBe(true);
    expect(isActionableGitHubReason("author")).toBe(false);
  });

  it("matches GitHub work to an existing local project", () => {
    expect(findProjectForGitHubItem([project], item)?.id).toBe(project.id);
  });

  it("builds a safe agent handoff prompt", () => {
    const prompt = buildGitHubAgentPrompt(item, "review");
    expect(prompt.startsWith("$Splus PR Review")).toBe(true);
    expect(prompt).toContain("ojowwalker77/Chitauri#9");
    expect(prompt).toContain("post the verified review to GitHub");
  });

  it("hides only active snoozes", () => {
    expect(
      isGithubItemSnoozed(
        item.id,
        { [item.id]: "2026-07-16T00:00:00Z" },
        Date.parse("2026-07-15T00:00:00Z"),
      ),
    ).toBe(true);
    expect(
      isGithubItemSnoozed(
        item.id,
        { [item.id]: "2026-07-14T00:00:00Z" },
        Date.parse("2026-07-15T00:00:00Z"),
      ),
    ).toBe(false);
  });
});
