// FILE: LazyThreadTerminalDrawer.tsx
// Purpose: The single code-split boundary for the xterm terminal stack.
// Layer: Chat terminal workspace UI
// Exports: LazyThreadTerminalDrawer (default + named)
//
// Why: `ThreadTerminalDrawer` statically imports `@xterm/xterm`, seven xterm
//      addons and `xterm.css` (~794 kB raw). Importing it from ChatView and
//      DockTerminalPane pinned all of it into the `/_chat/$threadId` static
//      import closure, so every thread paid for the terminal even when no
//      terminal was ever opened. Every render site already sits behind a
//      terminal-open gate, so the drawer is a natural lazy boundary.
//
// Safety: terminal runtimes (the xterm instance + its PTY subscription) live in
//      the module-level `terminalRuntimeRegistry`, not in React state. Unmounting
//      the drawer calls `detach`, which parks the wrapper element in a hidden
//      container and keeps the entry alive; only an explicit `dispose` tears a
//      PTY down. Deferring the mount is therefore state-preserving.
//
// No flash: the Suspense fallback renders the drawer's own shell geometry
//      (`terminalDrawerShellClassName`) at the same height, so the swap to the
//      real drawer is a pure content replacement with no layout shift.

import { Suspense, lazy } from "react";

// `import type` (never a bare `type` specifier) so the heavy module is fully
// erased at build time and only the dynamic `import()` below can pull it in.
import type { ThreadTerminalDrawerProps } from "../ThreadTerminalDrawer";
import { terminalDrawerShellClassName } from "./terminalDrawerShell";
import { clampTerminalDrawerHeight } from "./useTerminalDrawerHeight";

const ThreadTerminalDrawer = lazy(() => import("../ThreadTerminalDrawer"));

function ThreadTerminalDrawerFallback({
  height,
  presentationMode,
}: Pick<ThreadTerminalDrawerProps, "height" | "presentationMode">) {
  return (
    <aside
      aria-hidden="true"
      className={terminalDrawerShellClassName(presentationMode)}
      style={
        presentationMode === "workspace"
          ? undefined
          : { height: `${clampTerminalDrawerHeight(height)}px` }
      }
    />
  );
}

/**
 * Drop-in replacement for `ThreadTerminalDrawer` that keeps the terminal stack
 * out of the caller's chunk. Props are forwarded verbatim; the drawer is a plain
 * function component with no imperative handle, so there is no ref to forward.
 */
export function LazyThreadTerminalDrawer(props: ThreadTerminalDrawerProps) {
  return (
    <Suspense
      fallback={
        <ThreadTerminalDrawerFallback
          height={props.height}
          presentationMode={props.presentationMode}
        />
      }
    >
      <ThreadTerminalDrawer {...props} />
    </Suspense>
  );
}

export default LazyThreadTerminalDrawer;
