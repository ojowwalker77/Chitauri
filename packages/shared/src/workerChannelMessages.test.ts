import { describe, expect, it } from "vitest";
import {
  isWorkerChannelMessageId,
  workerChannelMessageKind,
  workerChannelReplyMessageId,
  workerChannelRequestMessageId,
  workerChannelTaskIdOf,
} from "./workerChannelMessages";

describe("worker channel message ids", () => {
  const taskId = "d5f9b327-9fbc-497a-8cc6-902805230165";

  it("round-trips the Task id through a request id", () => {
    const id = workerChannelRequestMessageId(taskId);
    expect(workerChannelTaskIdOf(id)).toBe(taskId);
    expect(workerChannelMessageKind(id)).toBe("request");
  });

  it("round-trips the Task id through a reply id", () => {
    const id = workerChannelReplyMessageId(taskId, "abc-123");
    expect(workerChannelTaskIdOf(id)).toBe(taskId);
    expect(workerChannelMessageKind(id)).toBe("reply");
  });

  // Typed messages must never be swallowed by the channel card.
  it("does not claim ordinary message ids", () => {
    for (const id of ["msg-1", crypto.randomUUID(), "worker-inbox", "worker-inboxish:x:request"]) {
      expect(workerChannelTaskIdOf(id)).toBeNull();
      expect(isWorkerChannelMessageId(id)).toBe(false);
    }
  });

  it("keeps replies on one channel distinct", () => {
    const a = workerChannelReplyMessageId(taskId, "one");
    const b = workerChannelReplyMessageId(taskId, "two");
    expect(a).not.toBe(b);
    expect(workerChannelTaskIdOf(a)).toBe(workerChannelTaskIdOf(b));
  });
});
