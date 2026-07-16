import type { ModelSelection, ProviderKind } from "@t3tools/contracts";

export const COMPOSER_THREAD_MODES = ["orchestrator", "single-agent"] as const;
export type ComposerThreadMode = (typeof COMPOSER_THREAD_MODES)[number];

export const DEFAULT_COMPOSER_THREAD_MODE: ComposerThreadMode = "orchestrator";

export function composerThreadModeFromOrchestratorFlag(
  orchestratorMode: boolean,
): ComposerThreadMode {
  return orchestratorMode ? "orchestrator" : "single-agent";
}
export function orchestratorFlagFromComposerThreadMode(mode: ComposerThreadMode): boolean {
  return mode === "orchestrator";
}

export function resolveOrchestratorSeatModel(
  seatModels: readonly ModelSelection[],
  preferredProvider: ProviderKind | null | undefined,
): ModelSelection | null {
  if (preferredProvider) {
    const providerMatch = seatModels.find((selection) => selection.provider === preferredProvider);
    if (providerMatch) return providerMatch;
  }
  return seatModels[0] ?? null;
}
