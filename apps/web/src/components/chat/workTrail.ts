// FILE: workTrail.ts
// Purpose: Keeps transcript work in stable event order and summarizes its outcomes.
// Layer: Web chat presentation helper
// Exports: sequencing and summary helpers used by MessagesTimeline

import type { WorkLogEntry } from "../../session-logic";

export interface SequencedWorkTrailEntry {
  entry: WorkLogEntry;
  sequence: number;
}

export interface WorkTrailSummary {
  operationCount: number;
  changedFileCount: number;
}

export function sequenceWorkTrailEntries(
  entries: ReadonlyArray<WorkLogEntry>,
): SequencedWorkTrailEntry[] {
  return entries.map((entry, index) => ({ entry, sequence: index + 1 }));
}

export function summarizeWorkTrail(entries: ReadonlyArray<WorkLogEntry>): WorkTrailSummary {
  const changedFiles = new Set<string>();
  for (const entry of entries) {
    for (const filePath of entry.changedFiles ?? []) {
      changedFiles.add(filePath);
    }
  }

  return {
    operationCount: entries.length,
    changedFileCount: changedFiles.size,
  };
}
