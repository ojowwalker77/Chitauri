// FILE: taskArtifacts.ts
// Purpose: Shared typed labels for durable Task result artifacts.

import type { TaskArtifactKind } from "@t3tools/contracts";

export const TASK_ARTIFACT_KIND_LABELS: Record<TaskArtifactKind, string> = {
  commit: "Commit",
  diff: "Diff",
  branch: "Branch",
  pull_request: "Pull request",
  file: "File",
  contract: "API contract",
  screenshot: "Screenshot",
  plan: "Plan",
  test_report: "Test report",
  build_log: "Build log",
  review: "Review findings",
  release_notes: "Release notes",
  link: "Link",
};

export const TASK_ARTIFACT_KINDS = Object.keys(TASK_ARTIFACT_KIND_LABELS) as TaskArtifactKind[];
