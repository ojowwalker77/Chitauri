import { describe, expect, it } from "vitest";

import { resolveVoiceOrbState } from "./voiceFocus";

describe("resolveVoiceOrbState", () => {
  it("uses thinking for idle and non-working states", () => {
    expect(resolveVoiceOrbState({ isWorking: false, workEntries: [] })).toBe("thinking");
  });

  it("uses solving while the thread is working", () => {
    expect(resolveVoiceOrbState({ isWorking: true, workEntries: [] })).toBe("solving");
  });

  it("lets an active search override the generic working state", () => {
    expect(
      resolveVoiceOrbState({
        isWorking: true,
        workEntries: [
          {
            activityKind: "tool.updated",
            label: "Searching",
            toolName: "rg",
          },
        ],
      }),
    ).toBe("searching");
  });

  it("does not keep searching after the search tool completes", () => {
    expect(
      resolveVoiceOrbState({
        isWorking: true,
        workEntries: [
          {
            activityKind: "tool.completed",
            label: "Searched",
            toolName: "rg",
          },
        ],
      }),
    ).toBe("solving");
  });
});
