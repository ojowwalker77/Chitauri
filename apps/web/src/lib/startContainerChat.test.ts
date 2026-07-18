import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { startContainerChat } from "./startContainerChat";

describe("startContainerChat", () => {
  it("returns the fresh thread id for capture routing", async () => {
    const projectId = ProjectId.makeUnsafe("project-home");
    const threadId = ThreadId.makeUnsafe("thread-appsnap");
    const handleNewThread = vi.fn(async () => threadId);

    await expect(
      startContainerChat({
        ensureProjectId: async () => projectId,
        handleNewThread,
        fresh: true,
        errorLabel: "Could not create a task.",
      }),
    ).resolves.toEqual({ ok: true, threadId });
    expect(handleNewThread).toHaveBeenCalledWith(projectId, {
      fresh: true,
      envMode: "local",
      worktreePath: null,
    });
  });

  it("keeps project preparation failures typed", async () => {
    await expect(
      startContainerChat({
        ensureProjectId: async () => null,
        handleNewThread: vi.fn(),
        errorLabel: "Could not create a task.",
      }),
    ).resolves.toEqual({ ok: false, error: "Could not create a task." });
  });
});
