// FILE: workerChannel.ts
// Purpose: Derive the channel-card view of a cross-Worker request from store state.
// Layer: web chat feature (pure logic, no I/O)
// Exports: deriveWorkerChannels, workerChannelStatus, type WorkerChannelView

import type { OrchestrationTaskShell, ProjectId, TaskId, ThreadId } from "@t3tools/contracts";
import {
  workerChannelMessageKind,
  workerChannelTaskIdOf,
} from "@t3tools/shared/workerChannelMessages";

/**
 * A delegation Task seen from one Thread. The Task is the channel; this is the
 * end of it the current Thread is standing on, plus the traffic that has flowed
 * through it, ready to render as a card.
 */
export interface WorkerChannelView {
  readonly taskId: TaskId;
  /** Which end of the channel the current Thread is. */
  readonly side: "requester" | "responder";
  readonly status: WorkerChannelStatus;
  readonly subject: string;
  /** The request body as sent — never the protocol text wrapped around it. */
  readonly ask: string;
  readonly peerWorkerId: ProjectId | null;
  readonly peerWorkerTitle: string;
  /** The Thread at the other end, once it exists. */
  readonly peerThreadId: ThreadId | null;
  readonly messages: ReadonlyArray<WorkerChannelMessage>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkerChannelMessage {
  readonly id: string;
  readonly kind: "request" | "reply";
  /** Which Worker sent it, as a display title. */
  readonly fromWorkerTitle: string;
  readonly text: string;
  readonly createdAt: string;
}

export type WorkerChannelStatus = "waiting" | "answered" | "closed" | "cancelled";

type RawChannelMessage = Omit<WorkerChannelMessage, "fromWorkerTitle">;

const CLOSED_STATUSES = new Set<OrchestrationTaskShell["status"]>(["completed", "cancelled"]);

/**
 * Card status, which is not the Task status: a Task is `in_progress` from the
 * moment the responder session starts until it closes, but the reader wants to
 * know whether an answer has actually come back.
 */
export function workerChannelStatus(input: {
  readonly task: OrchestrationTaskShell;
  readonly hasReply: boolean;
}): WorkerChannelStatus {
  if (input.task.status === "cancelled") return "cancelled";
  if (input.task.status === "completed") return "closed";
  return input.hasReply ? "answered" : "waiting";
}

interface DeriveInput {
  readonly threadId: ThreadId | null;
  readonly threadTaskId: TaskId | null;
  readonly tasks: ReadonlyArray<OrchestrationTaskShell>;
  readonly threads: ReadonlyArray<{ readonly id: ThreadId; readonly taskId?: TaskId | null }>;
  readonly workers: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>;
  /** Every message in the current Thread, in transcript order. */
  readonly messages: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly createdAt: string;
  }>;
}

/**
 * Every channel this Thread is an end of.
 *
 * A Thread is the requester when it sent the request, and the responder when it
 * is the Task's canonical Thread. Both are read from durable state rather than
 * from the messages, so a channel still renders after a reload with no traffic
 * in view.
 */
export function deriveWorkerChannels(input: DeriveInput): ReadonlyArray<WorkerChannelView> {
  if (!input.threadId) return [];

  const workerTitle = (id: ProjectId | null): string =>
    (id ? input.workers.find((worker) => worker.id === id)?.title : undefined) ??
    "the other Worker";

  // Channel traffic is grouped by Task once, so a Thread holding several
  // channels does not rescan its whole message list per channel. The sender is
  // not stored here: it is always the peer, because a Thread never receives its
  // own outgoing message, and the peer is only known inside the Task loop below.
  const trafficByTask = new Map<string, RawChannelMessage[]>();
  for (const message of input.messages) {
    const taskId = workerChannelTaskIdOf(message.id);
    const kind = workerChannelMessageKind(message.id);
    if (!taskId || !kind) continue;
    const bucket = trafficByTask.get(taskId) ?? [];
    bucket.push({ id: message.id, kind, text: message.text, createdAt: message.createdAt });
    trafficByTask.set(taskId, bucket);
  }

  const channels: WorkerChannelView[] = [];

  for (const task of input.tasks) {
    if (task.origin !== "delegation") continue;

    const isRequester = task.requesterThreadId === input.threadId;
    const isResponder = input.threadTaskId !== null && input.threadTaskId === task.id;
    if (!isRequester && !isResponder) continue;

    const side = isRequester ? "requester" : "responder";
    const peerWorkerId = side === "requester" ? task.workerId : task.requesterWorkerId;
    const responderThreadId = input.threads.find((thread) => thread.taskId === task.id)?.id ?? null;
    const peerThreadId = side === "requester" ? responderThreadId : task.requesterThreadId;

    const peerTitle = workerTitle(peerWorkerId);
    const traffic: WorkerChannelMessage[] = (trafficByTask.get(task.id) ?? []).map((message) => ({
      id: message.id,
      kind: message.kind,
      fromWorkerTitle: peerTitle,
      text: message.text,
      createdAt: message.createdAt,
    }));
    const hasReply = traffic.some((message) => message.kind === "reply");

    channels.push({
      taskId: task.id,
      side,
      status: workerChannelStatus({ task, hasReply }),
      subject: task.title,
      ask: task.brief,
      peerWorkerId,
      peerWorkerTitle: peerTitle,
      peerThreadId,
      messages: traffic,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  }

  return channels;
}

/** Whether a channel can still take a reply. */
export function isWorkerChannelOpen(status: WorkerChannelStatus): boolean {
  return status === "waiting" || status === "answered";
}

export { CLOSED_STATUSES as WORKER_CHANNEL_CLOSED_TASK_STATUSES };
