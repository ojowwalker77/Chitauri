// FILE: projectSurface.logic.ts
// Purpose: Pure resolution for the project-scoped surface header (Research / thread / GitHub).
// Layer: Web routing logic (no React, no store access) so it stays unit-testable.
//
// The project header is the single navigation axis across a project's tools. Threads
// change on the left (sidebar); the three project destinations change across the top.
// This module answers two questions from route + state inputs:
//   1. Which project surface is active (or none)?
//   2. Which thread does the middle destination point at?

import { ThreadId } from "@t3tools/contracts";

/** The three project destinations, in header order. */
export type ProjectSurfaceKind = "research" | "chat" | "github";

/** Resolve the backing thread carried by chat and research-reader routes. */
export function resolveProjectSurfaceThreadId(pathname: string): ThreadId | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "research") {
    return segments.length >= 3 ? ThreadId.makeUnsafe(segments.at(-1)!) : null;
  }
  if (segments.length !== 1 || segments[0] === "github" || segments[0] === "settings") {
    return null;
  }
  return ThreadId.makeUnsafe(segments[0]!);
}

/**
 * Classify the current route into a project surface. Returns null for routes that are
 * NOT project-scoped (settings, the restore/index landing, project-less home chats), so
 * the header simply does not render there.
 *
 * Order matters: the research reader (`/research/$researchId/$threadId`) also carries a
 * thread id, so research/github prefixes are checked before the plain chat fallback.
 */
export function resolveProjectSurfaceKind(input: {
  pathname: string;
  hasThreadId: boolean;
}): ProjectSurfaceKind | null {
  const { pathname, hasThreadId } = input;
  if (pathname.startsWith("/settings")) {
    return null;
  }
  if (pathname.startsWith("/github")) {
    return "github";
  }
  if (pathname.startsWith("/research")) {
    return "research";
  }
  // A plain `/$threadId` route with a resolvable project is the chat surface. Everything
  // else (the `/` restore landing, project-less chats) is not project-scoped.
  return hasThreadId ? "chat" : null;
}

/**
 * The project the active surface belongs to. Thread-backed surfaces (chat + the research
 * reader) inherit the project from their thread; the standalone Research/GitHub surfaces
 * carry it in the URL so they never re-ask which project to use.
 */
export function resolveProjectSurfaceProjectId<TProjectId>(input: {
  hasThreadId: boolean;
  threadProjectId: TProjectId | null;
  searchProjectId: TProjectId | null;
}): TProjectId | null {
  return input.hasThreadId ? input.threadProjectId : input.searchProjectId;
}

/**
 * The thread the middle destination renders. On the chat surface it is always the routed
 * thread. On Research/GitHub it is the project's last-selected thread (persisted), falling
 * back to the project's most recent thread so the destination is never a dead end.
 */
export function resolveMiddleThreadId(input: {
  kind: ProjectSurfaceKind;
  routeThreadId: ThreadId | null;
  storedThreadId: ThreadId | null;
  fallbackThreadId: ThreadId | null;
}): ThreadId | null {
  if (input.kind === "chat") {
    return input.routeThreadId;
  }
  return input.storedThreadId ?? input.fallbackThreadId ?? null;
}
