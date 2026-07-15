import type { ResearchDocument } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildResearchImplementationPrompt, buildResearchRevisionPrompt } from "./-research.shared";

const document: ResearchDocument = {
  id: "research-id",
  title: "Reliable transcript plan",
  summary: "Keep live output smooth.",
  format: "markdown",
  repositoryName: "Chitauri",
  repositoryRoot: "/repo/chitauri",
  worktreePath: "/repo/worktree",
  branch: "feature/research",
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z",
  storagePath: "chitauri/2026-07-15/reliable.md",
  referenceCount: 0,
  tags: [],
  content: "# Plan",
  documentPath: "/plans/reliable.md",
  manifestPath: "/plans/reliable.research.json",
  references: [],
};

describe("research prompts", () => {
  it("keeps composer revisions scoped to the durable artifact", () => {
    const prompt = buildResearchRevisionPrompt(document, "Add a rollout diagram.");
    expect(prompt).toContain(document.documentPath);
    expect(prompt).toContain(document.manifestPath!);
    expect(prompt).toContain("Add a rollout diagram.");
  });

  it("hands implementation a stable source of truth", () => {
    const prompt = buildResearchImplementationPrompt(document);
    expect(prompt).toContain("Implement the approved research plan");
    expect(prompt).toContain(document.documentPath);
    expect(prompt).toContain("source of truth");
  });
});
