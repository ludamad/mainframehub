/**
 * GitService — async spawn-based wrapper around the git CLI.
 *
 * Every method delegates to `run` / `runSafe` from `../lib/run`.
 * The `parseRepo` helper lives in `../interfaces` and is re-exported here
 * for convenience.
 */

import { run, runSafe } from '../lib/run';
import { parseRepo } from '../interfaces';
import type { GitInfo, RunOptions } from '../interfaces';
import { GitError } from '../errors';

export class GitService {
  /**
   * Clone a repository into `target`.
   */
  async clone(
    url: string,
    target: string,
    opts?: { branch?: string; depth?: number },
  ): Promise<void> {
    const args: string[] = ['clone'];

    if (opts?.depth) {
      args.push('--depth', String(opts.depth));
    }
    if (opts?.branch) {
      args.push('--branch', opts.branch);
    }

    args.push(url, target);
    await run('git', args);
  }

  /**
   * Create a local branch (does not check it out).
   */
  async createBranch(repoPath: string, name: string): Promise<void> {
    await run('git', ['branch', name], { cwd: repoPath });
  }

  /**
   * Checkout an existing branch.
   */
  async checkout(repoPath: string, branch: string): Promise<void> {
    await run('git', ['checkout', branch], { cwd: repoPath });
  }

  /**
   * Create a commit.
   */
  async commit(
    repoPath: string,
    message: string,
    opts?: { allowEmpty?: boolean },
  ): Promise<void> {
    const args = ['commit', '-m', message];
    if (opts?.allowEmpty) {
      args.push('--allow-empty');
    }
    await run('git', args, { cwd: repoPath });
  }

  /**
   * Push the current branch.
   */
  async push(
    repoPath: string,
    opts?: { setUpstream?: boolean; force?: boolean; branch?: string },
  ): Promise<void> {
    const args = ['push'];
    if (opts?.force) {
      args.push('--force-with-lease');
    }
    if (opts?.setUpstream && opts?.branch) {
      args.push('--set-upstream', 'origin', opts.branch);
    }
    await run('git', args, { cwd: repoPath });
  }

  /**
   * Fetch from remote.
   */
  async fetch(repoPath: string): Promise<void> {
    await run('git', ['fetch'], { cwd: repoPath });
  }

  /**
   * Fetch all remotes and prune deleted tracking branches.
   */
  async fetchAll(repoPath: string): Promise<void> {
    await run('git', ['fetch', '--all', '--prune'], { cwd: repoPath });
  }

  /**
   * List remote branches.  Returns branch names with the `origin/` prefix
   * stripped and `HEAD` excluded.
   */
  async listBranches(repoPath: string): Promise<string[]> {
    const output = await run('git', ['branch', '-r'], { cwd: repoPath });

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('origin/') && !line.includes('->'))
      .map((line) => line.replace(/^origin\//, ''));
  }

  /**
   * Aggregate remote URL, current branch, and working-tree status into a
   * single `GitInfo` object.
   */
  async getInfo(repoPath: string): Promise<GitInfo> {
    const remote = await this.getRemote(repoPath);
    const repo = parseRepo(remote);
    const branch = await this.getBranch(repoPath);
    const status = await this.getStatus(repoPath);

    return { remote, repo, branch, ...status };
  }

  /**
   * Get dirty state and ahead/behind counts relative to upstream.
   * Uses `runSafe` for the rev-list call because the branch may have no
   * upstream configured yet.
   */
  async getStatus(
    repoPath: string,
  ): Promise<{ isDirty: boolean; ahead: number; behind: number }> {
    const porcelain = await run('git', ['status', '--porcelain'], {
      cwd: repoPath,
    });
    const isDirty = porcelain.length > 0;

    let ahead = 0;
    let behind = 0;

    const revResult = await runSafe(
      'git',
      ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
      { cwd: repoPath },
    );

    if (revResult.exitCode === 0 && revResult.stdout) {
      const [behindStr, aheadStr] = revResult.stdout.split('\t');
      behind = parseInt(behindStr, 10) || 0;
      ahead = parseInt(aheadStr, 10) || 0;
    }

    return { isDirty, ahead, behind };
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private async getRemote(repoPath: string): Promise<string> {
    return run('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
  }

  private async getBranch(repoPath: string): Promise<string> {
    const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoPath,
    });

    if (branch === 'HEAD') {
      throw new GitError('HEAD is in detached state');
    }

    return branch;
  }
}
