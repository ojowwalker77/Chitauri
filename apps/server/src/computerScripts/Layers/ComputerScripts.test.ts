import * as fs from "node:fs/promises";
import OS from "node:os";
import * as nodePath from "node:path";

import { ProjectId, type ProjectDevServer } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { analyzeProjectArtifacts } from "./ComputerScripts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => fs.rm(path, { force: true, recursive: true })),
  );
});

async function makeProject(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
  await fs.writeFile(nodePath.join(path, "package.json"), JSON.stringify({ private: true }));
}

describe("Computer Scripts project artifact discovery", () => {
  it("keeps candidates project-owned, prunes dependency outputs, and excludes active projects", async () => {
    const root = await fs.mkdtemp(nodePath.join(OS.tmpdir(), "chitauri-computer-artifacts-"));
    temporaryDirectories.push(root);
    const project = nodePath.join(root, "project");
    const activeProject = nodePath.join(root, "active-project");
    await makeProject(project);
    await makeProject(activeProject);

    const expected = [
      nodePath.join(project, "dist"),
      nodePath.join(project, ".next", "cache"),
      nodePath.join(project, "node_modules", ".vite"),
    ];
    const excluded = [
      nodePath.join(root, "unowned", "build"),
      nodePath.join(project, "node_modules", "dependency", "dist"),
      nodePath.join(activeProject, "dist"),
    ];
    await Promise.all(
      [...expected, ...excluded].map(async (path) => {
        await fs.mkdir(path, { recursive: true });
        await fs.writeFile(nodePath.join(path, "artifact.txt"), "artifact");
      }),
    );

    const activeDevServers: ProjectDevServer[] = [
      {
        projectId: ProjectId.makeUnsafe("active-project"),
        command: "bun run dev",
        cwd: activeProject,
        pid: 123,
        startedAt: "2026-07-16T12:00:00.000Z",
        status: "running",
      },
    ];
    const result = await analyzeProjectArtifacts({
      roots: [root],
      options: { roots: [root], minAgeDays: 0, minBytes: 0, includeProtected: false },
      cwd: nodePath.join(root, "current-chitauri"),
      activeDevServers,
      signal: new AbortController().signal,
    });
    const candidatePaths = result.candidates.map((candidate) => candidate.path).toSorted();

    expect(candidatePaths).toEqual(expected.toSorted());
    for (const path of excluded) expect(candidatePaths).not.toContain(path);
  });
});
