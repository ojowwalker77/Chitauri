import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ensureManagedResearchSkill,
  listResearchDocuments,
  readResearchDocument,
  researchPlansRoot,
} from "./researchLibrary";

describe("research library", () => {
  it("discovers a document with repository attribution and normalized references", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "chitauri-research-"));
    const documentDir = join(researchPlansRoot(baseDir), "chitauri", "2026-07-15");
    await mkdir(documentDir, { recursive: true });
    await writeFile(join(documentDir, "streaming-plan.md"), "# Streaming plan\n", "utf8");
    await writeFile(
      join(documentDir, "streaming-plan.research.json"),
      JSON.stringify({
        title: "Reliable streaming",
        summary: "Make reconnects predictable.",
        createdAt: "2026-07-15T10:00:00.000Z",
        repository: {
          name: "Chitauri",
          root: "/repo/chitauri",
          worktree: "/repo/worktrees/research",
          branch: "feature/research",
        },
        tags: ["streaming"],
        references: [
          {
            label: "Provider manager",
            kind: "file",
            target: "/repo/chitauri/apps/server/src/providerManager.ts",
            line: 42,
          },
          { label: "Codex docs", target: "https://developers.openai.com/codex/" },
        ],
      }),
      "utf8",
    );

    const listed = await listResearchDocuments(baseDir);
    expect(listed.documents).toHaveLength(1);
    expect(listed.documents[0]).toMatchObject({
      title: "Reliable streaming",
      repositoryName: "Chitauri",
      repositoryRoot: "/repo/chitauri",
      worktreePath: "/repo/worktrees/research",
      branch: "feature/research",
      referenceCount: 2,
      tags: ["streaming"],
    });

    const document = await readResearchDocument(baseDir, listed.documents[0]!.id);
    expect(document?.content).toBe("# Streaming plan\n");
    expect(document?.references[1]).toMatchObject({ kind: "url", label: "Codex docs" });
  });

  it("rejects invalid ids instead of reading outside the plans root", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "chitauri-research-"));
    const traversalId = Buffer.from("../../secrets.txt", "utf8").toString("base64url");
    expect(await readResearchDocument(baseDir, traversalId)).toBeNull();
  });

  it("installs and refreshes the managed research skill without replacing a user-owned copy", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "chitauri-research-"));
    const skillPath = await ensureManagedResearchSkill(baseDir);
    const managed = await readFile(skillPath, "utf8");
    expect(managed).toContain("name: research");
    expect(managed).toContain(researchPlansRoot(baseDir));

    await writeFile(
      skillPath,
      "---\nname: research\ndescription: Mine\n---\n\nKeep mine.\n",
      "utf8",
    );
    await ensureManagedResearchSkill(baseDir);
    expect(await readFile(skillPath, "utf8")).toContain("Keep mine.");
  });
});
