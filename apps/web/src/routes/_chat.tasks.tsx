// FILE: _chat.tasks.tsx
// Purpose: Primary Worker-owned Task board and durable Task detail surface.

import {
  ProjectId,
  type OrchestrationTaskShell,
  type TaskArtifactKind,
  type TaskId,
  type TaskStatus,
} from "@t3tools/contracts";
import { getDefaultModel } from "@t3tools/shared/model";
import { formatTaskReference } from "@t3tools/shared/taskReferences";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ProjectSurfaceFrame } from "~/components/ProjectSurfaceFrame";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TaskStatusPill,
} from "~/components/tasks/TaskStatusPill";
import { TASK_ARTIFACT_KINDS, TASK_ARTIFACT_KIND_LABELS } from "~/components/tasks/taskArtifacts";
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
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  GitBranchIcon,
  ListTodoIcon,
  MessageCircleIcon,
  PlusIcon,
} from "~/lib/icons";
import { cn, newCommandId, newTaskId, newThreadId, randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { useComposerDraftStore } from "~/composerDraftStore";
import { tasksForWorker, type TaskVisibility } from "~/taskVisibility";

export const Route = createFileRoute("/_chat/tasks")({
  validateSearch: (search) => ({
    worker: typeof search.worker === "string" ? search.worker : undefined,
    task: typeof search.task === "string" ? search.task : undefined,
    create: search.create === true || search.create === "true" ? true : undefined,
  }),
  component: TasksRoute,
});

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
    const trimmedBrief = brief.trim();
    setPending(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "task.create",
        commandId: newCommandId(),
        taskId,
        workerId,
        title: trimmedTitle,
        brief: trimmedBrief,
        origin: "user",
        createdAt: new Date().toISOString(),
      });
      onCreated(taskId);
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

type WorkerOption = {
  readonly id: ProjectId;
  readonly name: string;
};

function DelegateTaskDialog({
  open,
  requesterWorkerId,
  requesterTaskId,
  workers,
  onOpenChange,
}: {
  open: boolean;
  requesterWorkerId: ProjectId;
  requesterTaskId: TaskId;
  workers: readonly WorkerOption[];
  onOpenChange: (open: boolean) => void;
}) {
  const availableWorkers = workers.filter((worker) => worker.id !== requesterWorkerId);
  const [recipientWorkerId, setRecipientWorkerId] = useState<ProjectId | "">("");
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const [constraints, setConstraints] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setRecipientWorkerId(availableWorkers.at(0)?.id ?? "");
      return;
    }
    setTitle("");
    setRequest("");
    setConstraints("");
    setDeliverables("");
    setPending(false);
  }, [availableWorkers.at(0)?.id, open]);

  const submit = async () => {
    const api = readNativeApi();
    const trimmedTitle = title.trim();
    if (!api || !recipientWorkerId || !trimmedTitle || pending) return;
    const taskId = newTaskId();
    const sections = [
      request.trim() ? `Request\n${request.trim()}` : null,
      constraints.trim() ? `Constraints\n${constraints.trim()}` : null,
      deliverables.trim() ? `Requested deliverables\n${deliverables.trim()}` : null,
    ].filter((section): section is string => section !== null);
    setPending(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "task.create",
        commandId: newCommandId(),
        taskId,
        workerId: recipientWorkerId,
        requesterWorkerId,
        requesterTaskId,
        title: trimmedTitle,
        brief: sections.join("\n\n"),
        origin: "delegation",
        createdAt: new Date().toISOString(),
      });
      try {
        await api.orchestration.dispatchCommand({
          type: "task.update",
          commandId: newCommandId(),
          taskId: requesterTaskId,
          status: "waiting_on_worker",
        });
      } catch {
        toastManager.add({
          type: "warning",
          title: "Request created",
          description: "The parent Task status could not be updated automatically.",
        });
      }
      toastManager.add({ type: "success", title: "Work request sent" });
      onOpenChange(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not send work request",
        description: error instanceof Error ? error.message : "The delegated Task was not created.",
      });
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Request work from another Worker</DialogTitle>
          <DialogDescription>
            The receiving Worker gets an independently inspectable Task in its own repository.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <select
            aria-label="Receiving Worker"
            className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-hidden focus:border-ring"
            value={recipientWorkerId}
            onChange={(event) => setRecipientWorkerId(ProjectId.makeUnsafe(event.target.value))}
          >
            {availableWorkers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.name} Worker
              </option>
            ))}
          </select>
          <Input
            autoFocus
            placeholder="Subject"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            aria-label="Work request"
            placeholder="Required behavior and context"
            value={request}
            onChange={(event) => setRequest(event.target.value)}
          />
          <Textarea
            aria-label="Work request constraints"
            placeholder="Constraints"
            value={constraints}
            onChange={(event) => setConstraints(event.target.value)}
          />
          <Textarea
            aria-label="Requested deliverables"
            placeholder="Commit, pull request, contract, test report…"
            value={deliverables}
            onChange={(event) => setDeliverables(event.target.value)}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!recipientWorkerId || !title.trim() || pending}
            onClick={() => void submit()}
          >
            {pending ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function AddArtifactDialog({
  open,
  task,
  onOpenChange,
}: {
  open: boolean;
  task: OrchestrationTaskShell;
  onOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<TaskArtifactKind>("commit");
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) return;
    setKind("commit");
    setTitle("");
    setReference("");
    setPending(false);
  }, [open]);

  const submit = async () => {
    const api = readNativeApi();
    const trimmedTitle = title.trim();
    if (!api || !trimmedTitle || pending) return;
    setPending(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "task.update",
        commandId: newCommandId(),
        taskId: task.id,
        artifacts: [
          ...task.artifacts,
          {
            id: `artifact:${randomUUID()}`,
            kind,
            title: trimmedTitle,
            reference: reference.trim(),
            createdAt: new Date().toISOString(),
          },
        ],
      });
      onOpenChange(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not attach artifact",
        description: error instanceof Error ? error.message : "The artifact was not saved.",
      });
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Attach durable result</DialogTitle>
          <DialogDescription>
            Keep the result inspectable after execution Threads are closed.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <select
            aria-label="Artifact kind"
            className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-hidden focus:border-ring"
            value={kind}
            onChange={(event) => setKind(event.target.value as TaskArtifactKind)}
          >
            {TASK_ARTIFACT_KINDS.map((value) => (
              <option key={value} value={value}>
                {TASK_ARTIFACT_KIND_LABELS[value]}
              </option>
            ))}
          </select>
          <Input
            autoFocus
            placeholder="Artifact title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Input
            placeholder="Commit SHA, file path, pull request URL, or reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || pending} onClick={() => void submit()}>
            {pending ? "Attaching…" : "Attach artifact"}
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
  const [taskVisibility, setTaskVisibility] = useState<TaskVisibility>("active");
  const workerTasks = useMemo(
    () => tasksForWorker(tasks, selectedWorker?.id, taskVisibility),
    [selectedWorker?.id, taskVisibility, tasks],
  );
  const activeTaskCount = useMemo(
    () => tasksForWorker(tasks, selectedWorker?.id, "active").length,
    [selectedWorker?.id, tasks],
  );
  const closedTaskCount = useMemo(
    () => tasksForWorker(tasks, selectedWorker?.id, "closed").length,
    [selectedWorker?.id, tasks],
  );
  const selectedTask =
    workerTasks.find((task) => task.id === search.task) ?? workerTasks.at(0) ?? null;
  const requesterTask = selectedTask?.requesterTaskId
    ? tasks.find((task) => task.id === selectedTask.requesterTaskId)
    : null;
  const requesterWorker = selectedTask?.requesterWorkerId
    ? workers.find((worker) => worker.id === selectedTask.requesterWorkerId)
    : null;
  const dependencies = selectedTask
    ? tasks.filter((task) => task.requesterTaskId === selectedTask.id)
    : [];
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
  const [delegateDialogOpen, setDelegateDialogOpen] = useState(false);
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);

  useEffect(() => {
    setCreateDialogOpen(search.create === true);
  }, [search.create]);

  useEffect(() => {
    setCompletionDraft(selectedTask?.completionSummary ?? "");
  }, [selectedTask?.completionSummary, selectedTask?.id]);

  useEffect(() => {
    setInstructionsDraft(selectedWorker?.workerInstructions ?? "");
  }, [selectedWorker?.id, selectedWorker?.workerInstructions]);

  useEffect(() => {
    let disposed = false;
    const refreshTasks = async () => {
      const api = readNativeApi();
      if (!api) return;
      const snapshot = await api.orchestration.getShellSnapshot();
      if (!disposed) {
        useStore.getState().syncServerShellSnapshot(snapshot);
      }
    };
    const refreshOnFocus = () => void refreshTasks().catch(() => undefined);

    refreshOnFocus();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

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

  const seedTaskPrompt = (
    task: OrchestrationTaskShell,
    threadId: ReturnType<typeof newThreadId>,
  ) => {
    const composerStore = useComposerDraftStore.getState();
    if (composerStore.draftsByThreadId[threadId]?.prompt.trim()) {
      return;
    }
    composerStore.setPrompt(threadId, [task.title, task.brief].filter(Boolean).join("\n\n"));
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
        envMode: "worktree",
        branch: null,
        worktreePath: null,
        createdAt: new Date().toISOString(),
      });
      useComposerDraftStore
        .getState()
        .setPrompt(threadId, [selectedTask.title, selectedTask.brief].filter(Boolean).join("\n\n"));
      if (selectedTask.status === "open") {
        try {
          await api.orchestration.dispatchCommand({
            type: "task.update",
            commandId: newCommandId(),
            taskId: selectedTask.id,
            status: "in_progress",
          });
        } catch {
          toastManager.add({
            type: "warning",
            title: "Thread started",
            description: "The Task status could not be advanced automatically.",
          });
        }
      }
      await navigate({ to: "/$threadId", params: { threadId } });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not start Thread",
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
              <ListTodoIcon className="size-3.5 text-foreground" />
              <span className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
                Tasks
              </span>
              <select
                aria-label="Worker"
                className="h-8 max-w-52 rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-hidden focus:border-ring"
                value={selectedWorker?.id ?? ""}
                onChange={(event) =>
                  updateSearch({
                    worker: event.target.value,
                    task: undefined,
                    create: undefined,
                  })
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
            <section className="min-h-0 overflow-y-auto border-r border-border p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {selectedWorker ? `${selectedWorker.name} Worker` : "Workers"}
                </span>
                <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
                  {(["active", "closed"] as const).map((visibility) => (
                    <button
                      key={visibility}
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs transition-colors",
                        taskVisibility === visibility
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => {
                        setTaskVisibility(visibility);
                        updateSearch({ task: undefined, create: undefined });
                      }}
                    >
                      {visibility === "active" ? "Active" : "Closed"}{" "}
                      <span className="tabular-nums text-faint">
                        {visibility === "active" ? activeTaskCount : closedTaskCount}
                      </span>
                    </button>
                  ))}
                </div>
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
                        : "text-foreground hover:bg-accent",
                    )}
                    onClick={() => {
                      updateSearch({ task: task.id, create: undefined });
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{task.title}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <TaskStatusPill status={task.status} />
                        <span className="font-mono text-xs text-faint">
                          {formatTaskReference(task.id)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {task.origin}
                        </span>
                      </div>
                    </div>
                    <ChevronRightIcon className="mt-1 size-3.5 shrink-0 text-faint" />
                  </button>
                ))}
                {workerTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                    <p className="text-sm font-medium">
                      {taskVisibility === "active" ? "No active Tasks" : "No closed Tasks"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {taskVisibility === "active"
                        ? "New work created by you or an agent will appear here."
                        : "Completed and cancelled work will remain available here."}
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
                      <TaskStatusPill status={selectedTask.status} />
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatTaskReference(selectedTask.id)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {selectedWorker.name} Worker
                      </span>
                    </div>
                    <h1 className="text-2xl font-semibold text-foreground">{selectedTask.title}</h1>
                    {selectedTask.brief ? (
                      <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {selectedTask.brief}
                      </p>
                    ) : null}
                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Task status"
                        disabled={statusPending}
                        className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-hidden focus:border-ring disabled:opacity-60"
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
                        {threadPending
                          ? "Opening…"
                          : taskThreads.length > 0
                            ? "New Thread for Task"
                            : "Start Task"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={workers.length < 2}
                        onClick={() => setDelegateDialogOpen(true)}
                      >
                        <ArrowRightIcon />
                        Request Worker
                      </Button>
                    </div>
                  </div>

                  {requesterTask && requesterWorker ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/6 p-4 text-left hover:bg-cyan-500/10"
                      onClick={() =>
                        updateSearch({
                          worker: requesterWorker.id,
                          task: requesterTask.id,
                          create: undefined,
                        })
                      }
                    >
                      <ArrowRightIcon className="size-3.5 rotate-180 text-cyan-400" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium tracking-wide text-cyan-400 uppercase">
                          Requested by {requesterWorker.name} Worker
                        </div>
                        <div className="mt-1 truncate text-sm text-foreground">
                          {requesterTask.title}
                        </div>
                      </div>
                      <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                    </button>
                  ) : null}

                  {dependencies.length > 0 ? (
                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ArrowRightIcon className="size-3.5" />
                          Worker dependencies
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {dependencies.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {dependencies.map((dependency) => {
                          const dependencyWorker = workers.find(
                            (worker) => worker.id === dependency.workerId,
                          );
                          return (
                            <button
                              key={dependency.id}
                              type="button"
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
                              onClick={() =>
                                updateSearch({
                                  worker: dependency.workerId,
                                  task: dependency.id,
                                  create: undefined,
                                })
                              }
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium">
                                  {dependency.title}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {dependencyWorker?.name ?? "Unknown"} Worker
                                </div>
                              </div>
                              <TaskStatusPill status={dependency.status} />
                              <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                        <MessageCircleIcon className="size-3.5" />
                        Threads
                      </div>
                      <div className="space-y-1.5">
                        {taskThreads.map((thread) => (
                          <button
                            key={thread.id}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent"
                            onClick={() =>
                              void navigate({
                                to: "/$threadId",
                                params: { threadId: thread.id },
                              })
                            }
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{thread.title}</span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {thread.envMode === "worktree"
                                  ? thread.worktreePath || "Worktree"
                                  : thread.branch
                                    ? `Branch · ${thread.branch}`
                                    : "Local workspace"}
                              </span>
                            </span>
                            <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                          </button>
                        ))}
                        {taskThreads.length === 0 ? (
                          <p className="text-xs leading-5 text-muted-foreground">
                            No Threads are linked to this Task yet. Starting it creates a new
                            worktree-backed Thread.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <GitBranchIcon className="size-3.5" />
                          Artifacts
                        </div>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setArtifactDialogOpen(true)}
                        >
                          <PlusIcon />
                          Attach
                        </Button>
                      </div>
                      <div className="space-y-2 text-xs text-muted-foreground">
                        {selectedTask.artifacts.map((artifact) => (
                          <div key={artifact.id} className="rounded-lg bg-foreground/4 px-2 py-1.5">
                            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                              {TASK_ARTIFACT_KIND_LABELS[artifact.kind]}
                            </div>
                            <div className="mt-0.5 text-foreground">{artifact.title}</div>
                            {artifact.reference ? (
                              <div className="mt-0.5 truncate font-mono text-xs">
                                {artifact.reference}
                              </div>
                            ) : null}
                          </div>
                        ))}
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
                        {selectedTask.artifacts.length === 0 &&
                        taskThreads.every(
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
                        : "border-border bg-card",
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
                      <CheckCircle2Icon className="size-3.5" />
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

                  <div className="rounded-2xl border border-border bg-card p-4">
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
                    <ListTodoIcon className="mx-auto size-5 text-faint" />
                    <h1 className="mt-3 text-lg font-semibold">Worker Tasks</h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Tasks are durable, agent-visible Threads. Create one manually or ask a Worker
                      to capture work from a conversation.
                    </p>
                  </div>
                </div>
              )}

              {selectedWorker && unfiledThreads.length > 0 ? (
                <div className="mx-auto mt-8 max-w-3xl border-t border-border pt-5">
                  <div className="text-xs font-medium text-muted-foreground">
                    Unfiled Threads · {unfiledThreads.length}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
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
        onCreated={(taskId) => {
          setCreateDialogOpen(false);
          updateSearch({ task: taskId, create: undefined });
        }}
      />
      {selectedTask && selectedWorker ? (
        <>
          <DelegateTaskDialog
            open={delegateDialogOpen}
            requesterWorkerId={selectedWorker.id}
            requesterTaskId={selectedTask.id}
            workers={workers}
            onOpenChange={setDelegateDialogOpen}
          />
          <AddArtifactDialog
            open={artifactDialogOpen}
            task={selectedTask}
            onOpenChange={setArtifactDialogOpen}
          />
        </>
      ) : null}
    </ProjectSurfaceFrame>
  );
}
