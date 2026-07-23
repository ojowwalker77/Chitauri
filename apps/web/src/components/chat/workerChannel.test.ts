import { ProjectId, TaskId, ThreadId, type OrchestrationTaskShell } from "@t3tools/contracts";
import {
  workerChannelReplyMessageId,
  workerChannelRequestMessageId,
} from "@t3tools/shared/workerChannelMessages";
import { describe, expect, it } from "vitest";

import { deriveWorkerChannels, isWorkerChannelOpen, workerChannelStatus } from "./workerChannel";

const requesterWorker = ProjectId.makeUnsafe("worker-a");
const recipientWorker = ProjectId.makeUnsafe("worker-b");
const requesterThread = ThreadId.makeUnsafe("thread-a");
const responderThread = ThreadId.makeUnsafe("thread-b");
const taskId = TaskId.makeUnsafe("task-1");

const workers = [
  { id: requesterWorker, title: "phibrowser-mac" },
  { id: recipientWorker, title: "BonsAI" },
];

function task(overrides: Partial<OrchestrationTaskShell> = {}): OrchestrationTaskShell {
  return {
    id: taskId,
    workerId: recipientWorker,
    requesterWorkerId: requesterWorker,
    requesterTaskId: null,
    requesterThreadId: requesterThread,
    title: "Project system design",
    brief: "Could you share the design of your project system?",
    status: "in_progress",
    origin: "delegation",
    artifacts: [],
    completionSummary: null,
    createdAt: "2026-07-22T20:47:00.000Z",
    updatedAt: "2026-07-22T20:47:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

const threads = [
  { id: requesterThread, taskId: null },
  { id: responderThread, taskId },
];

describe("deriveWorkerChannels", () => {
  it("shows the requester its channel with the peer thread bound", () => {
    const [channel] = deriveWorkerChannels({
      threadId: requesterThread,
      threadTaskId: null,
      tasks: [task()],
      threads,
      workers,
      messages: [],
    });

    expect(channel).toMatchObject({
      side: "requester",
      status: "waiting",
      subject: "Project system design",
      peerWorkerTitle: "BonsAI",
      peerThreadId: responderThread,
    });
    // The card shows the body as sent, never the protocol text wrapped around it.
    expect(channel?.ask).toBe("Could you share the design of your project system?");
  });

  it("shows the responder the same channel from the other end", () => {
    const [channel] = deriveWorkerChannels({
      threadId: responderThread,
      threadTaskId: taskId,
      tasks: [task()],
      threads,
      workers,
      messages: [],
    });

    expect(channel).toMatchObject({
      side: "responder",
      peerWorkerTitle: "phibrowser-mac",
      peerThreadId: requesterThread,
    });
  });

  it("ignores Threads that are not an end of the channel", () => {
    expect(
      deriveWorkerChannels({
        threadId: ThreadId.makeUnsafe("thread-outsider"),
        threadTaskId: null,
        tasks: [task()],
        threads,
        workers,
        messages: [],
      }),
    ).toEqual([]);
  });

  it("ignores ordinary Tasks", () => {
    expect(
      deriveWorkerChannels({
        threadId: responderThread,
        threadTaskId: taskId,
        tasks: [task({ origin: "user" })],
        threads,
        workers,
        messages: [],
      }),
    ).toEqual([]);
  });

  // Channel traffic is folded into the card, so the card must be able to find it
  // by the minted id rather than by scanning message text.
  it("collects injected channel traffic and flips to answered on a reply", () => {
    const [channel] = deriveWorkerChannels({
      threadId: requesterThread,
      threadTaskId: null,
      tasks: [task()],
      threads,
      workers,
      messages: [
        { id: "msg-typed", text: "unrelated", createdAt: "2026-07-22T20:46:00.000Z" },
        {
          id: workerChannelRequestMessageId(taskId),
          text: "the request prompt",
          createdAt: "2026-07-22T20:47:00.000Z",
        },
        {
          id: workerChannelReplyMessageId(taskId, "r1"),
          text: "Boards persist as one document per board.",
          createdAt: "2026-07-22T20:49:00.000Z",
        },
      ],
    });

    expect(channel?.status).toBe("answered");
    expect(channel?.messages.map((message) => message.kind)).toEqual(["request", "reply"]);
    expect(channel?.messages.at(-1)?.text).toBe("Boards persist as one document per board.");
  });

  it("reports a channel with no responder Thread yet", () => {
    const [channel] = deriveWorkerChannels({
      threadId: requesterThread,
      threadTaskId: null,
      tasks: [task()],
      threads: [{ id: requesterThread, taskId: null }],
      workers,
      messages: [],
    });

    expect(channel?.peerThreadId).toBeNull();
    expect(channel?.status).toBe("waiting");
  });
});

describe("workerChannelStatus", () => {
  it("separates a closed channel from one that merely replied", () => {
    expect(workerChannelStatus({ task: task(), hasReply: false })).toBe("waiting");
    expect(workerChannelStatus({ task: task(), hasReply: true })).toBe("answered");
    expect(workerChannelStatus({ task: task({ status: "completed" }), hasReply: true })).toBe(
      "closed",
    );
    expect(workerChannelStatus({ task: task({ status: "cancelled" }), hasReply: false })).toBe(
      "cancelled",
    );
  });

  it("treats only settled channels as no longer replyable", () => {
    expect(isWorkerChannelOpen("waiting")).toBe(true);
    expect(isWorkerChannelOpen("answered")).toBe(true);
    expect(isWorkerChannelOpen("closed")).toBe(false);
    expect(isWorkerChannelOpen("cancelled")).toBe(false);
  });
});
