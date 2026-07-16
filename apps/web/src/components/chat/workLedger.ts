// FILE: workLedger.ts
// Purpose: Groups transcript work into stable, semantic ledger sections.
// Layer: Web chat presentation helper
// Exports: ledger grouping and summary helpers used by MessagesTimeline

import { isFileChangeWorkLogEntry, type WorkLogEntry } from "../../session-logic";
import { resolveCommandVisualKind } from "../../lib/toolCallLabel";

export type WorkLedgerSectionKind =
  | "explore"
  | "modify"
  | "run"
  | "coordinate"
  | "generate"
  | "status"
  | "tools";

export interface SequencedWorkLedgerEntry {
  entry: WorkLogEntry;
  sequence: number;
}

export interface WorkLedgerSection {
  kind: WorkLedgerSectionKind;
  label: string;
  entries: SequencedWorkLedgerEntry[];
}

export interface WorkLedgerSummary {
  operationCount: number;
  changedFileCount: number;
}

const SECTION_ORDER: ReadonlyArray<WorkLedgerSectionKind> = [
  "explore",
  "modify",
  "run",
  "coordinate",
  "generate",
  "status",
  "tools",
];

const SECTION_LABEL: Record<WorkLedgerSectionKind, string> = {
  explore: "Explore",
  modify: "Modify",
  run: "Run",
  coordinate: "Coordinate",
  generate: "Generate",
  status: "Status",
  tools: "Tools",
};

export function sequenceWorkLedgerEntries(
  entries: ReadonlyArray<WorkLogEntry>,
): SequencedWorkLedgerEntry[] {
  return entries.map((entry, index) => ({ entry, sequence: index + 1 }));
}

export function workLedgerSectionKind(entry: WorkLogEntry): WorkLedgerSectionKind {
  if (entry.tone !== "tool") {
    return "status";
  }

  if (isFileChangeWorkLogEntry(entry)) {
    return "modify";
  }

  if (
    entry.requestKind === "file-read" ||
    entry.itemType === "web_search" ||
    entry.itemType === "image_view"
  ) {
    return "explore";
  }

  const command = entry.command ?? entry.rawCommand;
  if (entry.requestKind === "command" || entry.itemType === "command_execution" || command) {
    return command && resolveCommandVisualKind(command) === "inspect" ? "explore" : "run";
  }

  if (
    entry.itemType === "collab_agent_tool_call" ||
    entry.itemType === "mcp_tool_call" ||
    entry.itemType === "dynamic_tool_call"
  ) {
    return "coordinate";
  }

  if (entry.itemType === "image_generation" || entry.automation) {
    return "generate";
  }

  return "tools";
}

export function groupWorkLedgerEntries(
  entries: ReadonlyArray<SequencedWorkLedgerEntry>,
): WorkLedgerSection[] {
  const byKind = new Map<WorkLedgerSectionKind, SequencedWorkLedgerEntry[]>();

  for (const entry of entries) {
    const kind = workLedgerSectionKind(entry.entry);
    const sectionEntries = byKind.get(kind);
    if (sectionEntries) {
      sectionEntries.push(entry);
    } else {
      byKind.set(kind, [entry]);
    }
  }

  return SECTION_ORDER.flatMap((kind) => {
    const sectionEntries = byKind.get(kind);
    return sectionEntries
      ? [
          {
            kind,
            label: SECTION_LABEL[kind],
            entries: sectionEntries,
          },
        ]
      : [];
  });
}

export function summarizeWorkLedger(entries: ReadonlyArray<WorkLogEntry>): WorkLedgerSummary {
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
