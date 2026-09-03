import { Octokit } from "@octokit/rest";
import type { GitHubRepositoryRef } from "./repository-config.ts";

const defaultBranchCache = new Map<string, Promise<string>>();

export function createGitHubClient(token = process.env.GITHUB_TOKEN) {
  if (!token) throw new Error("GITHUB_TOKEN is not configured.");
  return new Octokit({ auth: token });
}

export function getDefaultBranch(
  client: Octokit,
  ref: GitHubRepositoryRef,
): Promise<string> {
  const key = `${ref.owner}/${ref.repo}`;
  let pending = defaultBranchCache.get(key);
  if (!pending) {
    pending = client.rest.repos
      .get({ owner: ref.owner, repo: ref.repo })
      .then(({ data }) => data.default_branch)
      .catch((error: unknown) => {
        defaultBranchCache.delete(key);
        throw error;
      });
    defaultBranchCache.set(key, pending);
  }
  return pending;
}
