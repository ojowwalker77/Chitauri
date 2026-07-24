// FILE: settingsSearchIndex.ts
// Purpose: Declarative, searchable index of settings rows/sections so the sidebar can
//          surface matches by title/description the same way the editor file search does.
// Layer: Route/UI support
// Exports: entry type, the index, section label lookup, and the ranking helper

import { rankProviderDiscoveryItems } from "~/lib/providerDiscovery";
import {
  settingRowAnchorId,
  SETTINGS_NAV_ITEMS,
  type SettingsSectionId,
} from "./settingsNavigation";

/**
 * One searchable settings result. `title` usually matches a string SettingsRow heading so
 * the default anchor can be derived; `target: null` marks panel-only or conditional rows.
 */
export interface SettingsSearchEntry {
  id: string;
  section: SettingsSectionId;
  title: string;
  keywords: string;
  target?: string | null;
}

/** DOM id a result deep-links to, or null for panel-level entries with no anchored row. */
export function settingsSearchEntryTarget(entry: SettingsSearchEntry): string | null {
  return entry.target === undefined ? settingRowAnchorId(entry.title) : entry.target;
}

// Mirrors row titles/descriptions rendered in settings panels. Panels only mount the active
// section, so the sidebar cannot read row text at runtime; keep this list in sync when rows
// are added, renamed, hidden conditionally, or represented as panel-level results.
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: "appsnap:enable",
    section: "appsnap",
    title: "Enable AppSnap",
    keywords: "macOS window capture left option right option shortcut permissions",
  },
  {
    id: "appsnap:sound",
    section: "appsnap",
    title: "Capture sound",
    keywords: "audio confirmation preview AppSnap",
  },
  {
    id: "appsnap:permissions",
    section: "appsnap",
    title: "macOS permissions",
    keywords: "Input Monitoring Screen Recording recheck privacy system settings",
  },
  // ── General ────────────────────────────────────────────────────────────────
  {
    id: "general:default-provider",
    section: "general",
    title: "Default provider",
    keywords: "Choose the provider used for new chats. agent codex claude",
  },
  {
    id: "general:new-thread-workspace",
    section: "general",
    title: "New thread workspace",
    keywords: "new worktree current branch checkout default thread workspace isolation",
  },
  {
    id: "general:worktree-base-branch",
    section: "general",
    title: "Worktree base branch",
    keywords: "default branch origin remote main master new worktree base",
  },
  {
    id: "general:permissions-mode",
    section: "permissions",
    title: "Permissions Mode",
    keywords:
      "Choose the default access level for new chats. full access approval permissions ask first bypass",
  },
  {
    id: "general:project-order",
    section: "sidebar",
    title: "Worker order",
    keywords: "Controls how Workers are arranged in the main sidebar. sort updated created manual",
  },
  {
    id: "general:thread-order",
    section: "sidebar",
    title: "Worker Thread order",
    keywords:
      "Controls how Worker Threads are arranged inside each Worker in the main sidebar. sort updated created",
  },
  {
    id: "general:chats-section",
    section: "sidebar",
    title: "Chats",
    keywords:
      "Show the standalone Chats list in the sidebar footer chats not tied to a Worker. sidebar section",
  },

  // ── Appearance ───────────────────────────────────────────────────────────────
  {
    id: "appearance:theme",
    section: "appearance",
    title: "Theme",
    keywords: "Choose how TeaCode looks across the app. follow system dark light appearance",
  },
  {
    id: "appearance:highlight-color",
    section: "appearance",
    title: "Highlight color",
    keywords: "Color used when you highlight selected text in a chat transcript. yellow green pink",
  },
  {
    id: "appearance:base-font-size",
    section: "appearance",
    title: "Base font size",
    keywords:
      "Adjust the app text base in pixels. Chat and UI typography scale proportionally. font",
  },
  {
    id: "appearance:terminal-font-size",
    section: "appearance",
    title: "Terminal font size",
    keywords: "Adjust terminal text independently from the app and chat font size.",
  },
  {
    id: "appearance:font-smoothing",
    section: "appearance",
    title: "Font smoothing",
    keywords: "Use macOS-style antialiasing for lighter, crisper text rendering.",
    target: null,
  },
  {
    id: "appearance:time-format",
    section: "general",
    title: "Time format",
    keywords:
      "System default follows your browser or OS clock preference. timestamp 12-hour 24-hour locale",
  },
  {
    id: "appearance:chat-header-controls",
    section: "appearance",
    title: "Header controls",
    keywords:
      "Chat header. Drag to reorder the buttons in the chat header and hide the ones you don't use. top bar toolbar actions usage hand off Worker actions environment open in editor git actions diff panel visibility order clutter",
  },

  // ── Notifications ─────────────────────────────────────────────────────────────
  {
    id: "notifications:activity-toasts",
    section: "notifications",
    title: "Activity toasts",
    keywords:
      "Show an in-app toast when a chat or managed terminal agent finishes or needs input. alerts",
  },
  {
    id: "notifications:desktop-notifications",
    section: "notifications",
    title: "Desktop notifications",
    keywords:
      "Show an OS notification when a chat or managed terminal agent finishes or needs input while the app is in the background. alerts toast",
  },

  // ── Behavior ──────────────────────────────────────────────────────────────────
  {
    id: "behavior:task-list-location",
    section: "general",
    title: "Run checklist location",
    keywords:
      "Choose where the provider run checklist opens by default. active steps right sidebar vertical above composer inline plan",
  },
  {
    id: "behavior:assistant-output",
    section: "permissions",
    title: "Assistant output",
    keywords: "Show token-by-token output while a response is in progress. streaming",
  },
  {
    id: "behavior:diff-line-wrapping",
    section: "permissions",
    title: "Diff line wrapping",
    keywords: "Set the default wrap state when the diff panel opens. word wrap",
  },
  {
    id: "behavior:delete-confirmation",
    section: "permissions",
    title: "Delete confirmation",
    keywords: "Ask before deleting a thread and its chat history. safety confirm",
  },
  {
    id: "behavior:archive-confirmation",
    section: "permissions",
    title: "Archive confirmation",
    keywords: "Ask before archiving a thread. safety confirm",
  },
  {
    id: "behavior:terminal-close-confirmation",
    section: "permissions",
    title: "Terminal close confirmation",
    keywords: "Ask before closing a terminal tab and clearing its history. safety confirm",
  },

  // ── Keyboard Shortcuts ────────────────────────────────────────────────────────
  {
    id: "shortcuts:keyboard-shortcuts",
    section: "shortcuts",
    title: "Keyboard Shortcuts",
    keywords:
      "Every keyboard shortcut available in TeaCode, grouped by context. keybindings hotkeys key combo cmd ctrl reference",
    target: null,
  },

  // ── Worktrees ─────────────────────────────────────────────────────────────────
  {
    id: "worktrees:managed-worktrees",
    section: "workspaces",
    title: "Managed worktrees",
    keywords: "Review and clean up the worktrees created by TeaCode. git branch remove",
    target: null,
  },

  // ── Archived ──────────────────────────────────────────────────────────────────
  {
    id: "archived:archived-threads",
    section: "workspaces",
    title: "Archived threads",
    keywords: "View and restore archived threads. unarchive history",
    target: null,
  },

  // ── Models ────────────────────────────────────────────────────────────────────
  {
    id: "models:git-writing-model",
    section: "agents",
    title: "Git writing model",
    keywords: "Used for generated commit messages, PR titles, and branch names.",
  },
  {
    id: "models:saved-model-slugs",
    section: "agents",
    title: "Saved model slugs",
    keywords: "Add custom model slugs for supported providers. custom model",
  },

  // ── Providers ─────────────────────────────────────────────────────────────────
  {
    id: "providers:automatic-cli-update-checks",
    section: "agents",
    title: "Automatic CLI update checks",
    keywords:
      "Check Codex Claude and other provider CLIs for newer versions in the background. updates upgrade disable nags",
  },
  {
    id: "providers:visible-providers",
    section: "agents",
    title: "Visible providers",
    keywords:
      "Drag providers into your preferred picker order and hide the ones you don't use. visibility order",
  },
  {
    id: "providers:provider-updates",
    section: "agents",
    title: "Provider updates",
    keywords: "Update installed provider tools that TeaCode can safely update. upgrade cli",
  },
  {
    id: "providers:installed-clis",
    section: "agents",
    title: "Installed CLIs",
    keywords: "Review provider versions and update tools. binary overrides path install",
  },

  // ── Skills ────────────────────────────────────────────────────────────────────
  {
    id: "skills:skills",
    section: "agents",
    title: "Skills",
    keywords: "Every skill found across providers, with toggles to control availability. agent",
    target: null,
  },

  // ── Usage ─────────────────────────────────────────────────────────────────────
  {
    id: "usage:usage",
    section: "agents",
    title: "Usage and billing",
    keywords: "Remaining quota and credits for each signed-in provider. limits credits",
    target: null,
  },

  // ── Advanced ──────────────────────────────────────────────────────────────────
  {
    id: "profile:stats",
    section: "profile",
    title: "Profile",
    keywords:
      "Your local activity dashboard: streaks, prompts, tokens, and per-provider totals. stats usage history",
    target: null,
  },
  {
    id: "profile:share",
    section: "profile",
    title: "Share your stats",
    keywords: "Share a card of your local TeaCode activity. share card handle export image",
    target: null,
  },
  {
    id: "advanced:keybindings",
    section: "advanced",
    title: "Keybindings",
    keywords:
      "Open the persisted keybindings.json file to edit advanced bindings directly. shortcuts",
  },
  {
    id: "advanced:recovery-tools",
    section: "advanced",
    title: "Recovery tools",
    keywords:
      "Rebuild local Worker indexes without clearing existing chats when the local state gets out of sync.",
  },
  {
    id: "advanced:version",
    section: "advanced",
    title: "Version",
    keywords: "Current application version. about",
  },
  {
    id: "advanced:release-history",
    section: "advanced",
    title: "Release history",
    keywords:
      "A running log of every update, newest first. changelog what's new about release notes",
  },
] as const;

const SETTINGS_SECTION_LABEL_BY_ID = new Map<SettingsSectionId, string>(
  SETTINGS_NAV_ITEMS.map((item) => [item.id, item.label]),
);

export function settingsSectionLabel(section: SettingsSectionId): string {
  return SETTINGS_SECTION_LABEL_BY_ID.get(section) ?? section;
}

/**
 * Fuzzy-rank settings rows for the sidebar search. Title carries the strongest intent;
 * the description/synonym keywords and the owning section label match more loosely so a
 * query like "appearance" or "wrap" still surfaces the right rows.
 */
export function rankSettingsSearchEntries(
  query: string,
  limit: number,
): readonly SettingsSearchEntry[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const ranked = rankProviderDiscoveryItems(SETTINGS_SEARCH_ENTRIES, trimmed, (entry) => [
    { value: entry.title },
    { value: entry.keywords, weight: 200 },
    { value: settingsSectionLabel(entry.section), weight: 400 },
  ]);
  return ranked.slice(0, limit);
}
