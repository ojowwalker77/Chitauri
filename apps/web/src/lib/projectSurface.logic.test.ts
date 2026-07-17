import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  resolveMiddleThreadId,
  resolveProjectSurfaceKind,
  resolveProjectSurfaceProjectId,
  resolveProjectSurfaceThreadId,
} from "./projectSurface.logic";

describe("project surface resolution", () => {
  it("classifies project surfaces without treating settings as project-scoped", () => {
    expect(resolveProjectSurfaceKind({ pathname: "/research", hasThreadId: false })).toBe(
      "research",
    );
    expect(resolveProjectSurfaceKind({ pathname: "/github", hasThreadId: false })).toBe("github");
    expect(resolveProjectSurfaceKind({ pathname: "/thread-1", hasThreadId: true })).toBe("chat");
    expect(resolveProjectSurfaceKind({ pathname: "/settings", hasThreadId: false })).toBeNull();
  });

  it("keeps thread-backed routes attached to their thread project", () => {
    expect(
      resolveProjectSurfaceProjectId({
        hasThreadId: true,
        threadProjectId: "thread-project",
        searchProjectId: "search-project",
      }),
    ).toBe("thread-project");
  });

  it("extracts thread ids from chat and research-reader routes only", () => {
    expect(resolveProjectSurfaceThreadId("/thread-1")).toBe("thread-1");
    expect(resolveProjectSurfaceThreadId("/research/document-1/thread-2")).toBe("thread-2");
    expect(resolveProjectSurfaceThreadId("/research/")).toBeNull();
    expect(resolveProjectSurfaceThreadId("/github")).toBeNull();
  });

  it("uses the routed thread in chat and the remembered thread in project tools", () => {
    const routed = ThreadId.makeUnsafe("routed");
    const stored = ThreadId.makeUnsafe("stored");
    const fallback = ThreadId.makeUnsafe("fallback");
    expect(
      resolveMiddleThreadId({
        kind: "chat",
        routeThreadId: routed,
        storedThreadId: stored,
        fallbackThreadId: fallback,
      }),
    ).toBe(routed);
    expect(
      resolveMiddleThreadId({
        kind: "research",
        routeThreadId: null,
        storedThreadId: stored,
        fallbackThreadId: fallback,
      }),
    ).toBe(stored);
  });
});
