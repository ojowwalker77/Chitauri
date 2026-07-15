// FILE: _chat.research.tsx
// Purpose: Parent layout for the first-class Research workspace.

import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/research")({
  component: ResearchLayout,
});

function ResearchLayout() {
  return <Outlet />;
}
