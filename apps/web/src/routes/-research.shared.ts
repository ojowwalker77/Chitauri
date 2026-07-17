// FILE: -research.shared.ts
// Purpose: Shared queries and prompt builders for the Research workspace.
// Layer: Web research domain helpers

import type { ResearchDocument } from "@t3tools/contracts";

import { ensureNativeApi } from "~/nativeApi";

export const researchQueryKeys = {
  all: ["research"] as const,
  list: () => ["research", "list"] as const,
  detail: (id: string) => ["research", "detail", id] as const,
};

export function researchListQueryOptions() {
  return {
    queryKey: researchQueryKeys.list(),
    queryFn: () => ensureNativeApi().research.list({}),
    staleTime: 2_000,
  };
}

export function researchDetailQueryOptions(id: string) {
  return {
    queryKey: researchQueryKeys.detail(id),
    queryFn: () => ensureNativeApi().research.read({ id }),
    staleTime: 750,
    refetchInterval: 1_500,
  };
}

export function buildResearchRevisionPrompt(document: ResearchDocument, request: string): string {
  const manifestInstruction = document.manifestPath
    ? `Keep its metadata manifest synchronized at ${document.manifestPath}. Update updatedAt and references when the source set changes.`
    : "Create the sibling .research.json manifest required by the /research skill before finishing.";
  return [
    "You are polishing an existing TeaCode Research artifact.",
    `Edit the document in place at: ${document.documentPath}`,
    manifestInstruction,
    "Preserve its strongest material and visual quality. Inspect the current file before editing, then validate the result.",
    "The user's requested change follows:",
    request,
  ].join("\n\n");
}

export function buildResearchImplementationPrompt(document: ResearchDocument): string {
  return [
    `Implement the approved research plan: ${document.title}`,
    `Research artifact: ${document.documentPath}`,
    document.manifestPath ? `Reference manifest: ${document.manifestPath}` : null,
    "Treat the artifact as the source of truth, verify its claims against the current checkout, preserve its constraints, implement the work end to end, and report any material divergence.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}
