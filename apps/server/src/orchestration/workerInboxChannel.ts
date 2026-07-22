// FILE: workerInboxChannel.ts
// Purpose: Pure rules for the two-Thread channel behind a cross-Worker inbox request.
// Layer: Server orchestration logic
// Exports: delegationTasksAwaitingResponder, responderThreadIdFor, peerThreadFor,
//          buildDelegationRequestPrompt, buildDelegationReplyPrompt, CHANNEL_CLOSED_STATUSES

import type {
  OrchestrationShellSnapshot,
  OrchestrationTaskShell,
  ThreadId,
} from "@t3tools/contracts";

/**
 * A delegation Task is a live channel between two Threads: the Thread that sent
 * the request (`task.requesterThreadId`) and the Thread spawned to fulfil it
 * (the Task's canonical Thread — `thread.taskId`, unique per Task).
 *
 * The channel stays open, and either side may keep talking, until the Task
 * reaches a closed status. Closing is deliberate: neither side should have to
 * guess whether a follow-up is still welcome.
 */
export const CHANNEL_CLOSED_STATUSES: ReadonlySet<OrchestrationTaskShell["status"]> = new Set([
  "completed",
  "cancelled",
]);

type ThreadShell = OrchestrationShellSnapshot["threads"][number];

/** The Thread spawned to work the request, or null before the reactor has spawned it. */
export function responderThreadIdFor(input: {
  readonly taskId: OrchestrationTaskShell["id"];
  readonly threads: ReadonlyArray<ThreadShell>;
}): ThreadId | null {
  return input.threads.find((thread) => thread.taskId === input.taskId)?.id ?? null;
}

/**
 * Given a Thread on one end of a channel, resolve the Thread on the other end.
 * Returns null when the caller is not on this channel, so a Worker can never
 * push a message into a conversation it is not part of.
 */
export function peerThreadFor(input: {
  readonly task: OrchestrationTaskShell;
  readonly threads: ReadonlyArray<ThreadShell>;
  readonly callerThreadId: ThreadId;
}): { readonly peerThreadId: ThreadId; readonly callerSide: "requester" | "responder" } | null {
  const responderThreadId = responderThreadIdFor({ taskId: input.task.id, threads: input.threads });
  if (input.callerThreadId === input.task.requesterThreadId) {
    return responderThreadId ? { peerThreadId: responderThreadId, callerSide: "requester" } : null;
  }
  if (responderThreadId && input.callerThreadId === responderThreadId) {
    return input.task.requesterThreadId
      ? { peerThreadId: input.task.requesterThreadId, callerSide: "responder" }
      : null;
  }
  return null;
}

/**
 * Delegation Tasks that still need a Thread spawned to work them.
 *
 * Used both on the live `task.created` path and on startup recovery, so a
 * request that arrived while the server was down is not stranded. Selection is
 * idempotent: once a canonical Thread exists the Task drops out of the set.
 */
export function delegationTasksAwaitingResponder(
  snapshot: OrchestrationShellSnapshot,
): ReadonlyArray<OrchestrationTaskShell> {
  return snapshot.tasks.filter(
    (task) =>
      task.origin === "delegation" &&
      !CHANNEL_CLOSED_STATUSES.has(task.status) &&
      responderThreadIdFor({ taskId: task.id, threads: snapshot.threads }) === null,
  );
}

function channelProtocol(taskId: OrchestrationTaskShell["id"]): string {
  return [
    `This conversation is a channel with the requesting Worker. The channel id is ${taskId}.`,
    `Reply with the inbox_reply tool (request_id: ${taskId}) — that is the only way your answer reaches them.`,
    "You may exchange several messages; the channel stays open until one side closes it.",
    "Pass close: true on your final reply when the request is fully answered, or use tasks_close.",
    "Never edit the requesting Worker's repository. Answer from your own repository only.",
  ].join("\n");
}

/** The opening prompt for the auto-spawned Thread that will answer a request. */
export function buildDelegationRequestPrompt(input: {
  readonly task: OrchestrationTaskShell;
  readonly requesterWorkerTitle: string;
}): string {
  return [
    `The ${input.requesterWorkerTitle} Worker sent this repository a request.`,
    "",
    `Subject: ${input.task.title}`,
    "",
    input.task.brief.trim(),
    "",
    channelProtocol(input.task.id),
  ].join("\n");
}

/** The prompt delivered to the far end of an open channel when a reply arrives. */
export function buildDelegationReplyPrompt(input: {
  readonly task: OrchestrationTaskShell;
  readonly fromWorkerTitle: string;
  readonly body: string;
  readonly closed: boolean;
}): string {
  return [
    input.closed
      ? `The ${input.fromWorkerTitle} Worker answered your request "${input.task.title}" and closed the channel.`
      : `The ${input.fromWorkerTitle} Worker replied on your request "${input.task.title}".`,
    "",
    input.body.trim(),
    "",
    input.closed
      ? "The channel is closed; send a new request with inbox_send if you need more. Continue the work this answer was blocking."
      : `Continue the work this answer was blocking. To follow up, use inbox_reply with request_id: ${input.task.id}.`,
  ].join("\n");
}
