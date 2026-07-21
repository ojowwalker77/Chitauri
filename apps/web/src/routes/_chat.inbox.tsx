// FILE: _chat.inbox.tsx
// Purpose: Actionable local Inbox for structured work requests between repository Workers.

import type { ProjectId, TaskStatus } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { ProjectSurfaceFrame } from "~/components/ProjectSurfaceFrame";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { TaskStatusPill } from "~/components/tasks/TaskStatusPill";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { ArrowRightIcon, ChevronRightIcon, InboxIcon } from "~/lib/icons";
import { cn, newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";

export const Route = createFileRoute("/_chat/inbox")({
  validateSearch: (search) => ({
    worker: typeof search.worker === "string" ? search.worker : undefined,
    request: typeof search.request === "string" ? search.request : undefined,
  }),
  component: InboxRoute,
});

function InboxRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const projects = useStore((state) => state.projects);
  const tasks = useStore((state) => state.tasks);
  const workers = useMemo(
    () => projects.filter((project) => project.kind === "project"),
    [projects],
  );
  const selectedWorker =
    workers.find((worker) => worker.id === search.worker) ?? workers.at(0) ?? null;
  const requests = useMemo(
    () =>
      tasks
        .filter((task) => task.workerId === selectedWorker?.id && task.origin === "delegation")
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [selectedWorker?.id, tasks],
  );
  const selectedRequest =
    requests.find((request) => request.id === search.request) ?? requests.at(0) ?? null;
  const requesterWorker = selectedRequest?.requesterWorkerId
    ? workers.find((worker) => worker.id === selectedRequest.requesterWorkerId)
    : null;
  const requesterTask = selectedRequest?.requesterTaskId
    ? tasks.find((task) => task.id === selectedRequest.requesterTaskId)
    : null;
  const [pendingStatus, setPendingStatus] = useState<TaskStatus | null>(null);

  const updateSearch = (next: { worker?: string; request?: string | undefined }) => {
    void navigate({ search: (previous) => ({ ...previous, ...next }) });
  };

  const updateRequestStatus = async (status: TaskStatus) => {
    const api = readNativeApi();
    if (!api || !selectedRequest || pendingStatus) return;
    setPendingStatus(status);
    try {
      await api.orchestration.dispatchCommand({
        type: "task.update",
        commandId: newCommandId(),
        taskId: selectedRequest.id,
        status,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not update request",
        description: error instanceof Error ? error.message : "The request did not change.",
      });
    } finally {
      setPendingStatus(null);
    }
  };

  return (
    <ProjectSurfaceFrame>
      <RouteInsetSurface>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header
            className={cn(
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              "drag-region",
            )}
          >
            <div className={cn("flex items-center gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}>
              <SidebarHeaderNavigationControls />
              <InboxIcon className="size-4 text-foreground" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-[590] tracking-[-0.005em] text-foreground">
                Inbox
              </span>
              <select
                aria-label="Worker"
                className="h-8 max-w-52 rounded-lg border border-border/60 bg-background px-2 text-xs text-foreground outline-hidden focus:border-ring"
                value={selectedWorker?.id ?? ""}
                onChange={(event) =>
                  updateSearch({ worker: event.target.value, request: undefined })
                }
              >
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name} Worker
                  </option>
                ))}
              </select>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,0.78fr)_minmax(28rem,1.45fr)] overflow-hidden">
            <section className="min-h-0 overflow-y-auto border-r border-border/50 p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Requests
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground/60">
                  {requests.length}
                </span>
              </div>
              <div className="space-y-1">
                {requests.map((request) => {
                  const source = workers.find((worker) => worker.id === request.requesterWorkerId);
                  return (
                    <button
                      key={request.id}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors",
                        selectedRequest?.id === request.id
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground/88 hover:bg-accent/55",
                      )}
                      onClick={() => updateSearch({ request: request.id })}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{request.title}</div>
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">
                          {source?.name ?? "Unknown"} Worker
                        </div>
                      </div>
                      <TaskStatusPill status={request.status} />
                    </button>
                  );
                })}
                {requests.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center">
                    <p className="text-sm font-medium">Inbox clear</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Structured requests from other repository Workers appear here.
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="min-h-0 overflow-y-auto p-6 lg:p-8">
              {selectedRequest && selectedWorker ? (
                <div className="mx-auto max-w-3xl space-y-6">
                  <div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <TaskStatusPill status={selectedRequest.status} />
                      <span className="text-xs text-muted-foreground">
                        From {requesterWorker?.name ?? "Unknown"} Worker
                      </span>
                    </div>
                    <h1 className="text-2xl font-semibold tracking-[-0.02em]">
                      {selectedRequest.title}
                    </h1>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {selectedRequest.status === "open" ? (
                        <Button
                          size="sm"
                          disabled={pendingStatus !== null}
                          onClick={() => void updateRequestStatus("in_progress")}
                        >
                          Accept request
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void navigate({
                            to: "/tasks",
                            search: {
                              worker: selectedWorker.id,
                              task: selectedRequest.id,
                              create: undefined,
                            },
                          })
                        }
                      >
                        Open Task
                        <ChevronRightIcon />
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/55 bg-card/45 p-5">
                    <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      Work request
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/88">
                      {selectedRequest.brief || "No additional request details were provided."}
                    </p>
                  </div>

                  {requesterTask && requesterWorker ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-2xl border border-border/55 bg-card/45 p-4 text-left hover:bg-accent/55"
                      onClick={() =>
                        void navigate({
                          to: "/tasks",
                          search: {
                            worker: requesterWorker.id,
                            task: requesterTask.id,
                            create: undefined,
                          },
                        })
                      }
                    >
                      <ArrowRightIcon className="size-4 rotate-180 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-muted-foreground">Requesting Task</div>
                        <div className="mt-1 truncate text-sm font-medium">
                          {requesterTask.title}
                        </div>
                      </div>
                      <ChevronRightIcon className="size-4 text-muted-foreground" />
                    </button>
                  ) : null}

                  {selectedRequest.completionSummary ? (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/6 p-5">
                      <div className="text-[11px] font-medium tracking-wide text-emerald-400 uppercase">
                        Durable result
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                        {selectedRequest.completionSummary}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex min-h-full items-center justify-center">
                  <div className="max-w-sm text-center">
                    <InboxIcon className="mx-auto size-7 text-muted-foreground/55" />
                    <h1 className="mt-3 text-lg font-semibold">Worker Inbox</h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Requests stay separate from execution Threads and remain inspectable as Tasks.
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </RouteInsetSurface>
    </ProjectSurfaceFrame>
  );
}
