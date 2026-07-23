// FILE: workerChannelMessages.ts
// Purpose: One id scheme for the messages a cross-Worker request channel injects
//          into a Thread, so the server can mint them and the transcript can
//          recognise them without guessing.
// Layer: shared runtime utility

/**
 * Channel traffic is dispatched into a Thread as ordinary user messages — that
 * is how a turn starts — but it is not something a person typed, and rendering
 * the raw protocol text is noise. The transcript folds these messages into the
 * channel card instead.
 *
 * Recognition is by id rather than by content or dispatch origin: content is
 * model-facing prose that will change, and `dispatchOrigin: "automation"` is
 * also worn by scheduled automations. An id minted from the Task is exact.
 */
const PREFIX = "worker-inbox";

export type WorkerChannelMessageKind = "request" | "reply";

/** Mints the message id for the opening request delivered to the responder. */
export function workerChannelRequestMessageId(taskId: string): string {
  return `${PREFIX}:${taskId}:request`;
}

/**
 * Mints a reply message id. Replies repeat on an open channel, so a unique
 * suffix is required; the prefix keeps them recognisable.
 */
export function workerChannelReplyMessageId(taskId: string, unique: string): string {
  return `${PREFIX}:${taskId}:reply:${unique}`;
}

/**
 * The Task a channel message belongs to, or null when the id is not channel
 * traffic. Used by the transcript to pull these messages out of the normal
 * message flow and attach them to the right channel card.
 */
export function workerChannelTaskIdOf(messageId: string): string | null {
  if (!messageId.startsWith(`${PREFIX}:`)) return null;
  const rest = messageId.slice(PREFIX.length + 1);
  const requestSuffix = ":request";
  if (rest.endsWith(requestSuffix)) {
    const taskId = rest.slice(0, -requestSuffix.length);
    return taskId.length > 0 ? taskId : null;
  }
  const replyMarker = ":reply:";
  const replyAt = rest.indexOf(replyMarker);
  if (replyAt > 0) return rest.slice(0, replyAt);
  return null;
}

/** Whether a message id was minted for channel traffic. */
export function isWorkerChannelMessageId(messageId: string): boolean {
  return workerChannelTaskIdOf(messageId) !== null;
}

/** Which end of the exchange a channel message is, for ordering and labelling. */
export function workerChannelMessageKind(messageId: string): WorkerChannelMessageKind | null {
  if (workerChannelTaskIdOf(messageId) === null) return null;
  return messageId.endsWith(":request") ? "request" : "reply";
}
