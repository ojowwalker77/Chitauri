import { describe, expect, it } from "vitest";
import { ProjectId } from "@t3tools/contracts";

import {
  DEFAULT_GITHUB_VIEW,
  buildGitHubAgentPrompt,
  findProjectForGitHubItem,
  groupGitHubItemsByRepository,
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

const issueInOtherRepo = {
  ...item,
  id: "issue:acme/widgets:3",
  kind: "issue" as const,
  repository: {
    nameWithOwner: "acme/widgets",
    name: "widgets",
    url: "https://github.com/acme/widgets",
  },
  number: 3,
  title: "Widget breaks",
  url: "https://github.com/acme/widgets/issues/3",
  updatedAt: "2026-07-16T00:00:00Z",
};

describe("GitHub workbench logic", () => {
  it("defaults to the All view", () => {
    expect(DEFAULT_GITHUB_VIEW).toBe("all");
  });

  it("groups pull requests and issues by repository, newest group first", () => {
    const olderIssueSameRepo = {
      ...item,
      id: "issue:ojowwalker77/Chitauri:4",
      kind: "issue" as const,
      number: 4,
      updatedAt: "2026-07-14T00:00:00Z",
    };
    const groups = groupGitHubItemsByRepository([[item], [issueInOtherRepo, olderIssueSameRepo]]);
    expect(groups.map((group) => group.repository.nameWithOwner)).toEqual([
      "acme/widgets",
      "ojowwalker77/Chitauri",
    ]);
    expect(groups[1]?.items.map((entry) => entry.id)).toEqual([
      item.id,
      "issue:ojowwalker77/Chitauri:4",
    ]);
  });

  it("deduplicates items that appear in multiple source lists", () => {
    const groups = groupGitHubItemsByRepository([[item], [item]]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(1);
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
});
