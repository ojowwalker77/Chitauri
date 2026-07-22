import {
  ProjectId,
  TaskId,
  ThreadId,
  type OrchestrationShellSnapshot,
  type OrchestrationTaskShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildDelegationReplyPrompt,
  buildDelegationRequestPrompt,
  delegationTasksAwaitingResponder,
  peerThreadFor,
  responderThreadIdFor,
} from "./workerInboxChannel.ts";

const requesterWorker = ProjectId.makeUnsafe("worker-a");
const recipientWorker = ProjectId.makeUnsafe("worker-b");
const requesterThread = ThreadId.makeUnsafe("thread-a");
const responderThread = ThreadId.makeUnsafe("thread-b");
const requestId = TaskId.makeUnsafe("task-request");

function delegationTask(overrides: Partial<OrchestrationTaskShell> = {}): OrchestrationTaskShell {
  return {
    id: requestId,
    workerId: recipientWorker,
    requesterWorkerId: requesterWorker,
    requesterTaskId: null,
    requesterThreadId: requesterThread,
    title: "Share the design system",
    brief: "Send tokens and component states.",
    status: "open",
    origin: "delegation",
    artifacts: [],
    completionSummary: null,
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function thread(id: ThreadId, taskId: TaskId | null) {
  return { id, taskId } as OrchestrationShellSnapshot["threads"][number];
}

function snapshot(input: {
  tasks: ReadonlyArray<OrchestrationTaskShell>;
  threads: ReadonlyArray<OrchestrationShellSnapshot["threads"][number]>;
}) {
  return input as unknown as OrchestrationShellSnapshot;
}

describe("responderThreadIdFor", () => {
  it("resolves the Task's canonical Thread as the responder end", () => {
    expect(
      responderThreadIdFor({
        taskId: requestId,
        threads: [thread(requesterThread, null), thread(responderThread, requestId)],
      }),
    ).toBe(responderThread);
  });

  it("is null before the reactor has spawned a Thread", () => {
    expect(
      responderThreadIdFor({ taskId: requestId, threads: [thread(requesterThread, null)] }),
    ).toBeNull();
  });
});

describe("delegationTasksAwaitingResponder", () => {
  it("selects only open delegation Tasks with no Thread yet", () => {
    const answered = delegationTask({ id: TaskId.makeUnsafe("task-answered") });
    const closed = delegationTask({ id: TaskId.makeUnsafe("task-closed"), status: "completed" });
    const ordinary = delegationTask({ id: TaskId.makeUnsafe("task-plain"), origin: "user" });

    const pending = delegationTasksAwaitingResponder(
      snapshot({
        tasks: [delegationTask(), answered, closed, ordinary],
        threads: [thread(responderThread, answered.id)],
      }),
    );

    expect(pending.map((task) => task.id)).toEqual([requestId]);
  });

  // The reactor runs this on every startup, so a Task that already has its Thread
  // must never be selected again — that would breach one Task, one canonical Thread.
  it("does not reselect a Task once its Thread exists", () => {
    expect(
      delegationTasksAwaitingResponder(
        snapshot({
          tasks: [delegationTask()],
          threads: [thread(responderThread, requestId)],
        }),
      ),
    ).toEqual([]);
  });
});

describe("peerThreadFor", () => {
  const threads = [thread(requesterThread, null), thread(responderThread, requestId)];

  it("routes a requester's message to the responder Thread", () => {
    expect(
      peerThreadFor({ task: delegationTask(), threads, callerThreadId: requesterThread }),
    ).toEqual({ peerThreadId: responderThread, callerSide: "requester" });
  });

  it("routes a responder's reply back to the requester Thread", () => {
    expect(
      peerThreadFor({ task: delegationTask(), threads, callerThreadId: responderThread }),
    ).toEqual({ peerThreadId: requesterThread, callerSide: "responder" });
  });

  it("refuses a Thread that is not on the channel", () => {
    expect(
      peerThreadFor({
        task: delegationTask(),
        threads,
        callerThreadId: ThreadId.makeUnsafe("thread-outsider"),
      }),
    ).toBeNull();
  });

  it("returns null while the responder Thread has not spawned yet", () => {
    expect(
      peerThreadFor({
        task: delegationTask(),
        threads: [thread(requesterThread, null)],
        callerThreadId: requesterThread,
      }),
    ).toBeNull();
  });
});

describe("channel prompts", () => {
  it("tells the responder how to reply and on which channel", () => {
    const prompt = buildDelegationRequestPrompt({
      task: delegationTask(),
      requesterWorkerTitle: "BonsAI",
    });
    expect(prompt).toContain("BonsAI");
    expect(prompt).toContain("Share the design system");
    expect(prompt).toContain("Send tokens and component states.");
    expect(prompt).toContain(`inbox_reply tool (request_id: ${requestId})`);
  });

  it("tells the requester to resume, and whether the channel is still open", () => {
    const open = buildDelegationReplyPrompt({
      task: delegationTask(),
      fromWorkerTitle: "BonsAI",
      body: "Here are the tokens.",
      closed: false,
    });
    expect(open).toContain("replied on your request");
    expect(open).toContain("Continue the work this answer was blocking.");
    expect(open).toContain(`inbox_reply with request_id: ${requestId}`);

    const closed = buildDelegationReplyPrompt({
      task: delegationTask(),
      fromWorkerTitle: "BonsAI",
      body: "Here are the tokens.",
      closed: true,
    });
    expect(closed).toContain("closed the channel");
    expect(closed).toContain("The channel is closed");
  });
});
