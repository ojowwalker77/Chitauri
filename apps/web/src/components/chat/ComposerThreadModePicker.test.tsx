import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerThreadModePicker } from "./ComposerThreadModePicker";

describe("ComposerThreadModePicker", () => {
  it.each([
    ["orchestrator", "Orchestrator"],
    ["single-agent", "Single Agent"],
  ] as const)("renders the active %s mode as composer state", (value, label) => {
    const markup = renderToStaticMarkup(
      <ComposerThreadModePicker value={value} onValueChange={vi.fn()} />,
    );

    expect(markup).toContain(label);
    expect(markup).toContain("data-testid=\"composer-thread-mode-trigger\"");
  });
});
