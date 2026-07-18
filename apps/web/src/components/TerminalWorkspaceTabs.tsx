// FILE: TerminalWorkspaceTabs.tsx
// Purpose: Renders the top-level workspace switcher between terminal and chat surfaces.
// Layer: Chat workspace chrome
// Depends on: terminal workspace store layout state and shared className helpers.
//
// Note: the two raw <button>s are intentional — they are quiet workspace tabs,
// not generic actions from the Button taxonomy.

import { cn } from "~/lib/utils";

import TerminalActivityIndicator from "./terminal/TerminalActivityIndicator";
import { ThreadRunningSpinner } from "./ThreadRunningSpinner";
import { type ThreadTerminalWorkspaceLayout, type ThreadTerminalWorkspaceTab } from "../types";

interface TerminalWorkspaceTabsProps {
  activeTab: ThreadTerminalWorkspaceTab;
  isWorking: boolean;
  terminalHasRunningActivity: boolean;
  terminalCount: number;
  workspaceLayout: ThreadTerminalWorkspaceLayout;
  onSelectTab: (tab: ThreadTerminalWorkspaceTab) => void;
}

export default function TerminalWorkspaceTabs({
  activeTab,
  isWorking,
  terminalHasRunningActivity,
  terminalCount,
  workspaceLayout,
  onSelectTab,
}: TerminalWorkspaceTabsProps) {
  // Terminal-only workspaces already expose the per-terminal tab strip below,
  // so the chat/terminal switcher would only duplicate chrome and reintroduce chat.
  if (terminalCount <= 1 || workspaceLayout === "terminal-only") {
    return null;
  }

  const tabClassName =
    "group relative inline-flex h-8 shrink-0 items-center rounded-[7px] border border-transparent px-3 text-[13px] transition-[background-color,color,scale] duration-press ease-out active:scale-[0.96]";

  return (
    <div className="relative px-3 py-1 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          className={cn(
            tabClassName,
            activeTab === "terminal"
              ? "bg-selected text-foreground"
              : "bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
          )}
          onClick={() => {
            onSelectTab("terminal");
          }}
        >
          <span>Terminal</span>
          <span className="ml-1.5 text-[11px] text-muted-foreground tabular-nums">
            {terminalCount}
          </span>
          {terminalHasRunningActivity ? (
            <TerminalActivityIndicator className="ml-1.5 text-foreground/75" />
          ) : null}
        </button>
        <button
          type="button"
          className={cn(
            tabClassName,
            activeTab === "chat"
              ? "bg-selected text-foreground"
              : "bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
          )}
          onClick={() => {
            onSelectTab("chat");
          }}
        >
          <span>Chat</span>
          {isWorking ? <ThreadRunningSpinner className="ml-1.5 size-3" /> : null}
        </button>
      </div>
    </div>
  );
}
