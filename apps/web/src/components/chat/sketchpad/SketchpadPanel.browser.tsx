import { page } from "vitest/browser";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "../../../index.css";

import type { SketchpadDocument } from "../../../lib/composerSketchpad";
import { DisclosureRegion } from "../../ui/DisclosureRegion";
import { SketchpadPanel } from "./SketchpadPanel";

function SketchpadHarness() {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<SketchpadDocument | null>(null);

  return (
    <div className="h-[800px] w-[900px]">
      <button
        type="button"
        data-testid="sketchpad-toggle"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Close" : "Open"} sketchpad
      </button>
      <DisclosureRegion open={open}>
        <SketchpadPanel
          compact={false}
          document={document}
          onClose={() => setOpen(false)}
          onDocumentChange={setDocument}
        />
      </DisclosureRegion>
      <output data-testid="sketchpad-document">{JSON.stringify(document)}</output>
    </div>
  );
}

describe("SketchpadPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("preserves the draft across disclosure changes and keeps clear undoable", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<SketchpadHarness />, { container: host });

    const toggle = page.getByTestId("sketchpad-toggle");
    await toggle.click();
    const surface = page.getByLabelText("Sketchpad canvas");
    await surface.click();
    const surfaceElement = surface.element();
    surfaceElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "t" }));
    await expect.element(page.getByLabelText("Note (T)")).toHaveAttribute("aria-pressed", "true");
    surfaceElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));

    const noteEditor = page.getByLabelText("Edit note");
    await noteEditor.fill("Request to implementation");
    noteEditor.element().blur();

    await vi.waitFor(() => {
      expect(page.getByTestId("sketchpad-document").element().textContent).toContain(
        "Request to implementation",
      );
    });

    surfaceElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await expect.element(toggle).toHaveTextContent("Close sketchpad");
    surfaceElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await expect.element(toggle).toHaveTextContent("Open sketchpad");

    await toggle.click();
    await expect.element(page.getByText("Request to implementation").first()).toBeVisible();

    await page.getByLabelText("Clear sketch (undoable)").click();
    await vi.waitFor(() => {
      expect(page.getByTestId("sketchpad-document").element().textContent).toBe("null");
    });

    await page.getByLabelText("Undo (Mod+Z)").click();
    await expect.element(page.getByText("Request to implementation").first()).toBeVisible();

    await screen.unmount();
    host.remove();
  });
});
