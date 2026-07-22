// FILE: projectRunLauncher.ts
// Purpose: Start a project command as a server-owned background process.
// Layer: Web project-run logic
// Exports: launchProjectRun
// Depends on: the `projects.runDevServer` NativeApi surface and the project run store.

import type { NativeApi, ProjectDevServer, ProjectId } from "@t3tools/contracts";

import { useProjectRunStore } from "./projectRunStore";

export interface LaunchProjectRunInput {
  api: NativeApi;
  projectId: ProjectId;
  command: string;
  cwd: string;
  env?: Record<string, string> | undefined;
  /**
   * One-shot commands (worktree setup scripts) tear their shell down as soon as
   * the command returns, so a finished `bun install` is reaped from the registry
   * instead of lingering as a live run.
   */
  oneShot?: boolean | undefined;
}

/**
 * Runs a project command in the server-owned managed process for `projectId`.
 *
 * This is the single entry point for every "run this project command" action —
 * the sidebar run button, the chat header script menu, and worktree setup
 * scripts. There is no client-side terminal: the server owns the PTY, keyed by
 * project, so the process survives reconnects and every client sees the same
 * run state through the `project.devServerEvent` push channel.
 *
 * The store is updated optimistically so the run indicator lights up before the
 * round trip resolves, and rolled back if the launch fails. Callers own error
 * presentation, because the sidebar reports through a toast while the chat
 * reports through the thread error line.
 */
export async function launchProjectRun(input: LaunchProjectRunInput): Promise<ProjectDevServer> {
  const store = useProjectRunStore.getState();
  store.upsertRun({
    projectId: input.projectId,
    command: input.command,
    cwd: input.cwd,
    pid: null,
    startedAt: new Date().toISOString(),
    status: "starting",
  });

  try {
    const { server } = await input.api.projects.runDevServer({
      projectId: input.projectId,
      command: input.command,
      cwd: input.cwd,
      ...(input.env ? { env: input.env } : {}),
      ...(input.oneShot ? { oneShot: true } : {}),
    });
    useProjectRunStore.getState().upsertRun(server);
    return server;
  } catch (error) {
    useProjectRunStore.getState().removeRun(input.projectId);
    throw error;
  }
}
