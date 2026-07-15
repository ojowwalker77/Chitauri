import { describe, expect, it } from "vitest";

import {
  WORKTREE_BRANCH_PREFIX,
  buildChitauriBranchName,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  resolveUniqueChitauriBranchName,
  resolveThreadBranchRegressionGuard,
} from "./git";

describe("isTemporaryWorktreeBranch", () => {
  it("matches generated temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch(buildTemporaryWorktreeBranchName())).toBe(true);
  });

  it("matches generated temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef`)).toBe(true);
    expect(isTemporaryWorktreeBranch(` ${WORKTREE_BRANCH_PREFIX}/DEADBEEF `)).toBe(true);
  });

  it("keeps recognizing legacy temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch("dpcode/deadbeef")).toBe(true);
    expect(isTemporaryWorktreeBranch("t3code/deadbeef")).toBe(true);
  });

  it("rejects semantic branch names", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/feature/demo`)).toBe(false);
    expect(isTemporaryWorktreeBranch("feature/demo")).toBe(false);
  });
});

describe("resolveThreadBranchRegressionGuard", () => {
  it("keeps a semantic branch when the next branch is only a temporary worktree placeholder", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/semantic-branch",
        nextBranch: `${WORKTREE_BRANCH_PREFIX}/deadbeef`,
      }),
    ).toBe("feature/semantic-branch");
  });

  it("accepts real branch changes", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/old",
        nextBranch: "feature/new",
      }),
    ).toBe("feature/new");
  });

  it("allows clearing the branch", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/old",
        nextBranch: null,
      }),
    ).toBeNull();
  });
});

describe("buildChitauriBranchName", () => {
  it("uses synara as the branch namespace", () => {
    expect(buildChitauriBranchName("fix toast copy")).toBe("chitauri/fix-toast-copy");
  });

  it("keeps non-Chitauri namespaces inside the Chitauri branch", () => {
    expect(buildChitauriBranchName("feature/refine-toolbar-actions")).toBe(
      "chitauri/feature/refine-toolbar-actions",
    );
  });

  it("normalizes legacy prefixes before rebuilding the branch", () => {
    expect(buildChitauriBranchName("t3code/refine toolbar actions")).toBe(
      "chitauri/refine-toolbar-actions",
    );
    expect(buildChitauriBranchName("dpcode/refine toolbar actions")).toBe(
      "chitauri/refine-toolbar-actions",
    );
  });

  it("falls back to chitauri/update when no preferred name is provided", () => {
    expect(buildChitauriBranchName()).toBe("chitauri/update");
  });
});

describe("resolveUniqueChitauriBranchName", () => {
  it("increments suffix when the Chitauri branch already exists", () => {
    expect(
      resolveUniqueChitauriBranchName(
        ["main", "chitauri/fix-toast-copy", "chitauri/fix-toast-copy-2"],
        "fix toast copy",
      ),
    ).toBe("chitauri/fix-toast-copy-3");
  });
});
