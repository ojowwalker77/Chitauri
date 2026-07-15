// FILE: mergedPrBranchCleanup.ts
// Purpose: Safely removes a local-mode feature branch after its GitHub PR is merged.
// Layer: Web git workflow helper
// Exports: deleteMergedLocalBranch

import type { NativeApi } from "@t3tools/contracts";

type MergedBranchGitApi = Pick<
  NativeApi["git"],
  "checkout" | "deleteBranch" | "listBranches" | "status"
>;

export type MergedBranchCleanupResult = "already-deleted" | "deleted";

function findDefaultLocalBranch(
  branches: Awaited<ReturnType<MergedBranchGitApi["listBranches"]>>["branches"],
) {
  const localBranches = branches.filter((branch) => branch.isRemote !== true);
  return (
    localBranches.find((branch) => branch.isDefault) ??
    localBranches.find((branch) => branch.name === "main") ??
    localBranches.find((branch) => branch.name === "master") ??
    null
  );
}

/**
 * Delete a feature branch only after verifying it is the merged PR head. If the
 * branch is checked out, the repository must be clean and is switched to its
 * default branch first. GitHub's merged state is the authority for using a
 * forced local delete: the local default branch may not have fetched the merge
 * commit yet, so `git branch -d` would otherwise reject a branch already merged
 * remotely.
 */
export async function deleteMergedLocalBranch(
  git: MergedBranchGitApi,
  input: {
    cwd: string;
    localBranch: string;
    mergedHeadBranch: string;
    mergedPullRequestUrl: string;
  },
): Promise<MergedBranchCleanupResult> {
  if (input.localBranch !== input.mergedHeadBranch) {
    throw new Error(
      `The local branch "${input.localBranch}" does not match merged PR branch "${input.mergedHeadBranch}".`,
    );
  }

  const branchList = await git.listBranches({ cwd: input.cwd });
  const targetBranch = branchList.branches.find(
    (branch) => branch.isRemote !== true && branch.name === input.localBranch,
  );
  if (!targetBranch) {
    return "already-deleted";
  }
  if (targetBranch.isDefault) {
    throw new Error(`Refusing to delete default branch "${targetBranch.name}".`);
  }
  if (!targetBranch.current) {
    throw new Error(
      `Branch "${targetBranch.name}" is not the current local checkout and was left intact.`,
    );
  }

  const status = await git.status({ cwd: input.cwd });
  if (status.branch !== targetBranch.name) {
    throw new Error(`Branch changed while cleaning up "${targetBranch.name}". Try again later.`);
  }
  if (
    status.pr?.state !== "merged" ||
    status.pr.url !== input.mergedPullRequestUrl ||
    status.pr.headBranch !== input.mergedHeadBranch
  ) {
    throw new Error(
      `GitHub no longer reports "${targetBranch.name}" as the merged pull request branch, so it was left intact.`,
    );
  }
  if (status.hasWorkingTreeChanges) {
    throw new Error(`Branch "${targetBranch.name}" has uncommitted changes and was left intact.`);
  }

  const defaultBranch = findDefaultLocalBranch(branchList.branches);
  if (!defaultBranch) {
    throw new Error("No local default branch was found, so the merged branch was left intact.");
  }
  if (defaultBranch.worktreePath && !defaultBranch.current) {
    throw new Error(
      `Default branch "${defaultBranch.name}" is checked out in another worktree, so the merged branch was left intact.`,
    );
  }

  await git.checkout({ cwd: input.cwd, branch: defaultBranch.name });

  await git.deleteBranch({
    cwd: input.cwd,
    branch: targetBranch.name,
    force: true,
  });
  return "deleted";
}
