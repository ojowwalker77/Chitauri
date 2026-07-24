export type VoiceOrbState = "thinking" | "solving" | "searching";

interface VoiceWorkEntry {
  readonly activityKind?: string;
  readonly label: string;
  readonly toolTitle?: string;
  readonly toolName?: string;
  readonly command?: string;
}

const ACTIVE_TOOL_ACTIVITY_KINDS = new Set(["tool.started", "tool.updated"]);
const SEARCH_ACTIVITY_PATTERN = /\b(?:search|searching|find|finding|grep|rg)\b/i;

export function isActiveVoiceSearch(entry: VoiceWorkEntry): boolean {
  if (!entry.activityKind || !ACTIVE_TOOL_ACTIVITY_KINDS.has(entry.activityKind)) {
    return false;
  }

  return SEARCH_ACTIVITY_PATTERN.test(
    [entry.toolTitle, entry.label, entry.toolName, entry.command].filter(Boolean).join(" "),
  );
}

export function resolveVoiceOrbState(input: {
  readonly isWorking: boolean;
  readonly workEntries: ReadonlyArray<VoiceWorkEntry>;
}): VoiceOrbState {
  if (input.workEntries.some(isActiveVoiceSearch)) {
    return "searching";
  }
  return input.isWorking ? "solving" : "thinking";
}
