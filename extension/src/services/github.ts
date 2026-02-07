/**
 * GitHubService — Octokit-based GitHub API client.
 *
 * All reads (list, get, find) and writes (create, update, close, merge)
 * go through Octokit.  The `gh` CLI is no longer used.
 *
 * Octokit's pulls.list endpoint does not support an `author` filter, so
 * author filtering is applied client-side after fetching.
 */

import { Octokit } from '@octokit/rest';
import type { PullRequest } from '../interfaces';
import { GitHubError } from '../errors';

interface OctokitPR {
  number: number;
  title: string;
  head: { ref: string };
  base: { ref: string };
  state: string;
  merged_at: string | null;
  html_url: string;
  user: { login: string } | null;
  draft?: boolean;
  created_at: string;
  updated_at: string;
}

function mapOctokitPR(raw: OctokitPR, repo: string): PullRequest {
  let state: PullRequest['state'];
  if (raw.merged_at) {
    state = 'MERGED';
  } else if (raw.state === 'closed') {
    state = 'CLOSED';
  } else {
    state = 'OPEN';
  }

  return {
    number: raw.number,
    title: raw.title,
    branch: raw.head.ref,
    baseBranch: raw.base.ref,
    repo,
    state,
    url: raw.html_url,
    author: raw.user?.login ?? 'unknown',
    isDraft: raw.draft ?? false,
    created: new Date(raw.created_at),
    updated: new Date(raw.updated_at),
  };
}

function parseOwnerRepo(repoName: string): { owner: string; repo: string } {
  const parts = repoName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GitHubError(`Invalid repo format: "${repoName}". Expected "owner/repo".`);
  }
  return { owner: parts[0], repo: parts[1] };
}

export class GitHubService {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Replace the token and recreate the Octokit client.
   */
  updateToken(token: string): void {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * List pull requests.
   *
   * Octokit does not support filtering by author, so when
   * `opts.author` is provided the full result set is fetched and filtered
   * client-side.
   */
  async listPRs(
    repo: string,
    opts?: { author?: string; state?: 'open' | 'closed' | 'all' },
  ): Promise<PullRequest[]> {
    const { owner, repo: repoName } = parseOwnerRepo(repo);

    const prs: PullRequest[] = [];
    const state = opts?.state ?? 'open';

    const iterator = this.octokit.paginate.iterator(
      this.octokit.pulls.list,
      {
        owner,
        repo: repoName,
        state,
        per_page: 100,
      },
    );

    for await (const response of iterator) {
      for (const raw of response.data) {
        const pr = mapOctokitPR(raw as unknown as OctokitPR, repo);

        if (opts?.author && pr.author !== opts.author) {
          continue;
        }

        prs.push(pr);
      }
    }

    return prs;
  }

  /**
   * Get a single PR by number.  Returns `null` when the PR does not exist.
   */
  async getPR(repo: string, number: number): Promise<PullRequest | null> {
    const { owner, repo: repoName } = parseOwnerRepo(repo);

    try {
      const { data } = await this.octokit.pulls.get({
        owner,
        repo: repoName,
        pull_number: number,
      });

      return mapOctokitPR(data as unknown as OctokitPR, repo);
    } catch (err: unknown) {
      if (isOctokitNotFound(err)) {
        return null;
      }
      throw new GitHubError(`Failed to get PR #${number}: ${String(err)}`);
    }
  }

  /**
   * Find an open PR by head branch name.  Returns `null` when none matches.
   */
  async findPR(params: {
    repo: string;
    branch: string;
  }): Promise<PullRequest | null> {
    const { owner, repo: repoName } = parseOwnerRepo(params.repo);

    const { data } = await this.octokit.pulls.list({
      owner,
      repo: repoName,
      state: 'open',
      head: `${owner}:${params.branch}`,
      per_page: 1,
    });

    if (data.length === 0) {
      return null;
    }

    return mapOctokitPR(data[0] as unknown as OctokitPR, params.repo);
  }

  /**
   * Create a new pull request.
   */
  async createPR(params: {
    repo: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<PullRequest> {
    const { owner, repo: repoName } = parseOwnerRepo(params.repo);

    const { data } = await this.octokit.pulls.create({
      owner,
      repo: repoName,
      head: params.branch,
      base: params.baseBranch,
      title: params.title,
      body: params.body,
      draft: params.draft ?? false,
    });

    return mapOctokitPR(data as unknown as OctokitPR, params.repo);
  }

  /**
   * Update an existing pull request's title, body, or state.
   */
  async updatePR(
    repo: string,
    number: number,
    updates: { title?: string; body?: string; state?: 'open' | 'closed' },
  ): Promise<void> {
    const { owner, repo: repoName } = parseOwnerRepo(repo);

    await this.octokit.pulls.update({
      owner,
      repo: repoName,
      pull_number: number,
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.body !== undefined && { body: updates.body }),
      ...(updates.state !== undefined && { state: updates.state }),
    });
  }

  /**
   * Close a pull request.
   */
  async closePR(repo: string, number: number): Promise<void> {
    await this.updatePR(repo, number, { state: 'closed' });
  }

  /**
   * Merge a pull request using the specified strategy.
   */
  async mergePR(
    repo: string,
    number: number,
    method: 'merge' | 'squash' | 'rebase',
  ): Promise<void> {
    const { owner, repo: repoName } = parseOwnerRepo(repo);

    await this.octokit.pulls.merge({
      owner,
      repo: repoName,
      pull_number: number,
      merge_method: method,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isOctokitNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status: number }).status === 404
  );
}
