// FILE: composerSlashCommands.ts
// Purpose: Share Chitauri's built-in composer slash command names across web UI
//          parsing and server-side profile stats backfills.
// Layer: Shared runtime utility
// Exports: command-name constants and normalization helpers.

export const BUILT_IN_COMPOSER_SLASH_COMMANDS = [
  "clear",
  "compact",
  "model",
  "review",
  "fork",
  "status",
  "subagents",
  "fast",
  "export",
] as const;

/**
 * Commands TeaCode no longer offers. They stay recognized so historical prompts
 * that used them are not miscounted as skill invocations in profile stats.
 */
export const RETIRED_COMPOSER_SLASH_COMMANDS = ["plan", "default"] as const;

export type BuiltInComposerSlashCommand = (typeof BUILT_IN_COMPOSER_SLASH_COMMANDS)[number];

export function normalizeComposerSlashCommandName(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

export function isBuiltInComposerSlashCommandName(
  value: string,
): value is BuiltInComposerSlashCommand {
  const normalizedValue = normalizeComposerSlashCommandName(value);
  return BUILT_IN_COMPOSER_SLASH_COMMANDS.some((command) => command === normalizedValue);
}

/** True for any command name TeaCode itself owns today or owned in the past. */
export function isKnownComposerSlashCommandName(value: string): boolean {
  const normalizedValue = normalizeComposerSlashCommandName(value);
  return (
    isBuiltInComposerSlashCommandName(normalizedValue) ||
    RETIRED_COMPOSER_SLASH_COMMANDS.some((command) => command === normalizedValue)
  );
}
