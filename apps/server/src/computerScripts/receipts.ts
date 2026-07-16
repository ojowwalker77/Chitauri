import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { ComputerScriptsRunSnapshot } from "@t3tools/contracts";

const MAX_HISTORY_ENTRIES = 50;

export async function readRunHistory(path: string): Promise<ComputerScriptsRunSnapshot[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as ComputerScriptsRunSnapshot[]) : [];
  } catch {
    return [];
  }
}

export async function writeRunHistoryAtomically(
  path: string,
  history: readonly ComputerScriptsRunSnapshot[],
): Promise<void> {
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(
      temporaryPath,
      JSON.stringify(history.slice(0, MAX_HISTORY_ENTRIES), null, 2),
    );
    await fs.rename(temporaryPath, path);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function upsertRunHistory(
  history: readonly ComputerScriptsRunSnapshot[],
  snapshot: ComputerScriptsRunSnapshot,
): ComputerScriptsRunSnapshot[] {
  return [snapshot, ...history.filter((run) => run.id !== snapshot.id)].slice(
    0,
    MAX_HISTORY_ENTRIES,
  );
}

export function reconcileInterruptedRuns(
  history: readonly ComputerScriptsRunSnapshot[],
  interruptedAt: string,
): { history: ComputerScriptsRunSnapshot[]; changed: boolean } {
  let changed = false;
  const next = history.map((run) => {
    if (run.state !== "running") return run;
    changed = true;
    return {
      ...run,
      state: "interrupted" as const,
      completedAt: interruptedAt,
      error: "Run interrupted because the Chitauri server restarted.",
      logs: [
        ...run.logs,
        {
          at: interruptedAt,
          level: "warning" as const,
          message: "Run interrupted by a server restart and was not resumed.",
          target: null,
        },
      ].slice(-200),
    };
  });
  return { history: next, changed };
}

export async function loadAndReconcileRunHistory(
  path: string,
  interruptedAt: string,
): Promise<ComputerScriptsRunSnapshot[]> {
  const persisted = await readRunHistory(path);
  const reconciled = reconcileInterruptedRuns(persisted, interruptedAt);
  if (reconciled.changed) await writeRunHistoryAtomically(path, reconciled.history);
  return reconciled.history;
}
