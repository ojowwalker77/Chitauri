import type { GitHubRepositorySummary } from "@t3tools/contracts";

export interface GitHubRepositoryRef {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

export function parseGitHubRepositoryRemote(remoteUrl: string | null): GitHubRepositoryRef | null {
  const value = remoteUrl?.trim();
  if (!value) return null;

  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):([^/\s]+)\/(.+?)(?:\.git)?\/?$/.exec(value);
  const url = /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([^/\s]+)\/([^/\s]+)\/(.+?)(?:\.git)?\/?$/.exec(
    value,
  );
  const match = url ?? scp;
  if (!match) return null;
  const host = match[1]?.trim();
  const owner = match[2]?.trim();
  const repo = match[3]?.replace(/\.git$/i, "").replace(/\/$/, "").trim();
  return host && owner && repo ? { host, owner, repo } : null;
}

export function parseGitHubRepositoryName(nameWithOwner: string): GitHubRepositoryRef | null {
  const [owner, repo, ...rest] = nameWithOwner.trim().split("/");
  return owner && repo && rest.length === 0 ? { host: "github.com", owner, repo } : null;
}

export function repositorySummary(repository: GitHubRepositoryRef): GitHubRepositorySummary {
  const nameWithOwner = `${repository.owner}/${repository.repo}`;
  return {
    nameWithOwner,
    name: repository.repo,
    url: `https://${repository.host}/${nameWithOwner}`,
  };
}
