/**
 * SidebarSearchPalette - Command-style palette for sidebar actions, threads, and projects.
 *
 * Keeps the sidebar search UX aligned with the shared command primitives so
 * keyboard navigation and shortcut labels behave like the rest of the app.
 */
import {
  CheckIcon,
  DeviceLaptopIcon,
  MoonIcon,
  NewThreadIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from "~/lib/icons";
import {
  type FilesystemBrowseResult,
  type ImportableDesktopThread,
  type ImportableDesktopThreadProvider,
  type ProviderKind,
} from "@t3tools/contracts";
import { isGenericChatThreadTitle } from "@t3tools/shared/chatThreads";
import { BsChat } from "react-icons/bs";
import { HiOutlineFolderOpen } from "react-icons/hi2";
import {
  LuArrowDownToLine,
  LuArrowLeft,
  LuCornerLeftUp,
  LuFolderPlus,
  LuRefreshCw,
} from "react-icons/lu";
import { type ComponentType, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderClosed } from "./FolderClosed";
import { ProviderIcon as SharedProviderIcon } from "./ProviderIcon";
import { formatRelativeTime } from "~/lib/relativeTime";
import { readNativeApi } from "~/nativeApi";
import { cn, isMacPlatform } from "~/lib/utils";
import { Kbd, KbdGroup } from "./ui/kbd";
import {
  appendBrowsePathSegment,
  canNavigateUp,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  getInitialBrowseQuery,
  hasTrailingPathSeparator,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
  isUnsupportedWindowsProjectPath,
  normalizeProjectPathForDispatch,
} from "~/lib/projectPaths";

import {
  type SidebarSearchAction,
  type SidebarSearchProject,
  type SidebarSearchThread,
  matchSidebarSearchActions,
  matchSidebarSearchProjects,
  matchSidebarSearchThreads,
} from "./SidebarSearchPalette.logic";
import { useTheme } from "../hooks/useTheme";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "./ui/command";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ShortcutKbd } from "./ui/shortcut-kbd";

export type SidebarSearchPaletteMode = "search" | "import";

interface SidebarSearchPaletteProps {
  open: boolean;
  mode: SidebarSearchPaletteMode;
  onModeChange: (mode: SidebarSearchPaletteMode) => void;
  onOpenChange: (open: boolean) => void;
  actions: readonly SidebarSearchAction[];
  projects: readonly SidebarSearchProject[];
  threads: readonly SidebarSearchThread[];
  onCreateChat: () => void;
  onCreateThread: () => void;
  onAddProjectPath: (path: string, options?: { createIfMissing?: boolean }) => Promise<void>;
  homeDir: string | null;
  initialBrowseQuery?: string | null;
  onOpenSettings: () => void;
  onOpenUsageSettings: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenThread: (threadId: string) => void;
  importProviders: readonly ImportProviderKind[];
  onImportThread: (request: ImportThreadRequest) => Promise<void>;
}

export type ImportProviderKind = Extract<
  ProviderKind,
  "codex" | "claudeAgent" | "cursor" | "kilo" | "opencode"
>;

export type ImportThreadRequest =
  | {
      kind: "desktop";
      thread: ImportableDesktopThread;
    }
  | {
      kind: "manual";
      provider: ImportProviderKind;
      externalId: string;
    };

function actionHandler(
  actionId: string,
  props: Pick<
    SidebarSearchPaletteProps,
    "onCreateChat" | "onCreateThread" | "onOpenSettings" | "onOpenUsageSettings"
  >,
): (() => void) | null {
  switch (actionId) {
    case "new-chat":
      return props.onCreateChat;
    case "new-thread":
      return props.onCreateThread;
    case "settings":
      return props.onOpenSettings;
    case "usage-settings":
      return props.onOpenUsageSettings;
    default:
      return null;
  }
}

type IconComponent = ComponentType<{ className?: string }>;

const ACTION_ICONS: Record<string, IconComponent> = {
  "new-chat": BsChat,
  "new-thread": NewThreadIcon,
  "add-project": FolderClosed,
  "import-thread": LuArrowDownToLine,
  settings: SettingsIcon,
  "usage-settings": SettingsIcon,
};

const BROWSE_STALE_TIME_MS = 10_000;

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];

function expandHomeInPath(value: string, homeDir: string | null): string {
  if (!homeDir) return value;
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return `${homeDir}${value.slice(1)}`;
  }
  return value;
}

function PaletteIcon(props: { icon: IconComponent }) {
  const Icon = props.icon;
  return (
    <div className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
      <Icon className="size-[15px]" />
    </div>
  );
}

type ThemeCommandItem = {
  description: string;
  id: string;
  isActive: boolean;
  label: string;
  mode: "system" | "light" | "dark";
};

function queryTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function hasTokenEqual(query: string, token: string): boolean {
  return queryTokens(query).includes(token);
}

function createThemeCommandItem(
  mode: ThemeCommandItem["mode"],
  activeMode: ThemeCommandItem["mode"],
): ThemeCommandItem {
  if (mode === "system") {
    return {
      id: "theme-command:system",
      label: "Follow system appearance",
      description: "Match your OS appearance setting.",
      mode,
      isActive: activeMode === mode,
    };
  }

  return {
    id: `theme-command:${mode}`,
    label: `Switch to ${mode} theme`,
    description: mode === "light" ? "Always use the light theme." : "Always use the dark theme.",
    mode,
    isActive: activeMode === mode,
  };
}

// Treat any token of length >= 2 that is a prefix of `keyword` as a match,
// so typing `th` / `the` already starts surfacing theme actions.
function hasTokenPrefixOf(query: string, keyword: string): boolean {
  return queryTokens(query).some((token) => token.length >= 2 && keyword.startsWith(token));
}

// Keep the palette quiet by default, then expose focused appearance actions
// once the user is clearly asking about theme modes.
function buildThemeCommandItems(input: {
  query: string;
  resolvedTheme: "light" | "dark";
  theme: "system" | "light" | "dark";
}): ThemeCommandItem[] {
  const normalizedQuery = input.query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  if (
    hasTokenEqual(normalizedQuery, "system") ||
    hasTokenEqual(normalizedQuery, "auto") ||
    hasTokenEqual(normalizedQuery, "automatic") ||
    hasTokenEqual(normalizedQuery, "os")
  ) {
    return [createThemeCommandItem("system", input.theme)];
  }

  if (hasTokenEqual(normalizedQuery, "light")) {
    return [
      createThemeCommandItem("light", input.theme),
      createThemeCommandItem("system", input.theme),
    ];
  }

  if (hasTokenEqual(normalizedQuery, "dark")) {
    return [
      createThemeCommandItem("dark", input.theme),
      createThemeCommandItem("system", input.theme),
    ];
  }

  if (
    hasTokenPrefixOf(normalizedQuery, "theme") ||
    hasTokenPrefixOf(normalizedQuery, "appearance")
  ) {
    const nextMode = input.resolvedTheme === "dark" ? "light" : "dark";
    return [
      createThemeCommandItem(nextMode, input.theme),
      createThemeCommandItem("system", input.theme),
    ];
  }

  return [];
}

const THEME_MODE_ICONS: Record<"system" | "light" | "dark", IconComponent> = {
  system: DeviceLaptopIcon,
  light: SunIcon,
  dark: MoonIcon,
};

function ProviderIcon(props: { provider: ProviderKind }) {
  return (
    <div className="flex size-5 shrink-0 items-center justify-center">
      <SharedProviderIcon provider={props.provider} className="size-[15px]" />
    </div>
  );
}

function threadMatchLabel(input: {
  matchKind: "message" | "project" | "title";
  messageMatchCount: number;
}): string | null {
  if (input.matchKind === "message") {
    return input.messageMatchCount > 1 ? `${input.messageMatchCount} chat hits` : "Chat match";
  }
  if (input.matchKind === "project") {
    return "Project match";
  }
  return null;
}

function tokenizeHighlightQuery(query: string): string[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token, index, allTokens) => allTokens.indexOf(token) === index);
  return tokens.toSorted((left, right) => right.length - left.length);
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText(props: { text: string; query: string; className?: string }) {
  const segments = useMemo(() => {
    const tokens = tokenizeHighlightQuery(props.query);
    if (tokens.length === 0) {
      return [{ key: "full", text: props.text, highlighted: false }];
    }

    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
    const parts = props.text.split(pattern).filter((part) => part.length > 0);
    let offset = 0;
    return parts.map((part) => {
      const segment = {
        key: `${offset}-${part.length}`,
        text: part,
        highlighted: tokens.some((token) => token === part.toLowerCase()),
      };
      offset += part.length;
      return segment;
    });
  }, [props.query, props.text]);

  return (
    <span className={props.className}>
      {segments.map((segment) =>
        segment.highlighted ? (
          <mark
            key={segment.key}
            className="rounded-[3px] bg-[color-mix(in_srgb,var(--info)_25%,transparent)] px-[1px] text-current"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={segment.key}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

export function SidebarSearchPalette(props: SidebarSearchPaletteProps) {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [query, setQuery] = useState(props.initialBrowseQuery ?? "");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const [importProvider, setImportProvider] = useState<ImportProviderKind>(
    props.importProviders[0] ?? "codex",
  );
  const [desktopImportProvider, setDesktopImportProvider] =
    useState<ImportableDesktopThreadProvider>("codex");
  const [desktopImportQuery, setDesktopImportQuery] = useState("");
  const [showManualImport, setShowManualImport] = useState(false);
  const [importingDesktopThreadKey, setImportingDesktopThreadKey] = useState<string | null>(null);
  const [importId, setImportId] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [isAddingProject, setIsAddingProject] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setQuery("");
      setHighlightedItemValue(null);
      setImportProvider(props.importProviders[0] ?? "codex");
      setDesktopImportProvider("codex");
      setDesktopImportQuery("");
      setShowManualImport(false);
      setImportingDesktopThreadKey(null);
      setImportId("");
      setImportError(null);
      setIsImporting(false);
      setAddProjectError(null);
      setIsAddingProject(false);
    }
  }, [props.importProviders, props.open]);

  useEffect(() => {
    if (props.importProviders.includes(importProvider)) {
      return;
    }
    setImportProvider(props.importProviders[0] ?? "codex");
  }, [importProvider, props.importProviders]);

  const desktopImportProviders = useMemo(
    () =>
      (["codex", "claudeAgent"] as const).filter((provider) =>
        props.importProviders.includes(provider),
      ),
    [props.importProviders],
  );

  useEffect(() => {
    if (desktopImportProviders.includes(desktopImportProvider)) return;
    setDesktopImportProvider(desktopImportProviders[0] ?? "codex");
  }, [desktopImportProvider, desktopImportProviders]);

  const desktopThreadsQuery = useQuery({
    queryKey: ["importable-desktop-threads"],
    queryFn: async () => {
      const api = readNativeApi();
      if (!api) throw new Error("The app server is unavailable.");
      return api.orchestration.listImportableDesktopThreads({});
    },
    enabled: props.open && props.mode === "import" && !showManualImport,
    staleTime: 5_000,
  });

  const filteredDesktopThreads = useMemo(() => {
    const query = desktopImportQuery.trim().toLowerCase();
    return (desktopThreadsQuery.data?.threads ?? []).filter((thread) => {
      if (thread.provider !== desktopImportProvider) return false;
      if (!query) return true;
      return `${thread.title} ${thread.cwd ?? ""}`.toLowerCase().includes(query);
    });
  }, [desktopImportProvider, desktopImportQuery, desktopThreadsQuery.data?.threads]);

  useEffect(() => {
    setAddProjectError(null);
  }, [query]);

  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const trimmedQuery = query.trim();
  const unsupportedWindowsPath = isUnsupportedWindowsProjectPath(trimmedQuery, platform);
  const isBrowsing = trimmedQuery.length > 0 && isFilesystemBrowseQuery(trimmedQuery, platform);
  const canBrowse = isBrowsing && !unsupportedWindowsPath;
  const browseDirectoryPath = canBrowse ? getBrowseDirectoryPath(query) : "";
  const leafSegment =
    canBrowse && !hasTrailingPathSeparator(query) ? getBrowseLeafPathSegment(query) : "";
  const expandedBrowsePath = canBrowse ? expandHomeInPath(browseDirectoryPath, props.homeDir) : "";

  const { data: browseResult, isFetching: isBrowseFetching } =
    useQuery<FilesystemBrowseResult | null>({
      queryKey: ["sidebar-palette-browse", expandedBrowsePath],
      queryFn: async () => {
        if (!canBrowse || expandedBrowsePath.length === 0) return null;
        const api = readNativeApi();
        if (!api) return null;
        return await api.filesystem.browse({ partialPath: expandedBrowsePath });
      },
      enabled: canBrowse && expandedBrowsePath.length > 0,
      staleTime: BROWSE_STALE_TIME_MS,
    });

  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const filteredBrowseEntries = useMemo(() => {
    const lowerFilter = leafSegment.toLowerCase();
    const showHidden = leafSegment.startsWith(".");
    return browseEntries.filter(
      (entry) =>
        entry.name.toLowerCase().startsWith(lowerFilter) &&
        (showHidden || !entry.name.startsWith(".")),
    );
  }, [browseEntries, leafSegment]);

  const exactBrowseEntry = useMemo(() => {
    if (leafSegment.length === 0) return null;
    return filteredBrowseEntries.find((entry) => entry.name === leafSegment) ?? null;
  }, [filteredBrowseEntries, leafSegment]);

  const browseParentPath = canBrowse ? getBrowseParentPath(query) : null;
  const canBrowseUp = canBrowse && canNavigateUp(query);

  const matchedActions = useMemo(
    () => (isBrowsing ? [] : matchSidebarSearchActions(props.actions, query)),
    [isBrowsing, props.actions, query],
  );
  const themeCommandItems = useMemo(
    () =>
      buildThemeCommandItems({
        query,
        resolvedTheme,
        theme,
      }),
    [query, resolvedTheme, theme],
  );
  const showThemeSection = !isBrowsing && query.trim().length > 0 && themeCommandItems.length > 0;
  const matchedProjects = useMemo(
    () => (isBrowsing ? [] : matchSidebarSearchProjects(props.projects, query)),
    [isBrowsing, props.projects, query],
  );
  const matchedThreads = useMemo(
    () => (isBrowsing ? [] : matchSidebarSearchThreads(props.threads, query)),
    [isBrowsing, props.threads, query],
  );
  const hasSearchResults =
    matchedActions.length > 0 ||
    themeCommandItems.length > 0 ||
    matchedProjects.length > 0 ||
    matchedThreads.length > 0;
  const importFieldLabel = importProvider === "codex" ? "Thread ID" : "Session ID";
  const importPlaceholder =
    importProvider === "claudeAgent"
      ? "Paste a Claude session id"
      : importProvider === "cursor"
        ? "Paste a Cursor session id"
        : importProvider === "kilo"
          ? "Paste a Kilo session id"
          : importProvider === "opencode"
            ? "Paste an OpenCode session id"
            : "Paste a Codex thread id";

  const hasHighlightedFolderItem =
    highlightedItemValue !== null && highlightedItemValue.startsWith("folder:");
  const hasHighlightedBrowseItem =
    hasHighlightedFolderItem || highlightedItemValue === "__browse_up__";

  const highlightedFolderPath = hasHighlightedFolderItem
    ? (highlightedItemValue?.slice("folder:".length) ?? null)
    : null;

  const willCreateMissingFolder =
    canBrowse &&
    !hasHighlightedFolderItem &&
    trimmedQuery.length > 0 &&
    !hasTrailingPathSeparator(query) &&
    exactBrowseEntry === null &&
    !isBrowseFetching;

  const browseSubmitLabel = willCreateMissingFolder ? "Create & Add" : "Add";

  const resolveBrowseSubmitPath = (): string => {
    if (highlightedFolderPath) {
      return normalizeProjectPathForDispatch(highlightedFolderPath);
    }
    const raw = hasTrailingPathSeparator(query)
      ? (browseResult?.parentPath ?? expandHomeInPath(trimmedQuery, props.homeDir))
      : (exactBrowseEntry?.fullPath ?? expandHomeInPath(trimmedQuery, props.homeDir));
    return normalizeProjectPathForDispatch(raw);
  };

  const submitBrowsePath = async () => {
    if (isAddingProject) return;
    if (trimmedQuery.length === 0 && !highlightedFolderPath) {
      setAddProjectError("Enter a folder path.");
      return;
    }
    if (unsupportedWindowsPath) {
      setAddProjectError("Windows paths are not supported on this platform.");
      return;
    }
    if (!highlightedFolderPath && isExplicitRelativeProjectPath(trimmedQuery)) {
      setAddProjectError(
        "Relative paths are not supported. Use an absolute path or start with ~/.",
      );
      return;
    }
    setIsAddingProject(true);
    setAddProjectError(null);
    try {
      await props.onAddProjectPath(resolveBrowseSubmitPath(), {
        createIfMissing: willCreateMissingFolder,
      });
      props.onOpenChange(false);
    } catch (cause) {
      setAddProjectError(cause instanceof Error ? cause.message : "Failed to add project.");
    } finally {
      setIsAddingProject(false);
    }
  };

  const isMac = isMacPlatform(platform);
  const submitModifierLabel = isMac ? "⌘" : "Ctrl";

  const handleBrowseInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isBrowsing) return;
    const isModifierPressed = isMac ? event.metaKey : event.ctrlKey;
    if (
      event.key === "Enter" &&
      (!hasHighlightedBrowseItem || (isModifierPressed && hasHighlightedFolderItem))
    ) {
      event.preventDefault();
      void submitBrowsePath();
      return;
    }
    if (
      event.key === "Backspace" &&
      hasTrailingPathSeparator(query) &&
      browseParentPath &&
      event.currentTarget.selectionStart === query.length &&
      event.currentTarget.selectionEnd === query.length
    ) {
      event.preventDefault();
      setQuery(browseParentPath);
    }
  };

  const submitImport = async () => {
    const normalizedImportId = importId.trim();
    if (!normalizedImportId || isImporting) {
      return;
    }
    setImportError(null);
    setIsImporting(true);
    try {
      await props.onImportThread({
        kind: "manual",
        provider: importProvider,
        externalId: normalizedImportId,
      });
      props.onOpenChange(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to import thread.");
    } finally {
      setIsImporting(false);
    }
  };

  const submitDesktopImport = async (thread: ImportableDesktopThread) => {
    if (importingDesktopThreadKey) return;
    if (thread.chitauriThreadId) {
      props.onOpenChange(false);
      props.onOpenThread(thread.chitauriThreadId);
      return;
    }

    const key = `${thread.provider}:${thread.externalId}`;
    setImportError(null);
    setImportingDesktopThreadKey(key);
    try {
      await props.onImportThread({ kind: "desktop", thread });
      props.onOpenChange(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to import thread.");
    } finally {
      setImportingDesktopThreadKey(null);
    }
  };

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup className="max-w-2xl">
        {props.mode === "import" ? (
          <div className="flex flex-col overflow-hidden">
            <div className="border-b border-border/70 px-4 py-3">
              <div className="flex items-start gap-3">
                <Button
                  size="icon"
                  variant="ghost"
                  className="-ml-1 mt-[-2px] size-8 shrink-0"
                  onClick={() => {
                    setImportError(null);
                    if (showManualImport) {
                      setShowManualImport(false);
                      return;
                    }
                    props.onModeChange("search");
                  }}
                >
                  <LuArrowLeft className="size-4" />
                </Button>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {showManualImport ? "Import by session ID" : "Import from desktop apps"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {showManualImport
                      ? "Resume a provider session when it does not appear in desktop history."
                      : "Continue a Codex or Claude conversation in TeaCode."}
                  </p>
                </div>
              </div>
            </div>
            {showManualImport ? (
              <div className="space-y-4 px-4 py-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Provider</p>
                  <div className="flex flex-wrap gap-2">
                    {props.importProviders.map((provider) => (
                      <Button
                        key={provider}
                        className={
                          importProvider === provider
                            ? "flex-1 justify-start border-border bg-muted text-foreground hover:bg-muted/80"
                            : "flex-1 justify-start"
                        }
                        variant="outline"
                        onClick={() => setImportProvider(provider)}
                      >
                        <ProviderIcon provider={provider} />
                        {provider === "claudeAgent"
                          ? "Claude"
                          : provider === "cursor"
                            ? "Cursor"
                            : provider === "kilo"
                              ? "Kilo"
                              : provider === "opencode"
                                ? "OpenCode"
                                : "Codex"}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{importFieldLabel}</p>
                  <Input
                    autoFocus
                    nativeInput
                    placeholder={importPlaceholder}
                    value={importId}
                    disabled={props.importProviders.length === 0}
                    onChange={(event) => setImportId(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitImport();
                      }
                    }}
                  />
                </div>
                {importError ? (
                  <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {importError}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      props.importProviders.length === 0 ||
                      importId.trim().length === 0 ||
                      isImporting
                    }
                    onClick={submitImport}
                  >
                    {isImporting ? "Importing..." : "Import"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-col">
                <div className="space-y-3 px-4 py-4">
                  <div className="flex gap-2">
                    {desktopImportProviders.map((provider) => (
                      <Button
                        key={provider}
                        className={
                          desktopImportProvider === provider
                            ? "flex-1 justify-start border-border bg-muted text-foreground hover:bg-muted/80"
                            : "flex-1 justify-start"
                        }
                        variant="outline"
                        onClick={() => setDesktopImportProvider(provider)}
                      >
                        <ProviderIcon provider={provider} />
                        {provider === "claudeAgent" ? "Claude Desktop" : "Codex Desktop"}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      nativeInput
                      placeholder="Search desktop threads"
                      value={desktopImportQuery}
                      disabled={desktopImportProviders.length === 0}
                      onChange={(event) => setDesktopImportQuery(event.currentTarget.value)}
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label="Refresh desktop threads"
                      title="Refresh desktop threads"
                      disabled={desktopThreadsQuery.isFetching}
                      onClick={() => void desktopThreadsQuery.refetch()}
                    >
                      <LuRefreshCw
                        className={cn("size-4", desktopThreadsQuery.isFetching && "animate-spin")}
                      />
                    </Button>
                  </div>
                </div>

                <div className="max-h-[min(24rem,55vh)] min-h-48 overflow-y-auto px-2 pb-2">
                  {desktopImportProviders.length === 0 ? (
                    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                      Connect Codex or Claude to import its desktop threads.
                    </div>
                  ) : desktopThreadsQuery.isPending ? (
                    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                      Loading {desktopImportProvider === "codex" ? "Codex" : "Claude"} threads…
                    </div>
                  ) : desktopThreadsQuery.error ? (
                    <div className="mx-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
                      {desktopThreadsQuery.error instanceof Error
                        ? desktopThreadsQuery.error.message
                        : "Desktop threads could not be loaded."}
                    </div>
                  ) : filteredDesktopThreads.length === 0 ? (
                    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                      {desktopImportQuery.trim()
                        ? "No desktop threads match this search."
                        : `No ${desktopImportProvider === "codex" ? "Codex" : "Claude"} desktop threads found.`}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredDesktopThreads.map((thread) => {
                        const key = `${thread.provider}:${thread.externalId}`;
                        const isImportingThread = importingDesktopThreadKey === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/70 disabled:opacity-55"
                            disabled={importingDesktopThreadKey !== null}
                            onClick={() => void submitDesktopImport(thread)}
                          >
                            <ProviderIcon provider={thread.provider} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {thread.title}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {thread.cwd ?? "Workspace unavailable"}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                              <span className="tabular-nums">
                                {formatRelativeTime(thread.updatedAt)}
                              </span>
                              {thread.chitauriThreadId ? (
                                <span className="inline-flex items-center gap-1 text-foreground/80">
                                  <CheckIcon className="size-3.5" /> Open
                                </span>
                              ) : isImportingThread ? (
                                "Importing…"
                              ) : (
                                <LuArrowDownToLine className="size-4" />
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {(desktopThreadsQuery.data?.warnings ?? [])
                  .filter((warning) => warning.provider === desktopImportProvider)
                  .map((warning) => (
                    <p
                      key={warning.provider}
                      className="mx-4 mb-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                    >
                      {warning.message}
                    </p>
                  ))}
                {importError ? (
                  <p className="mx-4 mb-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {importError}
                  </p>
                ) : null}
                <div className="flex items-center justify-between border-t border-border/70 px-4 py-3">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setImportError(null);
                      setShowManualImport(true);
                    }}
                  >
                    Import by ID
                  </Button>
                  <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <Command
              autoHighlight={isBrowsing ? false : "always"}
              mode="none"
              onItemHighlighted={(value) => {
                setHighlightedItemValue(typeof value === "string" ? value : null);
              }}
            >
              <CommandPanel className="overflow-hidden">
                <div className="relative">
                  <CommandInput
                    placeholder={
                      isBrowsing
                        ? "Enter project path (e.g. ~/projects/my-app)"
                        : "Search projects, threads, and actions"
                    }
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    onKeyDown={handleBrowseInputKeyDown}
                    startAddon={
                      isBrowsing ? (
                        <LuFolderPlus className="text-muted-foreground" />
                      ) : (
                        <SearchIcon className="text-muted-foreground" />
                      )
                    }
                    className={
                      isBrowsing ? (willCreateMissingFolder ? "pe-36" : "pe-24") : undefined
                    }
                  />
                  {isBrowsing ? (
                    <Button
                      variant="outline"
                      size="xs"
                      tabIndex={-1}
                      className="-translate-y-1/2 absolute end-3 top-1/2 gap-1.5 pe-1 ps-2"
                      disabled={
                        isAddingProject ||
                        unsupportedWindowsPath ||
                        (trimmedQuery.length === 0 && !highlightedFolderPath) ||
                        (!highlightedFolderPath && isExplicitRelativeProjectPath(trimmedQuery))
                      }
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => void submitBrowsePath()}
                      title={
                        hasHighlightedFolderItem
                          ? `${browseSubmitLabel} highlighted folder (${submitModifierLabel} Enter)`
                          : `${browseSubmitLabel} (Enter)`
                      }
                    >
                      <span>{browseSubmitLabel}</span>
                      <KbdGroup className="pointer-events-none -me-0.5 items-center gap-1">
                        <Kbd>
                          {hasHighlightedFolderItem ? `${submitModifierLabel} Enter` : "Enter"}
                        </Kbd>
                      </KbdGroup>
                    </Button>
                  ) : null}
                </div>
                <CommandList className="max-h-[min(24rem,60vh)] not-empty:px-1.5 not-empty:pt-0 not-empty:pb-1.5">
                  {isBrowsing ? (
                    unsupportedWindowsPath ? (
                      <CommandEmpty className="py-10">
                        <div className="text-center text-sm text-muted-foreground/79">
                          Windows paths are not supported on this platform.
                        </div>
                      </CommandEmpty>
                    ) : (
                      <>
                        {canBrowseUp || filteredBrowseEntries.length > 0 ? (
                          <CommandGroup>
                            {canBrowseUp ? (
                              <CommandItem
                                key="browse-up"
                                value="__browse_up__"
                                className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                }}
                                onClick={() => {
                                  if (browseParentPath) setQuery(browseParentPath);
                                }}
                              >
                                <LuCornerLeftUp className="size-3.5 text-muted-foreground/60" />
                                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                  ..
                                </span>
                              </CommandItem>
                            ) : null}
                            {filteredBrowseEntries.map((entry) => (
                              <CommandItem
                                key={entry.fullPath}
                                value={`folder:${entry.fullPath}`}
                                className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                }}
                                onClick={() => setQuery(appendBrowsePathSegment(query, entry.name))}
                              >
                                <FolderClosed className="size-3.5 text-muted-foreground/60" />
                                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                  {entry.name}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        ) : !isBrowseFetching ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            No matching folders.
                          </div>
                        ) : null}
                        {willCreateMissingFolder ? (
                          <div className="mx-1.5 mt-2 rounded-md border border-dashed border-[color:var(--color-border)] px-3 py-2 text-sm text-muted-foreground">
                            Press Enter to create{" "}
                            <span className="text-foreground">{trimmedQuery}</span> and add it as a
                            project.
                          </div>
                        ) : null}
                        {addProjectError ? (
                          <div className="mx-1.5 mt-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            {addProjectError}
                          </div>
                        ) : null}
                      </>
                    )
                  ) : null}

                  {!isBrowsing && matchedActions.length > 0 ? (
                    <CommandGroup>
                      <CommandGroupLabel className="pt-0 pb-1.5 pl-3">Suggested</CommandGroupLabel>
                      {matchedActions.map((action) => {
                        const onSelect = actionHandler(action.id, props);
                        const Icon = ACTION_ICONS[action.id];
                        return (
                          <CommandItem
                            key={action.id}
                            value={`action:${action.id}`}
                            className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5"
                            onMouseDown={(event) => {
                              event.preventDefault();
                            }}
                            onClick={() => {
                              if (action.id === "import-thread") {
                                setImportError(null);
                                setImportId("");
                                setDesktopImportQuery("");
                                setShowManualImport(false);
                                setImportProvider(props.importProviders[0] ?? "codex");
                                props.onModeChange("import");
                                return;
                              }
                              if (action.id === "add-project") {
                                setQuery(getInitialBrowseQuery(props.homeDir));
                                return;
                              }
                              if (!onSelect) return;
                              props.onOpenChange(false);
                              onSelect();
                            }}
                          >
                            {Icon ? <PaletteIcon icon={Icon} /> : null}
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                              {action.label}
                            </span>
                            {action.shortcutLabel ? (
                              <ShortcutKbd
                                shortcutLabel={action.shortcutLabel}
                                groupClassName="shrink-0"
                              />
                            ) : null}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ) : null}

                  {!isBrowsing &&
                  matchedActions.length > 0 &&
                  (matchedThreads.length > 0 || matchedProjects.length > 0 || showThemeSection) ? (
                    <CommandSeparator />
                  ) : null}

                  {!isBrowsing && matchedThreads.length > 0 ? (
                    <CommandGroup>
                      <CommandGroupLabel className="py-1.5 pl-3">
                        {query ? "Threads" : "Recent"}
                      </CommandGroupLabel>
                      {matchedThreads.map(
                        ({ id, matchKind, messageMatchCount, snippet, thread }) => (
                          <CommandItem
                            key={id}
                            value={id}
                            className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2"
                            onMouseDown={(event) => {
                              event.preventDefault();
                            }}
                            onClick={() => {
                              props.onOpenChange(false);
                              props.onOpenThread(thread.id);
                            }}
                          >
                            {isGenericChatThreadTitle(thread.title) ? null : (
                              <ProviderIcon provider={thread.provider} />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-3">
                                <div className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,14px)] text-foreground">
                                  <HighlightedText
                                    text={thread.title || "Untitled thread"}
                                    query={query}
                                  />
                                </div>
                                <span className="w-24 shrink-0 truncate text-right text-[length:var(--app-font-size-ui-meta,12px)] text-muted-foreground/79">
                                  {thread.projectName}
                                </span>
                                {thread.updatedAt || thread.createdAt ? (
                                  <span className="w-10 shrink-0 text-right text-[length:var(--app-font-size-ui-timestamp,11px)] text-muted-foreground/79">
                                    {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
                                  </span>
                                ) : (
                                  <span className="w-10 shrink-0" />
                                )}
                              </div>
                              {snippet ? (
                                <div className="mt-0.5 flex items-start gap-3">
                                  <div className="min-w-0 flex-1 line-clamp-1 text-[length:var(--app-font-size-ui-meta,12px)] leading-5 text-muted-foreground/78">
                                    <HighlightedText text={snippet} query={query} />
                                  </div>
                                  <div className="flex w-[8.5rem] shrink-0 justify-end">
                                    {threadMatchLabel({ matchKind, messageMatchCount }) ? (
                                      <span className="truncate text-[length:var(--app-font-size-ui-meta,12px)] text-muted-foreground/58">
                                        {threadMatchLabel({ matchKind, messageMatchCount })}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ) : threadMatchLabel({ matchKind, messageMatchCount }) ? (
                                <div className="mt-0.5 text-[length:var(--app-font-size-ui-meta,12px)] text-muted-foreground/58">
                                  {threadMatchLabel({ matchKind, messageMatchCount })}
                                </div>
                              ) : null}
                            </div>
                          </CommandItem>
                        ),
                      )}
                    </CommandGroup>
                  ) : null}

                  {!isBrowsing &&
                  matchedThreads.length > 0 &&
                  (matchedProjects.length > 0 || showThemeSection) ? (
                    <CommandSeparator />
                  ) : null}

                  {!isBrowsing && matchedProjects.length > 0 ? (
                    <CommandGroup>
                      <CommandGroupLabel className="py-1.5 pl-3">Projects</CommandGroupLabel>
                      {matchedProjects.map(({ id, project }) => (
                        <CommandItem
                          key={id}
                          value={id}
                          className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5"
                          onMouseDown={(event) => {
                            event.preventDefault();
                          }}
                          onClick={() => {
                            props.onOpenChange(false);
                            props.onOpenProject(project.id);
                          }}
                        >
                          <PaletteIcon icon={HiOutlineFolderOpen} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[length:var(--app-font-size-ui,14px)] text-foreground">
                              {project.name || "Untitled project"}
                            </div>
                            <div className="truncate text-[length:var(--app-font-size-ui-meta,12px)] text-muted-foreground/79">
                              {project.localName
                                ? `${project.folderName} · ${project.cwd}`
                                : project.cwd}
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}

                  {showThemeSection && matchedProjects.length > 0 ? <CommandSeparator /> : null}

                  {showThemeSection ? (
                    <>
                      {themeCommandItems.length > 0 ? (
                        <CommandGroup>
                          <CommandGroupLabel className="py-1.5 pl-3">Configure</CommandGroupLabel>
                          {themeCommandItems.map((themeCommandItem) => (
                            <CommandItem
                              key={themeCommandItem.id}
                              value={themeCommandItem.id}
                              className="cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5"
                              onMouseDown={(event) => {
                                event.preventDefault();
                              }}
                              onClick={() => {
                                if (themeCommandItem.isActive) return;
                                props.onOpenChange(false);
                                setTheme(themeCommandItem.mode);
                              }}
                            >
                              <PaletteIcon icon={THEME_MODE_ICONS[themeCommandItem.mode]} />
                              <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,14px)] text-foreground">
                                {themeCommandItem.label}
                              </span>
                              <span
                                className="flex size-3.5 shrink-0 items-center justify-center"
                                aria-hidden={!themeCommandItem.isActive}
                              >
                                {themeCommandItem.isActive ? (
                                  <CheckIcon className="size-3.5 text-muted-foreground/79" />
                                ) : null}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ) : null}
                    </>
                  ) : null}

                  {!isBrowsing && !hasSearchResults ? (
                    <CommandEmpty className="py-10">
                      <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground/79">
                        <SearchIcon className="size-4 opacity-70" />
                        <div>No matches.</div>
                      </div>
                    </CommandEmpty>
                  ) : null}
                </CommandList>
                <div className="h-1.5" />
              </CommandPanel>
              <CommandFooter>
                {isBrowsing ? (
                  <>
                    <span>
                      {isAddingProject
                        ? "Adding project..."
                        : "Type a path, ↑↓ to navigate folders."}
                    </span>
                    <span>
                      {hasHighlightedFolderItem
                        ? `Enter to open · ${submitModifierLabel}+Enter to add`
                        : hasHighlightedBrowseItem
                          ? "Enter to go up"
                          : "Enter to add project"}
                    </span>
                  </>
                ) : (
                  <>
                    <span>Jump to threads, projects, actions, or appearance.</span>
                    <span>Enter to open</span>
                  </>
                )}
              </CommandFooter>
            </Command>
          </>
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
