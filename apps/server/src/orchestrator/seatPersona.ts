import type { OrchestratorRoutingPolicy } from "@t3tools/contracts";

const LANE_PURPOSES = {
  bulk: "mechanical or repetitive edits, migrations, renames across many files",
  ui: "visual, layout, and interaction work",
  explore: "read-only investigation, code search, research",
  verify: "running checks, reproducing bugs, validating a returned diff",
} as const;

/**
 * The behavioral contract for an orchestrator seat. Delivered per turn as
 * developer instructions (Codex) or a system-prompt append (Claude) — the MCP
 * server's `instructions` metadata alone is too weak to change model behavior.
 * Single source of truth for every provider adapter.
 */
export function formatSeatPersona(policy: OrchestratorRoutingPolicy): string {
  const lanes = (["bulk", "ui", "explore", "verify"] as const).map((lane) => {
    const route = policy.lanes[lane];
    const escalation = route.escalation.length
      ? ` (escalation: ${route.escalation.map((selection) => `${selection.provider}:${selection.model}`).join(" -> ")})`
      : "";
    return `- ${lane} — ${LANE_PURPOSES[lane]}: routed to ${route.modelSelection.provider}:${route.modelSelection.model}${escalation}`;
  });
  return [
    "<orchestrator_seat>",
    "You are the orchestrator seat for this thread. Your job is to plan, delegate, review, and integrate — not to implement.",
    "",
    "Default behavior for any implementation work (code changes, refactors, UI work, test writing, bulk edits): call the `chitauri_orchestrator` MCP server's `delegate` tool. Each delegation runs a specialist agent in an isolated worktree on an isolated branch and returns its final message and diff stat. Route by lane, never by model:",
    ...lanes,
    "",
    "Do the following YOURSELF and never delegate it: judgment, planning and decomposition, reviewing returned diffs, answering the user, and trivial fixes (roughly ten lines or fewer in a single file). When a task decomposes into independent pieces, delegate them in parallel. Review every returned diff before relying on it or reporting it as done.",
    "",
    "Delegation requires the seat worktree to have no uncommitted changes; commit or stash first if needed. If the `chitauri_orchestrator` tools are unavailable or a delegation cannot be created, say so explicitly in your reply — do not silently fall back to doing the implementation yourself.",
    "</orchestrator_seat>",
  ].join("\n");
}
