// FILE: _chat.tasks.tsx
// Purpose: Primary Worker-owned Task board and durable Task detail surface.

import type { ProjectId, TaskId, TaskStatus } from "@t3tools/contracts";
import { getDefaultModel } from "@t3tools/shared/model";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ProjectSurfaceFrame } from "~/components/ProjectSurfaceFrame";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  GitBranchIcon,
  ListTodoIcon,
  MessageCircleIcon,
  PlusIcon,
} from "~/lib/icons";
import { cn, newCommandId, newTaskId, newThreadId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";

const TASK_STATUSES: readonly TaskStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "in_review",
  "completed",
  "cancelled",
];

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  in_review: "In review",
  completed: "Completed",
  cancelled: "Cancelled",
};

const TASK_STATUS_TONES: Record<TaskStatus, string> = {
  open: "bg-foreground/8 text-muted-foreground",
  in_progress: "bg-blue-500/12 text-blue-400",
  blocked: "bg-amber-500/12 text-amber-400",
  in_review: "bg-violet-500/12 text-violet-400",
  completed: "bg-emerald-500/12 text-emerald-400",
  cancelled: "bg-foreground/6 text-muted-foreground/70",
};

export const Route = createFileRoute("/_chat/tasks")({
  validateSearch: (search) => ({
    worker: typeof search.worker === "string" ? search.worker : undefined,
    task: typeof search.task === "string" ? search.task : undefined,
    create: search.create === true || search.create === "true" ? true : undefined,
  }),
  component: TasksRoute,
});

function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
        TASK_STATUS_TONES[status],
      )}
    >
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

function TaskCreateDialog({
  open,
  workerId,
  workerName,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  workerId: ProjectId | null;
  workerName: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (taskId: TaskId) => void;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) return;
    setTitle("");
    setBrief("");
    setPending(false);
  }, [open]);

  const submit = async () => {
    const api = readNativeApi();
    const trimmedTitle = title.trim();
    if (!api || !workerId || trimmedTitle.length === 0 || pending) return;
    const taskId = newTaskId();
    setPending(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "task.create",
        commandId: newCommandId(),
        taskId,
        workerId,
        title: trimmedTitle,
        brief: brief.trim(),
        origin: "user",
        createdAt: new Date().toISOString(),
      });
      onCreated(taskId);
      onOpenChange(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not create Task",
        description: error instanceof Error ? error.message : "The Task was not created.",
      });
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
          <DialogDescription>
            {workerName ? `${workerName} Worker owns this work.` : "Choose a Worker first."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <Input
            autoFocus
            placeholder="What needs to be accomplished?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <Textarea
            placeholder="Brief, constraints, and completion conditions"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!workerId || title.trim().length === 0 || pending} onClick={submit}>
            {pending ? "Creating…" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function TasksRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const projects = useStore((state) => state.projects);
  const tasks = useStore((state) => state.tasks);
  const threads = useStore((state) => state.threads);
  const workers = useMemo(
    () => projects.filter((project) => project.kind === "project"),
    [projects],
  );
  const selectedWorker =
    workers.find((worker) => worker.id === search.worker) ?? workers.at(0) ?? null;
  const workerTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.workerId === selectedWorker?.id)
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [selectedWorker?.id, tasks],
  );
  const selectedTask =
    workerTasks.find((task) => task.id === search.task) ?? workerTasks.at(0) ?? null;
  const taskThreads = threads.filter((thread) => thread.taskId === selectedTask?.id);
  const unfiledThreads = threads.filter(
    (thread) => thread.projectId === selectedWorker?.id && thread.taskId == null,
  );
  const [createDialogOpen, setCreateDialogOpen] = useState(search.create === true);
  const [statusPending, setStatusPending] = useState(false);
  const [completionPending, setCompletionPending] = useState(false);
  const [completionDraft, setCompletionDraft] = useState(selectedTask?.completionSummary ?? "");
  const [instructionsPending, setInstructionsPending] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState(
    selectedWorker?.workerInstructions ?? "",
  );
  const [threadPending, setThreadPending] = useState(false);

  useEffect(() => {
    setCreateDialogOpen(search.create === true);
  }, [search.create]);

  useEffect(() => {
    setCompletionDraft(selectedTask?.completionSummary ?? "");
  }, [selectedTask?.completionSummary, selectedTask?.id]);

  useEffect(() => {
    setInstructionsDraft(selectedWorker?.workerInstructions ?? "");
  }, [selectedWorker?.id, selectedWorker?.workerInstructions]);

  const updateSearch = (next: {
    worker?: string | undefined;
    task?: string | undefined;
    create?: boolean | undefined;
  }) => {
    void navigate({
      search: (previous) => ({ ...previous, ...next }),
    });
  };

  const updateTaskStatus = async (status: TaskStatus) => {
    const api = readNativeApi();
    if (!api || !selectedTask || statusPending || status === selectedTask.status) return;
    setStatusPending(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "task.update",
        commandId: newCommandId(),
        taskId: selectedTask.id,
        status,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not update Task",
        description: error instanceof Error ? error.message : "The status did not change.",
      });
    } finally {
      setStatusPending(false);
    }
  };

  const saveCompletionSummary = async () => {
    const api = readNativeApi();
    if (!api || !selectedTask || completionPending) return;
    setCompletionPending(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "task.update",
        commandId: newCommandId(),
        taskId: selectedTask.id,
        completionSummary: completionDraft.trim() || null,
      });
      toastManager.add({ type: "success", title: "Task result saved" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save Task result",
        description: error instanceof Error ? error.message : "The result did not change.",
      });
    } finally {
      setCompletionPending(false);
    }
  };

  const saveWorkerInstructions = async () => {
    const api = readNativeApi();
    if (!api || !selectedWorker || instructionsPending) return;
    setInstructionsPending(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: selectedWorker.id,
        workerInstructions: instructionsDraft,
      });
      toastManager.add({ type: "success", title: "Worker instructions saved" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save Worker instructions",
        description: error instanceof Error ? error.message : "The instructions did not change.",
      });
    } finally {
      setInstructionsPending(false);
    }
  };

  const createTaskThread = async () => {
    const api = readNativeApi();
    if (!api || !selectedWorker || !selectedTask || threadPending) return;
    const threadId = newThreadId();
    const defaultModel = getDefaultModel("codex") ?? "gpt-5-codex";
    setThreadPending(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId,
        projectId: selectedWorker.id,
        taskId: selectedTask.id,
        title: selectedTask.title,
        modelSelection: selectedWorker.defaultModelSelection ?? {
          provider: "codex",
          model: defaultModel,
        },
        runtimeMode: "full-access",
        envMode: "local",
        branch: null,
        worktreePath: null,
        createdAt: new Date().toISOString(),
      });
      await navigate({ to: "/$threadId", params: { threadId } });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not start Task thread",
        description: error instanceof Error ? error.message : "The Thread was not created.",
      });
      setThreadPending(false);
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
              <ListTodoIcon className="size-4 text-foreground" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-[590] tracking-[-0.005em] text-foreground">
                Tasks
              </span>
              <select
                aria-label="Worker"
                className="h-8 max-w-52 rounded-lg border border-border/60 bg-background px-2 text-xs text-foreground outline-hidden focus:border-ring"
                value={selectedWorker?.id ?? ""}
                onChange={(event) =>
                  updateSearch({ worker: event.target.value, task: undefined, create: undefined })
                }
              >
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name} Worker
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!selectedWorker}
                onClick={() => {
                  setCreateDialogOpen(true);
                  updateSearch({ create: true });
                }}
              >
                <PlusIcon />
                New Task
              </Button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,0.78fr)_minmax(28rem,1.45fr)] overflow-hidden">
            <section className="min-h-0 overflow-y-auto border-r border-border/50 p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {selectedWorker ? `${selectedWorker.name} Worker` : "Workers"}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground/60">
                  {workerTasks.length}
                </span>
              </div>
              <div className="space-y-1">
                {workerTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors",
                      selectedTask?.id === task.id
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground/88 hover:bg-accent/55",
                    )}
                    onClick={() => updateSearch({ task: task.id, create: undefined })}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{task.title}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusPill status={task.status} />
                        <span className="truncate text-[11px] text-muted-foreground/65">
                          {task.origin}
                        </span>
                      </div>
                    </div>
                    <ChevronRightIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground/50" />
                  </button>
                ))}
                {workerTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center">
                    <p className="text-sm font-medium">No Tasks yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Create the first durable unit of work for this Worker.
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="min-h-0 overflow-y-auto p-6 lg:p-8">
              {selectedTask && selectedWorker ? (
                <div className="mx-auto max-w-3xl space-y-7">
                  <div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <StatusPill status={selectedTask.status} />
                      <span className="text-xs text-muted-foreground">
                        {selectedWorker.name} Worker
                      </span>
                    </div>
                    <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                      {selectedTask.title}
                    </h1>
                    {selectedTask.brief ? (
                      <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {selectedTask.brief}
                      </p>
                    ) : null}
                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Task status"
                        disabled={statusPending}
                        className="h-8 rounded-lg border border-border/60 bg-background px-2 text-xs text-foreground outline-hidden focus:border-ring disabled:opacity-60"
                        value={selectedTask.status}
                        onChange={(event) =>
                          void updateTaskStatus(event.target.value as TaskStatus)
                        }
                      >
                        {TASK_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {TASK_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" onClick={createTaskThread} disabled={threadPending}>
                        <MessageCircleIcon />
                        {threadPending ? "Starting…" : "New Thread"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-border/55 bg-card/45 p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                        <MessageCircleIcon className="size-4" />
                        Threads
                      </div>
                      <div className="space-y-1.5">
                        {taskThreads.map((thread) => (
                          <button
                            key={thread.id}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent"
                            onClick={() =>
                              void navigate({ to: "/$threadId", params: { threadId: thread.id } })
                            }
                          >
                            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                            <ChevronRightIcon className="size-3 text-muted-foreground" />
                          </button>
                        ))}
                        {taskThreads.length === 0 ? (
                          <p className="text-xs leading-5 text-muted-foreground">
                            No execution Threads yet. Start one when the Task is ready for agent
                            work.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/55 bg-card/45 p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                        <GitBranchIcon className="size-4" />
                        Artifacts
                      </div>
                      <div className="space-y-2 text-xs text-muted-foreground">
                        {taskThreads.flatMap((thread) => {
                          const artifacts = [];
                          if (thread.branch) artifacts.push(`Branch · ${thread.branch}`);
                          if (thread.lastKnownPr) {
                            artifacts.push(`Pull request · #${thread.lastKnownPr.number}`);
                          }
                          return artifacts.map((artifact) => (
                            <div
                              key={`${thread.id}:${artifact}`}
                              className="rounded-lg bg-foreground/4 px-2 py-1.5"
                            >
                              {artifact}
                            </div>
                          ));
                        })}
                        {taskThreads.every(
                          (thread) => !thread.branch && thread.lastKnownPr == null,
                        ) ? (
                          <p className="leading-5">
                            Branches, pull requests, and durable results will appear here as Threads
                            produce them.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "rounded-2xl border p-4",
                      selectedTask.status === "completed"
                        ? "border-emerald-500/20 bg-emerald-500/6"
                        : "border-border/55 bg-card/45",
                    )}
                  >
                    <div
                      className={cn(
                        "mb-2 flex items-center gap-2 text-sm font-medium",
                        selectedTask.status === "completed"
                          ? "text-emerald-400"
                          : "text-foreground",
                      )}
                    >
                      <CheckCircle2Icon className="size-4" />
                      Durable result
                    </div>
                    <Textarea
                      aria-label="Task durable result"
                      placeholder="Summarize what changed and attach the important commit, pull request, tests, or follow-up notes."
                      value={completionDraft}
                      onChange={(event) => setCompletionDraft(event.target.value)}
                    />
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          completionPending ||
                          completionDraft.trim() === (selectedTask.completionSummary ?? "")
                        }
                        onClick={saveCompletionSummary}
                      >
                        {completionPending ? "Saving…" : "Save result"}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/55 bg-card/45 p-4">
                    <div className="text-sm font-medium">Worker instructions</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Persistent operating guidance applied to work owned by {selectedWorker.name}.
                    </p>
                    <Textarea
                      className="mt-3"
                      aria-label="Worker instructions"
                      placeholder="Repository-specific operating preferences that do not belong in the repository itself."
                      value={instructionsDraft}
                      onChange={(event) => setInstructionsDraft(event.target.value)}
                    />
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          instructionsPending ||
                          instructionsDraft === (selectedWorker.workerInstructions ?? "")
                        }
                        onClick={saveWorkerInstructions}
                      >
                        {instructionsPending ? "Saving…" : "Save instructions"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-full items-center justify-center">
                  <div className="max-w-sm text-center">
                    <ListTodoIcon className="mx-auto size-7 text-muted-foreground/55" />
                    <h1 className="mt-3 text-lg font-semibold">Worker Tasks</h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Tasks hold durable responsibility. Threads are created beneath them for
                      execution.
                    </p>
                  </div>
                </div>
              )}

              {selectedWorker && unfiledThreads.length > 0 ? (
                <div className="mx-auto mt-8 max-w-3xl border-t border-border/50 pt-5">
                  <div className="text-xs font-medium text-muted-foreground">
                    Unfiled Threads · {unfiledThreads.length}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground/65">
                    Legacy and standalone Threads remain visible without creating fake Tasks.
                  </p>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </RouteInsetSurface>

      <TaskCreateDialog
        open={createDialogOpen}
        workerId={selectedWorker?.id ?? null}
        workerName={selectedWorker?.name ?? null}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) updateSearch({ create: undefined });
        }}
        onCreated={(taskId) => updateSearch({ task: taskId, create: undefined })}
      />
    </ProjectSurfaceFrame>
  );
}
