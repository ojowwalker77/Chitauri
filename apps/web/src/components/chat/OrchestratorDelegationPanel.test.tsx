import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
});
