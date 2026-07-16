import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import {
  ComputerScriptAnalysisId,
  ComputerScriptCandidateId,
  ComputerScriptRunId,
  type ComputerScriptCandidate,
  type ComputerScriptDescriptor,
  type ComputerScriptId,
  type ComputerScriptLogEntry,
  type ComputerScriptsAnalysisSnapshot,
  type ComputerScriptsOptions,
  type ComputerScriptsRunItemResult,
  type ComputerScriptsRunSnapshot,
  type ComputerScriptsStreamEvent,
} from "@t3tools/contracts";
import type { ProjectDevServer } from "@t3tools/contracts";
import { Effect, Layer, PubSub, Stream } from "effect";

import { ServerConfig } from "../../config";
import { DevServerManager } from "../../devServerManager";
import { runProcess } from "../../processRunner";
import { COMPUTER_SCRIPT_CATALOG, COMPUTER_SCRIPT_IDS, isKnownComputerScriptId } from "../catalog";
import {
  loadAndReconcileRunHistory,
  upsertRunHistory,
  writeRunHistoryAtomically,
} from "../receipts";
import {
  defaultProtectedRoots,
  encodeFingerprint,
  fingerprintDirectory,
  fingerprintMatches,
  isStrictlyInside,
  resolveApprovedRoots,
  validateDeletionTarget,
} from "../safety";
import { ComputerScripts, type ComputerScriptsShape } from "../Services/ComputerScripts";

type CandidateTarget =
  | {
      readonly kind: "directory";
      readonly path: string;
      readonly allowlist: "node_modules" | "artifact";
    }
  | {
      readonly kind: "tool";
      readonly tool: "pnpm" | "npm" | "bun" | "yarn";
      readonly path: string | null;
    };

interface AnalysisRecord {
  readonly roots: readonly string[];
  readonly targets: Map<ComputerScriptCandidateId, CandidateTarget>;
  snapshot: ComputerScriptsAnalysisSnapshot;
  controller: AbortController;
}

interface RunRecord {
  snapshot: ComputerScriptsRunSnapshot;
  controller: AbortController;
}

const MAX_SCAN_DEPTH = 8;
const MAX_CANDIDATES = 500;
const MAX_LOGS = 200;
const MAX_RECENT_ANALYSES = 20;
const PACKAGE_MANAGER_TIMEOUT_MS = 120_000;

function isoNow(): string {
  return new Date().toISOString();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function analysisId(): ComputerScriptAnalysisId {
  return ComputerScriptAnalysisId.makeUnsafe(`computer-analysis:${randomUUID()}`);
}

function runId(): ComputerScriptRunId {
  return ComputerScriptRunId.makeUnsafe(`computer-run:${randomUUID()}`);
}

function candidateId(): ComputerScriptCandidateId {
  return ComputerScriptCandidateId.makeUnsafe(`computer-candidate:${randomUUID()}`);
}

function appendLog(
  logs: readonly ComputerScriptLogEntry[],
  entry: Omit<ComputerScriptLogEntry, "at">,
) {
  return [...logs, { ...entry, at: isoNow() }].slice(-MAX_LOGS);
}

function emptyProgress(label: string | null = null) {
  return { current: 0, total: null, label, bytes: 0 };
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function lastRelevantMtime(path: string): Promise<number> {
  const names = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "package.json"];
  const mtimes = await Promise.all(
    names.map(async (name) => {
      try {
        return (await fs.stat(nodePath.join(path, "..", name))).mtimeMs;
      } catch {
        return 0;
      }
    }),
  );
  try {
    mtimes.push((await fs.stat(path)).mtimeMs);
  } catch {
    // ignored
  }
  return Math.max(...mtimes, 0);
}

function packageManagerHint(projectDir: string): string {
  void projectDir;
  return "npm/pnpm/yarn/bun";
}

function allowlistedNodeModules(path: string): boolean {
  return nodePath.basename(path) === "node_modules";
}

function allowlistedArtifact(path: string): boolean {
  const normalized = path.split(nodePath.sep).join("/");
  return (
    normalized.endsWith("/dist") ||
    normalized.endsWith("/build") ||
    normalized.endsWith("/.next/cache") ||
    normalized.endsWith("/.turbo") ||
    normalized.endsWith("/node_modules/.vite") ||
    normalized.endsWith("/.vite")
  );
}

function pathsOverlap(left: string, right: string): boolean {
  const resolvedLeft = nodePath.resolve(left);
  const resolvedRight = nodePath.resolve(right);
  return (
    resolvedLeft === resolvedRight ||
    isStrictlyInside(resolvedLeft, resolvedRight) ||
    isStrictlyInside(resolvedRight, resolvedLeft)
  );
}

async function hasProjectMarker(path: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(nodePath.join(path, "package.json"));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function owningProjectRootForArtifact(path: string): Promise<string | null> {
  const normalized = path.split(nodePath.sep).join("/");
  let projectRoot: string | null = null;
  if (normalized.endsWith("/node_modules/.vite")) {
    projectRoot = nodePath.dirname(nodePath.dirname(path));
  } else if (normalized.endsWith("/.next/cache")) {
    projectRoot = nodePath.dirname(nodePath.dirname(path));
  } else if (
    normalized.endsWith("/dist") ||
    normalized.endsWith("/build") ||
    normalized.endsWith("/.turbo") ||
    normalized.endsWith("/.vite")
  ) {
    projectRoot = nodePath.dirname(path);
  }
  return projectRoot && (await hasProjectMarker(projectRoot)) ? projectRoot : null;
}

function activeProjectReason(
  projectRoot: string,
  activeDevServers: readonly ProjectDevServer[],
): string | null {
  return activeDevServers.some((server) => pathsOverlap(projectRoot, server.cwd))
    ? "A Chitauri-managed dev server is active for this project."
    : null;
}

async function discoverDirectories(input: {
  readonly roots: readonly string[];
  readonly signal: AbortSignal;
  readonly match: (dir: string, entryName: string, depth: number) => boolean;
  readonly stopAtMatch: boolean;
  readonly shouldTraverse?: (dir: string, entryName: string, depth: number) => boolean;
}): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (input.signal.aborted || depth > MAX_SCAN_DEPTH || found.length >= MAX_CANDIDATES) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (input.signal.aborted || found.length >= MAX_CANDIDATES) return;
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = nodePath.join(dir, entry.name);
      if (entry.name === ".git") continue;
      if (input.match(child, entry.name, depth)) {
        found.push(child);
        if (input.stopAtMatch) continue;
      }
      if (input.shouldTraverse && !input.shouldTraverse(child, entry.name, depth)) continue;
      await walk(child, depth + 1);
    }
  }
  for (const root of input.roots) await walk(root, 0);
  return found;
}

async function makeDirectoryCandidate(input: {
  readonly path: string;
  readonly projectPath: string;
  readonly selectedByDefault: boolean;
  readonly protectedReason: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<ComputerScriptCandidate | null> {
  const fingerprint = await fingerprintDirectory(input.path, input.signal);
  if (!fingerprint) return null;
  return {
    id: candidateId(),
    label: nodePath.basename(input.path),
    path: input.path,
    bytes: fingerprint.bytes,
    selectedByDefault: input.selectedByDefault,
    protectedReason: input.protectedReason,
    fingerprint: encodeFingerprint(fingerprint),
    metadata: {
      project: input.projectPath,
      ...input.metadata,
    },
  };
}

async function analyzeNodeModules(input: {
  readonly roots: readonly string[];
  readonly options: ComputerScriptsOptions;
  readonly cwd: string;
  readonly activeDevServers: readonly ProjectDevServer[];
  readonly signal: AbortSignal;
}): Promise<{
  candidates: ComputerScriptCandidate[];
  targets: Map<ComputerScriptCandidateId, CandidateTarget>;
}> {
  const targets = new Map<ComputerScriptCandidateId, CandidateTarget>();
  const candidates: ComputerScriptCandidate[] = [];
  const minAgeMs = input.options.minAgeDays * 24 * 60 * 60 * 1_000;
  const now = Date.now();
  const dirs = await discoverDirectories({
    roots: input.roots,
    signal: input.signal,
    match: (_dir, name) => name === "node_modules",
    stopAtMatch: true,
  });
  for (const dir of dirs) {
    const projectRoot = nodePath.dirname(dir);
    const activeReason = activeProjectReason(projectRoot, input.activeDevServers);
    if (activeReason) continue;
    const relevantMtime = await lastRelevantMtime(dir);
    const ageDays = Math.max(0, Math.floor((now - relevantMtime) / (24 * 60 * 60 * 1_000)));
    const resolvedDir = nodePath.resolve(dir);
    const resolvedCwd = nodePath.resolve(input.cwd);
    const isCurrentProject =
      resolvedDir === resolvedCwd || isStrictlyInside(resolvedCwd, resolvedDir);
    const protectedReason = isCurrentProject ? "Current Chitauri project is protected." : null;
    const selectedByDefault = !protectedReason && now - relevantMtime >= minAgeMs;
    const candidate = await makeDirectoryCandidate({
      path: dir,
      projectPath: projectRoot,
      selectedByDefault: input.options.includeProtected
        ? selectedByDefault || Boolean(protectedReason)
        : selectedByDefault,
      protectedReason,
      metadata: {
        age: `${ageDays} days`,
        packageManager: packageManagerHint(nodePath.dirname(dir)),
        consequence: "Reinstall dependencies from the owning project.",
      },
      signal: input.signal,
    });
    if (!candidate || (candidate.bytes ?? 0) < input.options.minBytes) continue;
    candidates.push(candidate);
    targets.set(candidate.id, { kind: "directory", path: dir, allowlist: "node_modules" });
  }
  return { candidates, targets };
}

async function runTool(command: string, args: readonly string[], signal: AbortSignal) {
  return runProcess(command, args, {
    allowNonZeroExit: true,
    outputMode: "truncate",
    maxBufferBytes: 16_000,
    timeoutMs: PACKAGE_MANAGER_TIMEOUT_MS,
    signal,
  });
}

async function toolVersion(command: string, signal: AbortSignal): Promise<string | null> {
  const result = await runTool(command, ["--version"], signal).catch(() => null);
  if (!result || result.code !== 0) return null;
  return result.stdout.trim().split(/\s+/)[0] ?? null;
}

async function commandOutput(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<string | null> {
  const result = await runTool(command, args, signal).catch(() => null);
  if (!result || result.code !== 0) return null;
  return result.stdout.trim();
}

async function analyzePackageCaches(signal: AbortSignal): Promise<{
  candidates: ComputerScriptCandidate[];
  targets: Map<ComputerScriptCandidateId, CandidateTarget>;
}> {
  const targets = new Map<ComputerScriptCandidateId, CandidateTarget>();
  const candidates: ComputerScriptCandidate[] = [];
  const tools = [
    {
      tool: "pnpm" as const,
      title: "pnpm store prune",
      pathArgs: ["store", "path"] as const,
      consequence:
        "Official prune removes unreferenced packages; future installs may download again.",
    },
    {
      tool: "npm" as const,
      title: "npm cache verify",
      pathArgs: ["config", "get", "cache"] as const,
      consequence:
        "Verification garbage-collects and validates cache content without a full forced clear.",
    },
    {
      tool: "bun" as const,
      title: "bun pm cache rm",
      pathArgs: ["pm", "cache"] as const,
      consequence: "Clears Bun cache entries; future installs may download again.",
    },
    {
      tool: "yarn" as const,
      title: "yarn cache clean",
      pathArgs: ["cache", "dir"] as const,
      consequence: "Clears the detected Yarn cache scope; future installs may download again.",
    },
  ];
  for (const spec of tools) {
    const version = await toolVersion(spec.tool, signal);
    if (!version) continue;
    const cachePath = await commandOutput(spec.tool, spec.pathArgs, signal);
    const cacheFingerprint =
      cachePath && (await exists(cachePath))
        ? await fingerprintDirectory(cachePath, signal).catch(() => null)
        : null;
    const bytes = cacheFingerprint?.bytes ?? 0;
    const id = candidateId();
    candidates.push({
      id,
      label: spec.title,
      path: cachePath,
      bytes,
      selectedByDefault: spec.tool === "pnpm" || spec.tool === "npm",
      protectedReason: null,
      fingerprint: JSON.stringify({ tool: spec.tool, version, cachePath, bytes }),
      metadata: {
        tool: spec.tool,
        version,
        consequence: spec.consequence,
      },
    });
    targets.set(id, { kind: "tool", tool: spec.tool, path: cachePath });
  }
  return { candidates, targets };
}

export async function analyzeProjectArtifacts(input: {
  readonly roots: readonly string[];
  readonly options: ComputerScriptsOptions;
  readonly cwd: string;
  readonly activeDevServers: readonly ProjectDevServer[];
  readonly signal: AbortSignal;
}): Promise<{
  candidates: ComputerScriptCandidate[];
  targets: Map<ComputerScriptCandidateId, CandidateTarget>;
}> {
  const targets = new Map<ComputerScriptCandidateId, CandidateTarget>();
  const candidates: ComputerScriptCandidate[] = [];
  const dirs = await discoverDirectories({
    roots: input.roots,
    signal: input.signal,
    match: (dir, name) =>
      name === ".turbo" ||
      name === ".vite" ||
      name === "dist" ||
      name === "build" ||
      dir.split(nodePath.sep).slice(-2).join("/") === ".next/cache" ||
      dir.split(nodePath.sep).slice(-2).join("/") === "node_modules/.vite",
    stopAtMatch: true,
    shouldTraverse: (dir) => nodePath.basename(nodePath.dirname(dir)) !== "node_modules",
  });
  for (const dir of dirs.filter(allowlistedArtifact)) {
    const projectRoot = await owningProjectRootForArtifact(dir);
    if (!projectRoot || activeProjectReason(projectRoot, input.activeDevServers)) continue;
    const resolvedDir = nodePath.resolve(dir);
    const resolvedCwd = nodePath.resolve(input.cwd);
    const protectedReason =
      resolvedDir === resolvedCwd || isStrictlyInside(resolvedCwd, resolvedDir)
        ? "Current Chitauri project is protected."
        : null;
    const candidate = await makeDirectoryCandidate({
      path: dir,
      projectPath: projectRoot,
      selectedByDefault: input.options.includeProtected ? true : !protectedReason,
      protectedReason,
      metadata: {
        artifact: dir.split(nodePath.sep).slice(-2).join("/"),
        consequence: "Recreated by the project build tool.",
      },
      signal: input.signal,
    });
    if (!candidate || (candidate.bytes ?? 0) < input.options.minBytes) continue;
    candidates.push(candidate);
    targets.set(candidate.id, { kind: "directory", path: dir, allowlist: "artifact" });
  }
  return { candidates, targets };
}

async function removeDirectory(input: {
  readonly target: CandidateTarget;
  readonly candidate: ComputerScriptCandidate;
  readonly roots: readonly string[];
  readonly protectedRoots: readonly string[];
}): Promise<ComputerScriptsRunItemResult> {
  if (input.target.kind !== "directory") {
    return {
      candidateId: input.candidate.id,
      label: input.candidate.label,
      path: input.candidate.path,
      status: "failed",
      reason: "invalid_target",
      message: "Candidate is not a directory cleanup target.",
      bytes: 0,
    };
  }
  const validation = await validateDeletionTarget({
    target: input.target.path,
    roots: input.roots,
    protectedRoots: input.protectedRoots,
    allowlist:
      input.target.allowlist === "node_modules" ? allowlistedNodeModules : allowlistedArtifact,
  });
  if (!validation.ok) {
    return {
      candidateId: input.candidate.id,
      label: input.candidate.label,
      path: input.candidate.path,
      status: "skipped",
      reason: "invalid_target",
      message: validation.reason,
      bytes: 0,
    };
  }
  const currentFingerprint = await fingerprintDirectory(validation.realPath);
  if (!currentFingerprint || !fingerprintMatches(currentFingerprint, input.candidate.fingerprint)) {
    return {
      candidateId: input.candidate.id,
      label: input.candidate.label,
      path: input.candidate.path,
      status: "skipped",
      reason: "changed_since_analysis",
      message: "Target changed since analysis. Analyze again before removing it.",
      bytes: 0,
    };
  }
  try {
    await fs.rm(validation.realPath, { recursive: true, force: false });
    return {
      candidateId: input.candidate.id,
      label: input.candidate.label,
      path: input.candidate.path,
      status: "removed",
      reason: null,
      message: "Removed permanently.",
      bytes: input.candidate.bytes ?? 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove target.";
    return {
      candidateId: input.candidate.id,
      label: input.candidate.label,
      path: input.candidate.path,
      status: "failed",
      reason: /permission|eacces|eperm/i.test(message) ? "permission_denied" : "unknown",
      message,
      bytes: 0,
    };
  }
}

async function runPackageTool(
  target: Extract<CandidateTarget, { kind: "tool" }>,
  candidate: ComputerScriptCandidate,
  signal: AbortSignal,
): Promise<ComputerScriptsRunItemResult> {
  const commandByTool = {
    pnpm: ["store", "prune"],
    npm: ["cache", "verify"],
    bun: ["pm", "cache", "rm"],
    yarn: ["cache", "clean"],
  } as const;
  const before =
    target.path && (await exists(target.path))
      ? ((await fingerprintDirectory(target.path, signal).catch(() => null))?.bytes ?? 0)
      : 0;
  const result = await runTool(target.tool, commandByTool[target.tool], signal).catch((error) => {
    throw error instanceof Error ? error : new Error(String(error));
  });
  const after =
    target.path && (await exists(target.path))
      ? ((await fingerprintDirectory(target.path, signal).catch(() => null))?.bytes ?? 0)
      : 0;
  const message = [result.stderr.trim(), result.stdout.trim()]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);
  if (result.code !== 0) {
    return {
      candidateId: candidate.id,
      label: candidate.label,
      path: candidate.path,
      status: "failed",
      reason: "command_failed",
      message: message || `${target.tool} exited with code ${result.code ?? "null"}.`,
      bytes: 0,
    };
  }
  return {
    candidateId: candidate.id,
    label: candidate.label,
    path: candidate.path,
    status: "removed",
    reason: null,
    message: message || "Package-manager maintenance completed.",
    bytes: Math.max(0, before - after),
  };
}

export const ComputerScriptsLive = Layer.effect(
  ComputerScripts,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const devServerManager = yield* DevServerManager;
    const events = yield* PubSub.unbounded<ComputerScriptsStreamEvent>();
    const analyses = new Map<ComputerScriptAnalysisId, AnalysisRecord>();
    const runs = new Map<ComputerScriptRunId, RunRecord>();
    let activeRun: ComputerScriptRunId | null = null;
    const historyPath = nodePath.join(config.stateDir, "computer-scripts-runs.json");
    let history = yield* Effect.promise(() => loadAndReconcileRunHistory(historyPath, isoNow()));
    let latestRun = history[0] ?? null;
    for (const snapshot of history) {
      runs.set(snapshot.id, { snapshot, controller: new AbortController() });
    }
    const protectedRoots = defaultProtectedRoots({
      homeDir: config.homeDir,
      stateDir: config.stateDir,
      baseDir: config.baseDir,
    });

    const publish = (event: ComputerScriptsStreamEvent) => {
      void Effect.runPromise(PubSub.publish(events, event));
    };
    const persistRun = async (snapshot: ComputerScriptsRunSnapshot) => {
      const next = upsertRunHistory(history, snapshot);
      await writeRunHistoryAtomically(historyPath, next);
      history = next;
      latestRun = snapshot;
    };
    const descriptor = (id: ComputerScriptId): ComputerScriptDescriptor | null =>
      COMPUTER_SCRIPT_CATALOG.find((item) => item.id === id) ?? null;

    async function startAnalysisWork(record: AnalysisRecord) {
      try {
        const utility = record.snapshot.utilityId;
        let result: {
          candidates: ComputerScriptCandidate[];
          targets: Map<ComputerScriptCandidateId, CandidateTarget>;
        } | null = null;
        if (utility === COMPUTER_SCRIPT_IDS.nodeModules) {
          const { servers: activeDevServers } = await Effect.runPromise(devServerManager.list);
          result = await analyzeNodeModules({
            roots: record.roots,
            options: record.snapshot.options,
            cwd: config.cwd,
            activeDevServers,
            signal: record.controller.signal,
          });
        } else if (utility === COMPUTER_SCRIPT_IDS.packageCaches) {
          result = await analyzePackageCaches(record.controller.signal);
        } else if (utility === COMPUTER_SCRIPT_IDS.projectArtifacts) {
          const { servers: activeDevServers } = await Effect.runPromise(devServerManager.list);
          result = await analyzeProjectArtifacts({
            roots: record.roots,
            options: record.snapshot.options,
            cwd: config.cwd,
            activeDevServers,
            signal: record.controller.signal,
          });
        }
        if (record.controller.signal.aborted) throw new Error("cancelled");
        const candidates = result?.candidates ?? [];
        for (const [id, target] of result?.targets ?? []) record.targets.set(id, target);
        record.snapshot = {
          ...record.snapshot,
          state: "review",
          completedAt: isoNow(),
          candidates,
          estimatedBytes: candidates.reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0),
          progress: {
            current: candidates.length,
            total: candidates.length,
            label: "Analysis complete",
            bytes: candidates.reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0),
          },
          logs: appendLog(record.snapshot.logs, {
            level: "info",
            message: `Found ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}.`,
            target: null,
          }),
        };
      } catch (error) {
        const cancelled =
          record.controller.signal.aborted ||
          (error instanceof Error && error.message === "cancelled");
        record.snapshot = {
          ...record.snapshot,
          state: cancelled ? "cancelled" : "failed",
          completedAt: isoNow(),
          error: cancelled
            ? "Analysis cancelled."
            : error instanceof Error
              ? error.message
              : "Analysis failed.",
          logs: appendLog(record.snapshot.logs, {
            level: cancelled ? "warning" : "error",
            message: cancelled
              ? "Analysis cancelled."
              : error instanceof Error
                ? error.message
                : "Analysis failed.",
            target: null,
          }),
        };
      }
      publish({ type: "analysis", snapshot: record.snapshot });
    }

    async function startRunWork(record: RunRecord, analysis: AnalysisRecord) {
      try {
        const selected = record.snapshot.selectedCandidateIds.flatMap((id) => {
          const candidate = analysis.snapshot.candidates.find((item) => item.id === id);
          const target = analysis.targets.get(id);
          return candidate && target ? [{ candidate, target }] : [];
        });
        for (const [index, item] of selected.entries()) {
          if (record.controller.signal.aborted) break;
          let result: ComputerScriptsRunItemResult;
          if (item.candidate.protectedReason) {
            result = {
              candidateId: item.candidate.id,
              label: item.candidate.label,
              path: item.candidate.path,
              status: "skipped",
              reason: "active_target",
              message: item.candidate.protectedReason,
              bytes: 0,
            };
          } else if (item.target.kind === "tool") {
            result = await runPackageTool(item.target, item.candidate, record.controller.signal);
          } else {
            const { servers: activeDevServers } = await Effect.runPromise(devServerManager.list);
            const projectRoot = item.candidate.metadata.project;
            const activeReason = projectRoot
              ? activeProjectReason(projectRoot, activeDevServers)
              : null;
            result = activeReason
              ? {
                  candidateId: item.candidate.id,
                  label: item.candidate.label,
                  path: item.candidate.path,
                  status: "skipped",
                  reason: "active_target",
                  message: activeReason,
                  bytes: 0,
                }
              : await removeDirectory({
                  target: item.target,
                  candidate: item.candidate,
                  roots: analysis.roots,
                  protectedRoots,
                });
          }
          const results = [...record.snapshot.results, result];
          const reclaimedBytes = results.reduce((sum, entry) => sum + entry.bytes, 0);
          record.snapshot = {
            ...record.snapshot,
            results,
            reclaimedBytes,
            removedCount: results.filter((entry) => entry.status === "removed").length,
            skippedCount: results.filter((entry) => entry.status === "skipped").length,
            failedCount: results.filter((entry) => entry.status === "failed").length,
            progress: {
              current: index + 1,
              total: selected.length,
              label: item.candidate.label,
              bytes: reclaimedBytes,
            },
            logs: appendLog(record.snapshot.logs, {
              level:
                result.status === "failed"
                  ? "error"
                  : result.status === "skipped"
                    ? "warning"
                    : "info",
              message: result.message,
              target: result.path,
            }),
          };
          await persistRun(record.snapshot);
          publish({ type: "run", snapshot: record.snapshot });
        }
        const cancelled = record.controller.signal.aborted;
        const failed = record.snapshot.failedCount > 0;
        const skipped = record.snapshot.skippedCount > 0;
        record.snapshot = {
          ...record.snapshot,
          state: cancelled ? "cancelled" : failed || skipped ? "partial" : "completed",
          completedAt: isoNow(),
          error: cancelled ? "Run cancelled." : failed ? "Some targets failed." : null,
        };
      } catch (error) {
        record.snapshot = {
          ...record.snapshot,
          state: record.controller.signal.aborted ? "cancelled" : "failed",
          completedAt: isoNow(),
          error: record.controller.signal.aborted
            ? "Run cancelled."
            : error instanceof Error
              ? error.message
              : "Run failed.",
        };
      } finally {
        activeRun = null;
        await persistRun(record.snapshot).catch(() => undefined);
        publish({ type: "run", snapshot: record.snapshot });
      }
    }

    const catalog: ComputerScriptsShape["catalog"] = () =>
      Effect.succeed({
        utilities: COMPUTER_SCRIPT_CATALOG,
        availability: COMPUTER_SCRIPT_CATALOG.map((utility) => {
          const available = utility.platforms.some((platform) => platform === process.platform);
          return {
            utilityId: utility.id,
            available,
            reason: available ? null : "Unsupported platform.",
          };
        }),
        syncedAt: isoNow(),
      });

    const startAnalysis: ComputerScriptsShape["startAnalysis"] = (input) =>
      Effect.tryPromise({
        try: async () => {
          if (!isKnownComputerScriptId(input.utilityId) || !descriptor(input.utilityId)) {
            throw new Error("Unknown Computer Scripts utility.");
          }
          const roots = await resolveApprovedRoots({
            roots: input.options.roots,
            fallbackRoot: config.chatWorkspaceRoot,
            homeDir: config.homeDir,
            protectedRoots,
          });
          if (roots.length === 0 && input.utilityId !== COMPUTER_SCRIPT_IDS.packageCaches) {
            throw new Error("No approved scan roots were available.");
          }
          const id = analysisId();
          const controller = new AbortController();
          const snapshot: ComputerScriptsAnalysisSnapshot = {
            id,
            utilityId: input.utilityId,
            state: "analyzing",
            startedAt: isoNow(),
            completedAt: null,
            options: input.options,
            candidates: [],
            estimatedBytes: 0,
            progress: emptyProgress("Starting analysis"),
            logs: [],
            error: null,
          };
          const record: AnalysisRecord = { roots, targets: new Map(), snapshot, controller };
          analyses.set(id, record);
          while (analyses.size > MAX_RECENT_ANALYSES) {
            const oldestId = analyses.keys().next().value;
            if (!oldestId) break;
            const oldest = analyses.get(oldestId);
            if (oldest?.snapshot.state === "analyzing") break;
            analyses.delete(oldestId);
          }
          publish({ type: "analysis", snapshot });
          void startAnalysisWork(record);
          return { snapshot };
        },
        catch: toError,
      });

    const analysis: ComputerScriptsShape["analysis"] = (input) =>
      Effect.try({
        try: () => {
          const record = analyses.get(input.analysisId);
          if (!record) throw new Error("Analysis not found.");
          return record.snapshot;
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });

    const cancelAnalysis: ComputerScriptsShape["cancelAnalysis"] = (input) =>
      Effect.try({
        try: () => {
          const record = analyses.get(input.analysisId);
          if (!record) throw new Error("Analysis not found.");
          record.controller.abort();
          return record.snapshot;
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });

    const startRun: ComputerScriptsShape["startRun"] = (input) =>
      Effect.tryPromise({
        try: async () => {
          if (activeRun) throw new Error("Another Computer Scripts run is already active.");
          const analysis = analyses.get(input.analysisId);
          if (!analysis) throw new Error("Analysis not found.");
          if (analysis.snapshot.utilityId !== input.utilityId) {
            throw new Error("Utility does not match analysis.");
          }
          if (analysis.snapshot.state !== "review") {
            throw new Error("Analysis is not ready for review.");
          }
          const selected = input.candidateIds.filter((id) => analysis.targets.has(id));
          if (selected.length === 0) throw new Error("No valid candidates selected.");
          const id = runId();
          const snapshot: ComputerScriptsRunSnapshot = {
            id,
            analysisId: input.analysisId,
            utilityId: input.utilityId,
            state: "running",
            startedAt: isoNow(),
            completedAt: null,
            selectedCandidateIds: selected,
            estimatedBytes: analysis.snapshot.candidates
              .filter((candidate) => selected.includes(candidate.id))
              .reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0),
            reclaimedBytes: 0,
            removedCount: 0,
            skippedCount: 0,
            failedCount: 0,
            progress: { current: 0, total: selected.length, label: "Starting run", bytes: 0 },
            logs: [],
            results: [],
            error: null,
          };
          const record: RunRecord = { snapshot, controller: new AbortController() };
          runs.set(id, record);
          activeRun = id;
          try {
            await persistRun(snapshot);
          } catch (error) {
            runs.delete(id);
            activeRun = null;
            throw error;
          }
          publish({ type: "run", snapshot });
          void startRunWork(record, analysis);
          return { snapshot };
        },
        catch: toError,
      });

    const run: ComputerScriptsShape["run"] = (input) =>
      Effect.try({
        try: () => {
          const record = runs.get(input.runId);
          if (!record) throw new Error("Run not found.");
          return record.snapshot;
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });

    const cancelRun: ComputerScriptsShape["cancelRun"] = (input) =>
      Effect.try({
        try: () => {
          const record = runs.get(input.runId);
          if (!record) throw new Error("Run not found.");
          record.controller.abort();
          return record.snapshot;
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });

    const listHistory: ComputerScriptsShape["listHistory"] = (input) =>
      Effect.succeed({
        runs: history.slice(0, input.limit).map((run) => ({
          id: run.id,
          utilityId: run.utilityId,
          state: run.state,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          estimatedBytes: run.estimatedBytes,
          reclaimedBytes: run.reclaimedBytes,
          removedCount: run.removedCount,
          skippedCount: run.skippedCount,
          failedCount: run.failedCount,
        })),
      });

    const currentSnapshotEvents = (): ComputerScriptsStreamEvent[] => {
      const analysisEvents = [...analyses.values()]
        .map((record) => record.snapshot)
        .toSorted((left, right) => left.startedAt.localeCompare(right.startedAt))
        .map((snapshot): ComputerScriptsStreamEvent => ({ type: "analysis", snapshot }));
      return latestRun
        ? [...analysisEvents, { type: "run" as const, snapshot: latestRun }]
        : analysisEvents;
    };

    const streamEvents: ComputerScriptsShape["streamEvents"] = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(events);
        return Stream.concat(
          Stream.fromIterable(currentSnapshotEvents()),
          Stream.fromSubscription(subscription),
        );
      }),
    );

    return ComputerScripts.of({
      catalog,
      startAnalysis,
      analysis,
      cancelAnalysis,
      startRun,
      run,
      cancelRun,
      listHistory,
      streamEvents,
    });
  }),
);
