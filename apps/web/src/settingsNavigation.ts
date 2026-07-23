// FILE: settingsNavigation.ts
// Purpose: Share the compact settings taxonomy between navigation, search, and panels.

export const SETTINGS_SECTION_IDS = [
  "general",
  "appearance",
  "sidebar",
  "notifications",
  "shortcuts",
  "agents",
  "permissions",
  "workspaces",
  "appsnap",
  "profile",
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "app" | "agents" | "workspace" | "system";

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

// Grouping exists because a flat list put eight unrelated groups under "General".
// Each group answers a different question: how the app looks and behaves, how
// agents run, what they run against, and what belongs to the machine or to you.
export const SETTINGS_NAV_GROUPS = [
  { id: "app", label: "App" },
  { id: "agents", label: "Agents" },
  { id: "workspace", label: "Workspace" },
  { id: "system", label: "System" },
] as const;

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "general",
    group: "app",
    label: "General",
    description: "Startup defaults and how time is shown.",
    icon: "settings-gear-1",
    eyebrow: "App defaults",
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
    id: "sidebar",
    group: "app",
    label: "Sidebar",
    description: "Position, ordering, and which sections are shown.",
    icon: "sidebar-simple-left-wide",
    eyebrow: "Navigation",
  },
  {
    id: "notifications",
    group: "app",
    label: "Notifications",
    description: "When TeaCode should interrupt you.",
    icon: "bell",
    eyebrow: "Alerts",
  },
  {
    id: "shortcuts",
    group: "app",
    label: "Shortcuts",
    description: "Keyboard shortcuts for every command.",
    icon: "command",
    eyebrow: "Keyboard",
  },
  {
    id: "agents",
    group: "agents",
    label: "Providers & models",
    description: "Provider setup, model defaults, and usage.",
    icon: "agent-network",
    eyebrow: "Agent configuration",
  },
  {
    id: "permissions",
    group: "agents",
    label: "Permissions & safety",
    description: "What agents may do without asking.",
    icon: "shield",
    eyebrow: "Guardrails",
  },
  {
    id: "workspaces",
    group: "workspace",
    label: "Worktrees & threads",
    description: "Managed worktrees, archived threads, and run checklists.",
    icon: "branch",
    eyebrow: "Workspace lifecycle",
  },
  {
    id: "appsnap",
    group: "workspace",
    label: "AppSnap",
    description: "Capture the frontmost macOS window into a TeaCode task.",
    icon: "device-laptop",
    eyebrow: "Window capture",
  },
  {
    id: "profile",
    group: "system",
    label: "Profile",
    description: "Your local activity, streaks, and shareable stats.",
    icon: "user",
    eyebrow: "Your stats",
  },
  {
    id: "advanced",
    group: "system",
    label: "Advanced",
    description: "Recovery tools and version information.",
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
  // Deep links and saved URLs outlive a taxonomy change, so every id this route
  // has ever accepted still resolves to wherever its settings live now.
  if (["models", "providers", "usage"].includes(value)) {
    return "agents";
  }
  if (["worktrees", "archived"].includes(value)) {
    return "workspaces";
  }
  if (value === "behavior") {
    return "permissions";
  }
  return "general";
}
