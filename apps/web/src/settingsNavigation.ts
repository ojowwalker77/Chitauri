// FILE: settingsNavigation.ts
// Purpose: Share the compact settings taxonomy between navigation, search, and panels.

export const SETTINGS_SECTION_IDS = [
  "general",
  "profile",
  "appearance",
  "appsnap",
  "agents",
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "app";

export const SETTINGS_TARGETS = {
  providerUpdates: "provider-updates",
  providerInstalls: "provider-installs",
  chatHeaderControls: "chat-header-controls",
} as const;

export type SettingsTargetId = (typeof SETTINGS_TARGETS)[keyof typeof SETTINGS_TARGETS];

export type SettingsNavItem = {
  id: SettingsSectionId;
  group: SettingsNavGroupId;
  label: string;
  description: string;
  icon: string;
  eyebrow: string;
};

export const SETTINGS_NAV_GROUPS = [{ id: "app", label: "Settings" }] as const;

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "general",
    group: "app",
    label: "General",
    description: "Workflow defaults, behavior, and notifications.",
    icon: "settings-gear-1",
    eyebrow: "App defaults",
  },
  {
    id: "profile",
    group: "app",
    label: "Profile",
    description: "Your local activity, streaks, and shareable stats.",
    icon: "user",
    eyebrow: "Your stats",
  },
  {
    id: "appearance",
    group: "app",
    label: "Appearance",
    description: "Theme, typography, and chat presentation.",
    icon: "color-palette",
    eyebrow: "Visual language",
  },
  {
    id: "appsnap",
    group: "app",
    label: "AppSnap",
    description: "Capture the frontmost macOS window into a TeaCode task.",
    icon: "device-laptop",
    eyebrow: "Window capture",
  },
  {
    id: "agents",
    group: "app",
    label: "Agents",
    description: "Models, providers, orchestration, and usage.",
    icon: "agent-network",
    eyebrow: "Agent configuration",
  },
  {
    id: "advanced",
    group: "app",
    label: "Advanced",
    description: "Shortcuts, recovery tools, and version information.",
    icon: "toolbox",
    eyebrow: "System tools",
  },
] as const;

export function settingRowAnchorId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `setting-${slug}`;
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  if (typeof value !== "string") {
    return "general";
  }
  if (SETTINGS_SECTION_IDS.some((candidate) => candidate === value)) {
    return value as SettingsSectionId;
  }
  if (["models", "providers", "usage"].includes(value)) {
    return "agents";
  }
  if (["shortcuts", "worktrees", "archived"].includes(value)) {
    return "advanced";
  }
  if (["notifications", "behavior"].includes(value)) {
    return "general";
  }
  return "general";
}
