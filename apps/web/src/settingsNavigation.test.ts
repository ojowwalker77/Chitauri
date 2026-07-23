import { describe, expect, it } from "vitest";

import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_NAV_ITEMS,
  SETTINGS_SECTION_IDS,
  normalizeSettingsSection,
} from "./settingsNavigation";
import { SETTINGS_SEARCH_ENTRIES } from "./settingsSearchIndex";

describe("settings taxonomy", () => {
  it("gives every section exactly one nav item", () => {
    const navSectionIds = SETTINGS_NAV_ITEMS.map((item) => item.id);
    expect(navSectionIds.toSorted()).toEqual([...SETTINGS_SECTION_IDS].toSorted());
    expect(new Set(navSectionIds).size).toBe(navSectionIds.length);
  });

  it("puts every nav item in a declared group, and leaves no group empty", () => {
    const groupIds = new Set(SETTINGS_NAV_GROUPS.map((group) => group.id));
    for (const item of SETTINGS_NAV_ITEMS) {
      expect(groupIds.has(item.group)).toBe(true);
    }
    for (const group of SETTINGS_NAV_GROUPS) {
      expect(SETTINGS_NAV_ITEMS.some((item) => item.group === group.id)).toBe(true);
    }
  });

  // A section with no search entries is unreachable from the settings search box,
  // which is how rows quietly went missing before the regrouping.
  it("leaves no section without searchable rows", () => {
    for (const sectionId of SETTINGS_SECTION_IDS) {
      const entries = SETTINGS_SEARCH_ENTRIES.filter((entry) => entry.section === sectionId);
      expect(entries.length, `section '${sectionId}' has no search entries`).toBeGreaterThan(0);
    }
  });

  it("points every search entry at a real section", () => {
    const sectionIds = new Set<string>(SETTINGS_SECTION_IDS);
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      expect(sectionIds.has(entry.section), `entry '${entry.id}' has an unknown section`).toBe(
        true,
      );
    }
  });

  it("keeps search entry ids unique", () => {
    const ids = SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Saved URLs and deep links outlive a taxonomy change.
  it("resolves retired section ids to where those settings live now", () => {
    expect(normalizeSettingsSection("models")).toBe("agents");
    expect(normalizeSettingsSection("providers")).toBe("agents");
    expect(normalizeSettingsSection("usage")).toBe("agents");
    expect(normalizeSettingsSection("worktrees")).toBe("workspaces");
    expect(normalizeSettingsSection("archived")).toBe("workspaces");
    expect(normalizeSettingsSection("behavior")).toBe("permissions");
    expect(normalizeSettingsSection("shortcuts")).toBe("shortcuts");
    expect(normalizeSettingsSection("notifications")).toBe("notifications");
  });

  it("falls back to General for anything unrecognised", () => {
    expect(normalizeSettingsSection("nope")).toBe("general");
    expect(normalizeSettingsSection(undefined)).toBe("general");
    expect(normalizeSettingsSection(42)).toBe("general");
  });
});
