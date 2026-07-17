// FILE: projectFilter.ts
// Purpose: Shared, URL-backed project scope for repository-wide Research and GitHub views.
// Layer: Web routing logic

import type { ProjectId } from "@t3tools/contracts";

import type { Project } from "~/types";

export const ALL_PROJECTS_FILTER = "all" as const;

export interface ProjectFilterSearch {
  project?: string;
}

export function parseProjectFilterSearch(search: Record<string, unknown>): ProjectFilterSearch {
  const rawProject = search.project;
  if (typeof rawProject !== "string") return {};
  const project = rawProject.trim();
  return project.length > 0 ? { project } : {};
}

export function resolveProjectFilter(input: {
  projects: readonly Project[];
  searchProject: string | undefined;
  latestProjectId: ProjectId | null;
}): Project | null {
  if (input.searchProject === ALL_PROJECTS_FILTER) return null;

  return (
    input.projects.find((project) => project.id === input.searchProject) ??
    input.projects.find((project) => project.id === input.latestProjectId) ??
    input.projects[0] ??
    null
  );
}

export function projectFilterValue(project: Project | null): string {
  return project?.id ?? ALL_PROJECTS_FILTER;
}
