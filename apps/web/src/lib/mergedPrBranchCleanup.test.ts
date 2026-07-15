import { describe, expect, it, vi } from "vitest";
import type { NativeApi } from "@t3tools/contracts";

import { deleteMergedLocalBranch } from "./mergedPrBranchCleanup";

type GitApi = Pick<NativeApi["git"], "checkout" | "deleteBranch" | "listBranches" | "status">;

function makeGitApi(overrides: Partial<GitApi> = {}): GitApi {
  return {
    listBranches: vi.fn(async () => ({
      isRepo: true,
      hasOriginRemote: true,
      branches: [
        {
          name: "feature/merged",
          current: true,
          isDefault: false,
          isRemote: false,
          worktreePath: "/repo",
        },
        {
          name: "main",
          current: false,
          isDefault: true,
          isRemote: false,
          worktreePath: null,
        },
      ],
    })),
    status: vi.fn(async () => ({
      branch: "feature/merged",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      upstreamBranch: "origin/feature/merged",
      aheadCount: 0,
      behindCount: 0,
      pr: {
        number: 42,
        title: "Merged work",
        url: "https://github.com/acme/repo/pull/42",
        baseBranch: "main",
        headBranch: "feature/merged",
        state: "merged",
        isDraft: false,
        mergeability: "unknown",
        additions: 1,
        deletions: 0,
        changedFiles: 1,
      },
    })),
    checkout: vi.fn(async () => undefined),
    deleteBranch: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("deleteMergedLocalBranch", () => {
  it("switches a clean current checkout to the default branch before deleting", async () => {
    const git = makeGitApi();

    await expect(
      deleteMergedLocalBranch(git, {
        cwd: "/repo",
        localBranch: "feature/merged",
        mergedHeadBranch: "feature/merged",
        mergedPullRequestUrl: "https://github.com/acme/repo/pull/42",
      }),
    ).resolves.toBe("deleted");

    expect(git.checkout).toHaveBeenCalledWith({ cwd: "/repo", branch: "main" });
    expect(git.deleteBranch).toHaveBeenCalledWith({
      cwd: "/repo",
      branch: "feature/merged",
      force: true,
    });
  });

  it("leaves a dirty current branch intact", async () => {
    const git = makeGitApi({
      status: vi.fn(async () => ({
        branch: "feature/merged",
        hasWorkingTreeChanges: true,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: true,
        upstreamBranch: "origin/feature/merged",
        aheadCount: 0,
        behindCount: 0,
        pr: {
          number: 42,
          title: "Merged work",
          url: "https://github.com/acme/repo/pull/42",
          baseBranch: "main",
          headBranch: "feature/merged",
          state: "merged",
          isDraft: false,
          mergeability: "unknown",
          additions: 1,
          deletions: 0,
          changedFiles: 1,
        },
      })),
    });

    await expect(
      deleteMergedLocalBranch(git, {
        cwd: "/repo",
        localBranch: "feature/merged",
        mergedHeadBranch: "feature/merged",
        mergedPullRequestUrl: "https://github.com/acme/repo/pull/42",
      }),
    ).rejects.toThrow("uncommitted changes");
    expect(git.checkout).not.toHaveBeenCalled();
    expect(git.deleteBranch).not.toHaveBeenCalled();
  });

  it("does not delete a branch that does not match the merged PR head", async () => {
    const git = makeGitApi();

    await expect(
      deleteMergedLocalBranch(git, {
        cwd: "/repo",
        localBranch: "feature/other",
        mergedHeadBranch: "feature/merged",
        mergedPullRequestUrl: "https://github.com/acme/repo/pull/42",
      }),
    ).rejects.toThrow("does not match merged PR branch");
    expect(git.listBranches).not.toHaveBeenCalled();
  });

  it("rechecks the live PR state before changing the checkout", async () => {
    const git = makeGitApi({
      status: vi.fn(async () => ({
        branch: "feature/merged",
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: true,
        upstreamBranch: "origin/feature/merged",
        aheadCount: 1,
        behindCount: 0,
        pr: {
          number: 43,
          title: "New work",
          url: "https://github.com/acme/repo/pull/43",
          baseBranch: "main",
          headBranch: "feature/merged",
          state: "open",
          isDraft: false,
          mergeability: "mergeable",
          additions: 1,
          deletions: 0,
          changedFiles: 1,
        },
      })),
    });

    await expect(
      deleteMergedLocalBranch(git, {
        cwd: "/repo",
        localBranch: "feature/merged",
        mergedHeadBranch: "feature/merged",
        mergedPullRequestUrl: "https://github.com/acme/repo/pull/42",
      }),
    ).rejects.toThrow("no longer reports");
    expect(git.checkout).not.toHaveBeenCalled();
    expect(git.deleteBranch).not.toHaveBeenCalled();
  });

  it("does not delete a historical branch that is no longer checked out", async () => {
    const git = makeGitApi({
      listBranches: vi.fn(async () => ({
        isRepo: true,
        hasOriginRemote: true,
        branches: [
          {
            name: "feature/merged",
            current: false,
            isDefault: false,
            isRemote: false,
            worktreePath: null,
          },
          {
            name: "main",
            current: true,
            isDefault: true,
            isRemote: false,
            worktreePath: "/repo",
          },
        ],
      })),
    });

    await expect(
      deleteMergedLocalBranch(git, {
        cwd: "/repo",
        localBranch: "feature/merged",
        mergedHeadBranch: "feature/merged",
        mergedPullRequestUrl: "https://github.com/acme/repo/pull/42",
      }),
    ).rejects.toThrow("not the current local checkout");
    expect(git.status).not.toHaveBeenCalled();
    expect(git.deleteBranch).not.toHaveBeenCalled();
  });

  it("treats an absent local branch as already cleaned up", async () => {
    const git = makeGitApi({
      listBranches: vi.fn(async () => ({
        isRepo: true,
        hasOriginRemote: true,
        branches: [],
      })),
    });

    await expect(
      deleteMergedLocalBranch(git, {
        cwd: "/repo",
        localBranch: "feature/merged",
        mergedHeadBranch: "feature/merged",
        mergedPullRequestUrl: "https://github.com/acme/repo/pull/42",
      }),
    ).resolves.toBe("already-deleted");
    expect(git.deleteBranch).not.toHaveBeenCalled();
  });
});
