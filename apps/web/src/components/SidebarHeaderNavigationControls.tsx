// FILE: SidebarHeaderNavigationControls.tsx
// Purpose: Single source for the sidebar toggle shown across shell headers.
// Layer: Shared web shell chrome
// Depends on: Sidebar state

import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { cn } from "~/lib/utils";

/**
 * The leading shell control: the sidebar toggle on its own.
 *
 * It renders in two distinct places — inside the OPEN sidebar header (where it
 * slides off-canvas with the sidebar) and in host top bars AFTER an off-canvas
 * close (chat/workspace/settings/plugin headers). Keeping it in ONE component is
 * what makes those two states visually identical. The wrapper layout
 * (hidden/md:flex, ml-auto, …) varies per host, so it is passed in via
 * `className`; the control itself stays constant.
 */
export function SidebarLeadingControls({ className }: { className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <SidebarTrigger
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Toggle thread sidebar"
      />
    </div>
  );
}

/**
 * Host-header variant of {@link SidebarLeadingControls}: only appears once the
 * in-sidebar control is gone (sidebar collapsed, or mobile where the drawer floats
 * over content). When the sidebar is open on desktop the in-sidebar header owns the
 * control, so this renders nothing to avoid a duplicate toggle.
 */
export function SidebarHeaderNavigationControls() {
  const { isMobile, open } = useSidebar();

  if (!isMobile && open) {
    return null;
  }

  return <SidebarLeadingControls />;
}
