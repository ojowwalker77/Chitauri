import { ProjectId, TaskId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  createTaskMentionReference,
  createWorkerMentionReference,
  isTeaCodeMentionReference,
  parseTeaCodeMentionReference,
} from "./workerMentions";

describe("workerMentions", () => {
  it("round-trips stable Task and Worker ids while keeping human names", () => {
    const taskMention = createTaskMentionReference({
      id: TaskId.makeUnsafe("task/urgent fixes"),
      title: "Urgent fixes",
    });
    const workerMention = createWorkerMentionReference({
      id: ProjectId.makeUnsafe("worker/TeaCode"),
      title: "TeaCode",
    });

    expect(taskMention.name).toBe("Urgent fixes");
    expect(parseTeaCodeMentionReference(taskMention)).toEqual({
      kind: "task",
      id: "task/urgent fixes",
    });
    expect(workerMention.name).toBe("TeaCode");
    expect(parseTeaCodeMentionReference(workerMention)).toEqual({
      kind: "worker",
      id: "worker/TeaCode",
    });
    expect(isTeaCodeMentionReference(taskMention)).toBe(true);
    expect(isTeaCodeMentionReference({ name: "README", path: "/repo/README.md" })).toBe(false);
  });

  it("rejects malformed internal references", () => {
    expect(
      parseTeaCodeMentionReference({ name: "Broken", path: "teacode://task/%E0%A4%A" }),
    ).toBeNull();
    expect(parseTeaCodeMentionReference({ name: "Missing", path: "teacode://worker/" })).toBeNull();
  });
});
