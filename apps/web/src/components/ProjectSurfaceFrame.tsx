// FILE: ProjectSurfaceFrame.tsx
// Purpose: Shared layout boundary for chat, Research, and GitHub work surfaces.
// Layer: Shared chat shell layout

import type { ReactNode } from "react";

export function ProjectSurfaceFrame({ children }: { children: ReactNode }) {
  return <div className="relative flex min-h-0 min-w-0 flex-1">{children}</div>;
}
