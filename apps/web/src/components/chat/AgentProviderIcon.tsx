// FILE: AgentProviderIcon.tsx
// Purpose: Render the icon of the provider a background agent actually runs on — detected from the
//          command that spawned it (agy→gemini, opencode→opencode, codex→codex, …), falling back to
//          the session provider (for Claude Task subagents that carry no command) and finally a dot.
// Layer: Chat composer UI
// Exports: AgentProviderIcon

import type { ProviderKind } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { GeminiBrandIcon } from "../../lib/brandIcons";
import { resolveSpawnAgentProvider } from "../../lib/agentSpawnProvider";
import { cn } from "~/lib/utils";
import { OpenCodeIcon } from "../Icons";
import { ProviderIcon } from "../ProviderIcon";

interface AgentProviderIconProps {
  spawnCommand: string | null | undefined;
  sessionProvider: ProviderKind | null;
  className?: string;
  fallback: ReactNode;
}

export function AgentProviderIcon({
  spawnCommand,
  sessionProvider,
  className,
  fallback,
}: AgentProviderIconProps) {
  const resolved = resolveSpawnAgentProvider(spawnCommand);
  // gemini (via the `agy` CLI) is not a first-class ProviderKind — use the brand-colored star.
  if (resolved === "gemini") {
    return <GeminiBrandIcon aria-hidden className={cn("size-3.5", className)} />;
  }
  // opencode renders via its SVG component directly (not via ProviderIcon, which switches to a
  // monochrome CentralIcon mask in dark mode).
  if (resolved === "opencode") {
    return <OpenCodeIcon aria-hidden className={cn("size-3.5", className)} />;
  }
  return (
    <ProviderIcon
      provider={resolved ?? sessionProvider}
      className={className}
      fallback={fallback}
    />
  );
}
