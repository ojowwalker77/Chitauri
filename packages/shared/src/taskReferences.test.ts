import { describe, expect, it } from "vitest";

import { formatTaskReference } from "./taskReferences";

describe("formatTaskReference", () => {
  it("keeps agent task hashes compact and stable", () => {
    expect(formatTaskReference("agent-task:4a0fc913")).toBe("TASK-4A0FC913");
  });

  it("compacts UUID task ids for ordinary manual Tasks", () => {
    expect(formatTaskReference("12345678-abcd-4abc-9abc-1234567890ab")).toBe("TASK-12345678");
  });
});
