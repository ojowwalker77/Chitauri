// FILE: SidebarTreeMap.browser.tsx
// Purpose: Browser regression coverage for Tree Map branch and state labels.
// Layer: Vitest browser tests

import "../index.css";

import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { SidebarTreeBranchChip, SidebarTreeStatusPill } from "./SidebarTreeMap";

const workingStatus = {
  label: "Working",
  colorClass: "text-emerald-600 dark:text-emerald-300/90",
  dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
  pulse: true,
} as const;

describe("SidebarTreeMap", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders meaningful branches and explicit runtime state", async () => {
    const screen = await render(
      <div>
        <SidebarTreeBranchChip branch="agent/sidebar-tree-map" />
        <SidebarTreeBranchChip branch="main" />
        <SidebarTreeStatusPill status={workingStatus} label="2 live" />
      </div>,
    );

    try {
      expect(
        document.querySelector('[data-sidebar-tree-branch="sidebar-tree-map"]'),
      ).not.toBeNull();
      expect(document.querySelectorAll("[data-sidebar-tree-branch]")).toHaveLength(1);
      expect(document.querySelector('[data-sidebar-tree-status="Working"]')).not.toBeNull();
      expect(document.body.textContent ?? "").toContain("2 live");
    } finally {
      await screen.unmount();
    }
  });
});
