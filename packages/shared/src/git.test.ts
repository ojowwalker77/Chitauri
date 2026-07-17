import { describe, expect, it } from "vitest";

import {
  WORKTREE_BRANCH_PREFIX,
  buildTeaCodeBranchName,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  resolveUniqueTeaCodeBranchName,
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
    expect(isTemporaryWorktreeBranch("chitauri/deadbeef")).toBe(true);
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

describe("buildTeaCodeBranchName", () => {
  it("uses teacode as the branch namespace", () => {
    expect(buildTeaCodeBranchName("fix toast copy")).toBe("teacode/fix-toast-copy");
  });

  it("keeps non-TeaCode namespaces inside the TeaCode branch", () => {
    expect(buildTeaCodeBranchName("feature/refine-toolbar-actions")).toBe(
      "teacode/feature/refine-toolbar-actions",
    );
  });

  it("normalizes legacy prefixes before rebuilding the branch", () => {
    expect(buildTeaCodeBranchName("t3code/refine toolbar actions")).toBe(
      "teacode/refine-toolbar-actions",
    );
    expect(buildTeaCodeBranchName("dpcode/refine toolbar actions")).toBe(
      "teacode/refine-toolbar-actions",
    );
  });

  it("falls back to teacode/update when no preferred name is provided", () => {
    expect(buildTeaCodeBranchName()).toBe("teacode/update");
  });
});

describe("resolveUniqueTeaCodeBranchName", () => {
  it("increments suffix when the TeaCode branch already exists", () => {
    expect(
      resolveUniqueTeaCodeBranchName(
        ["main", "teacode/fix-toast-copy", "teacode/fix-toast-copy-2"],
        "fix toast copy",
      ),
    ).toBe("teacode/fix-toast-copy-3");
  });
});
