// FILE: researchProjectResolution.ts
// Purpose: Resolve the project a research document originated from via its repository root.
// Layer: Web research helper
// Exports: resolveResearchProjectId

import type { NativeApi, OrchestrationShellSnapshot, ProjectId } from "@t3tools/contracts";
import { workspaceRootsEqual } from "@t3tools/shared/threadWorkspace";

import { createOrRecoverProjectFromPath } from "./projectCreation";

// Matches the document's repository root against known projects before falling back
// to creating (or recovering) a project for that root, so research handoffs land in
// the originating project instead of minting a duplicate.
export async function resolveResearchProjectId(input: {
  api: NativeApi;
  repositoryRoot: string;
  projects: ReadonlyArray<{ id: ProjectId; cwd: string }>;
  onSnapshot?: (snapshot: OrchestrationShellSnapshot) => void;
}): Promise<ProjectId> {
  const existing = input.projects.find((project) =>
    workspaceRootsEqual(project.cwd, input.repositoryRoot),
  );
  if (existing) return existing.id;
  const recovered = await createOrRecoverProjectFromPath({
    api: input.api,
    workspaceRoot: input.repositoryRoot,
    loadSnapshot: () => input.api.orchestration.getShellSnapshot().catch(() => null),
  });
  if (recovered.snapshot) input.onSnapshot?.(recovered.snapshot);
  return recovered.projectId;
}
