import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Thread } from "~/types";

import { OrchestratorDelegationPanel } from "./OrchestratorDelegationPanel";

describe("OrchestratorDelegationPanel", () => {
  it("makes an empty orchestrator seat unmistakable", () => {
    const markup = renderToStaticMarkup(
      <OrchestratorDelegationPanel
        threads={[]}
        onOpenThread={vi.fn()}
        showOnboarding
        seatModel="gpt-5.6-sol"
      />,
    );

    expect(markup).toContain("Orchestrator is ready");
    expect(markup).toContain("Seat model: gpt-5.6-sol");
    expect(markup).toContain("Delegation stays visible in this thread");
  });

  it("stays out of the transcript after onboarding when there is no delegated work", () => {
    const markup = renderToStaticMarkup(
      <OrchestratorDelegationPanel threads={[]} onOpenThread={vi.fn()} />,
    );

    expect(markup).toBe("");
  });

  it("shows interrupted delegated work as needing attention", () => {
    const thread = {
      id: "thread-interrupted",
      title: "Interrupted delegation",
      modelSelection: { provider: "codex", model: "gpt-5.6-terra" },
      messages: [],
      error: null,
      latestTurn: { state: "interrupted" },
      session: { status: "ready", orchestrationStatus: "interrupted" },
      subagentRole: "bulk",
    } as unknown as Thread;

    const markup = renderToStaticMarkup(
      <OrchestratorDelegationPanel threads={[thread]} onOpenThread={vi.fn()} />,
    );

    expect(markup).toContain("Needs attention");
    expect(markup).toContain("interrupted before it finished");
    expect(markup).not.toContain("Ready to review");
  });
});
