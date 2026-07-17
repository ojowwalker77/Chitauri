import { describe, expect, it } from "vitest";
import type { WorkLogEntry } from "../../session-logic";
import { sequenceWorkTrailEntries, summarizeWorkTrail } from "./workTrail";

function entry(id: string, overrides: Partial<WorkLogEntry>): WorkLogEntry {
  return {
    id,
    createdAt: `2026-07-16T12:00:0${id}.000Z`,
    label: id,
    tone: "tool",
    ...overrides,
  };
}

describe("workTrail", () => {
  it("preserves the original event order for the activity trail", () => {
    const entries = sequenceWorkTrailEntries([
      entry("1", { requestKind: "file-read" }),
      entry("2", { requestKind: "file-change", changedFiles: ["src/a.ts"] }),
      entry("3", { requestKind: "command", command: "bun run test src/a.test.ts" }),
      entry("4", { tone: "info", label: "Tasks updated" }),
    ]);

    expect(entries.map(({ entry: workEntry, sequence }) => [workEntry.id, sequence])).toEqual([
      ["1", 1],
      ["2", 2],
      ["3", 3],
      ["4", 4],
    ]);
  });

  it("deduplicates changed files in the trail summary", () => {
    expect(
      summarizeWorkTrail([
        entry("1", { changedFiles: ["src/a.ts", "src/b.ts"] }),
        entry("2", { changedFiles: ["src/a.ts"] }),
      ]),
    ).toEqual({ operationCount: 2, changedFileCount: 2 });
  });
});
