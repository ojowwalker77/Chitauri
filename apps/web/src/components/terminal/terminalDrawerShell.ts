// FILE: terminalDrawerShell.ts
// Purpose: Single source for the terminal drawer's outer shell geometry so the
//          lazy-loading placeholder occupies exactly the same box as the real
//          drawer and the swap causes no layout shift.
// Layer: Terminal presentation primitive
// Note: Intentionally xterm-free — imported by both the heavy drawer and the
//       light Suspense boundary in LazyThreadTerminalDrawer.tsx.

import { type ThreadTerminalPresentationMode } from "../../types";
import { cn } from "~/lib/utils";
import { PANEL_SURFACE_CLASS_NAME } from "../ui/surface";

export function terminalDrawerShellClassName(
  presentationMode: ThreadTerminalPresentationMode,
): string {
  return cn(
    PANEL_SURFACE_CLASS_NAME,
    "thread-terminal-drawer relative flex min-w-0 flex-col",
    presentationMode === "workspace"
      ? "m-3 h-[calc(100%_-_1.5rem)] min-h-0 w-[calc(100%_-_1.5rem)]"
      : "mx-3 mb-3 w-[calc(100%_-_1.5rem)] shrink-0",
  );
}
