import type { ComputerScriptDescriptor, ComputerScriptId } from "@t3tools/contracts";

export const COMPUTER_SCRIPT_IDS = {
  nodeModules: "computer-script:old-node-modules",
  packageCaches: "computer-script:package-caches",
  projectArtifacts: "computer-script:project-artifacts",
} as const satisfies Record<string, ComputerScriptId>;

export const COMPUTER_SCRIPT_CATALOG: ReadonlyArray<ComputerScriptDescriptor> = [
  {
    id: COMPUTER_SCRIPT_IDS.nodeModules,
    title: "Old node_modules",
    summary: "Find dependency folders under selected roots without following symlinks.",
    category: "developer-cleanup",
    platforms: ["darwin", "linux", "win32"],
    risk: "redownload",
    consequence: "Removed folders are permanently deleted and must be recreated by installing dependencies again.",
    capabilities: { analyze: true, cancel: true },
  },
  {
    id: COMPUTER_SCRIPT_IDS.packageCaches,
    title: "Package caches",
    summary: "Inspect pnpm, npm, Bun, and Yarn caches with tool-aware commands.",
    category: "package-cache",
    platforms: ["darwin", "linux", "win32"],
    risk: "redownload",
    consequence: "Cleared cache entries may need to be downloaded again during future installs.",
    capabilities: { analyze: true, cancel: true },
  },
  {
    id: COMPUTER_SCRIPT_IDS.projectArtifacts,
    title: "Project build artifacts",
    summary: "Clean conservative project-local build outputs like .next/cache, .turbo, dist, and Vite caches.",
    category: "project-artifact",
    platforms: ["darwin", "linux", "win32"],
    risk: "low",
    consequence: "Build tools recreate these artifacts on the next run.",
    capabilities: { analyze: true, cancel: true },
  },
];

export function isKnownComputerScriptId(id: ComputerScriptId): boolean {
  return COMPUTER_SCRIPT_CATALOG.some((descriptor) => descriptor.id === id);
}
