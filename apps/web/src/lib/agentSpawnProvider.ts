// FILE: agentSpawnProvider.ts
// Purpose: Detect which provider a backgrounded agent shells out to, from the command that spawned
//          it — e.g. `agy --model gemini-3.5-flash` -> gemini, `opencode run …` -> opencode,
//          `codex exec …` -> codex. Powers the per-agent provider icon in the composer fleet card.
// Layer: Web logic (pure, tested)

import type { ProviderKind } from "@t3tools/contracts";

// A spawn resolves either to a real ProviderKind (which has a ProviderIcon) or to "gemini", which
// has a Central icon asset but is not a first-class provider in Chitauri.
export type SpawnAgentProvider = ProviderKind | "gemini";

// Word-boundary matchers, ordered so a specific CLI wins. `opencode` is matched before any generic
// term, and `codex` never matches inside `opencode` (word boundary), so ordering is only a safety net.
const SPAWN_PROVIDER_MATCHERS: ReadonlyArray<readonly [RegExp, SpawnAgentProvider]> = [
  [/\bcodex\b/, "codex"],
  [/\bopencode\b/, "opencode"],
  [/\bagy\b|\bantigravity\b|\bgemini\b/, "gemini"],
  [/\bgrok\b/, "grok"],
  [/\bcursor-agent\b|\bcursor\b/, "cursor"],
  [/\bkilo\b/, "kilo"],
  [/\bclaude\b/, "claudeAgent"],
];

export function resolveSpawnAgentProvider(
  command: string | null | undefined,
): SpawnAgentProvider | null {
  if (!command) {
    return null;
  }
  const normalized = command.toLowerCase();
  for (const [matcher, provider] of SPAWN_PROVIDER_MATCHERS) {
    if (matcher.test(normalized)) {
      return provider;
    }
  }
  return null;
}
