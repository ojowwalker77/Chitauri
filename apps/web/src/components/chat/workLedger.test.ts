import { describe, expect, it } from "vitest";
import type { WorkLogEntry } from "../../session-logic";
import {
  groupWorkLedgerEntries,
  sequenceWorkLedgerEntries,
  summarizeWorkLedger,
  workLedgerSectionKind,
} from "./workLedger";

function entry(id: string, overrides: Partial<WorkLogEntry>): WorkLogEntry {
  return {
    id,
    createdAt: `2026-07-16T12:00:0${id}.000Z`,
    label: id,
    tone: "tool",
    ...overrides,
  };
}

describe("workLedger", () => {
  it("groups activity semantically while preserving original sequence numbers", () => {
    const sections = groupWorkLedgerEntries(
      sequenceWorkLedgerEntries([
        entry("1", { requestKind: "file-read" }),
        entry("2", { requestKind: "file-change", changedFiles: ["src/a.ts"] }),
        entry("3", { requestKind: "command", command: "bun run test src/a.test.ts" }),
        entry("4", { tone: "info", label: "Tasks updated" }),
      ]),
    );

    expect(sections.map((section) => section.label)).toEqual([
      "Explore",
      "Modify",
      "Run",
      "Status",
    ]);
    expect(sections.map((section) => section.entries[0]?.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("classifies read-only shell inspection as exploration", () => {
    expect(
      workLedgerSectionKind(
        entry("1", { itemType: "command_execution", command: "rg -n TODO apps/web/src" }),
      ),
    ).toBe("explore");
  });

  it("deduplicates changed files in the ledger summary", () => {
    expect(
      summarizeWorkLedger([
        entry("1", { changedFiles: ["src/a.ts", "src/b.ts"] }),
        entry("2", { changedFiles: ["src/a.ts"] }),
      ]),
    ).toEqual({ operationCount: 2, changedFileCount: 2 });
  });
});
