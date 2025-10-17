/**
 * Real git service - no mocking, just wraps git CLI
 */

import { execSync } from 'child_process';

export interface GitInfo {
  remote: string;  // Full git URL
  repo: string;    // 'owner/repo' parsed from remote
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
}

export class GitService {
  getRemote(repoPath: string): string {
    try {
      return execSync('git remote get-url origin', {
        cwd: repoPath,
        encoding: 'utf-8',
      }).trim();
    } catch (error: any) {
      throw new Error(`Failed to get remote: ${error.message}`);
    }
  }

  getBranch(repoPath: string): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8',
      }).trim();
    } catch (error: any) {
      throw new Error(`Failed to get branch: ${error.message}`);
    }
  }

  getStatus(repoPath: string): { isDirty: boolean; ahead: number; behind: number } {
    try {
      // Check dirty state
      const porcelain = execSync('git status --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8',
      });
      const isDirty = porcelain.trim().length > 0;

      // Check ahead/behind
      let ahead = 0;
      let behind = 0;
      try {
        const revList = execSync('git rev-list --left-right --count @{u}...HEAD', {
          cwd: repoPath,
          encoding: 'utf-8',
        }).trim();
        const [behindStr, aheadStr] = revList.split('\t');
        behind = parseInt(behindStr, 10) || 0;
        ahead = parseInt(aheadStr, 10) || 0;
      } catch {
        // No upstream or other error - assume 0/0
      }

      return { isDirty, ahead, behind };
    } catch (error: any) {
      throw new Error(`Failed to get status: ${error.message}`);
    }
  }

  getInfo(repoPath: string): GitInfo {
    const remote = this.getRemote(repoPath);
    const repo = parseRepo(remote);
    const branch = this.getBranch(repoPath);
    const status = this.getStatus(repoPath);

    return {
      remote,
      repo,
      branch,
      ...status,
    };
  }

  clone(url: string, targetPath: string, options?: {
    branch?: string;
    depth?: number;
  }): void {
    let cmd = `git clone`;
    if (options?.depth) {
      cmd += ` --depth ${options.depth}`;
    }
    if (options?.branch) {
      cmd += ` --branch ${options.branch}`;
    }
    cmd += ` "${url}" "${targetPath}"`;

    try {
      execSync(cmd, { stdio: 'pipe' });
    } catch (error: any) {
      throw new Error(`Failed to clone: ${error.message}`);
    }
  }

  createBranch(repoPath: string, branchName: string): void {
    try {
      execSync(`git branch "${branchName}"`, { cwd: repoPath });
    } catch (error: any) {
      throw new Error(`Failed to create branch: ${error.message}`);
    }
  }

  checkout(repoPath: string, branch: string): void {
    try {
      execSync(`git checkout "${branch}"`, { cwd: repoPath, stdio: 'pipe' });
    } catch (error: any) {
      throw new Error(`Failed to checkout: ${error.message}`);
    }
  }

  commit(repoPath: string, message: string, options?: { allowEmpty?: boolean }): void {
    let cmd = `git commit -m "${message}"`;
    if (options?.allowEmpty) {
      cmd += ' --allow-empty';
    }

    try {
      execSync(cmd, { cwd: repoPath, stdio: 'pipe' });
    } catch (error: any) {
      throw new Error(`Failed to commit: ${error.message}`);
    }
  }

  push(repoPath: string, options?: {
    setUpstream?: boolean;
    force?: boolean;
    branch?: string;
  }): void {
    let cmd = 'git push';
    if (options?.force) {
      cmd += ' --force-with-lease';
    }
    if (options?.setUpstream && options?.branch) {
      cmd += ` --set-upstream origin ${options.branch}`;
    }

    try {
      execSync(cmd, { cwd: repoPath, stdio: 'pipe' });
    } catch (error: any) {
      throw new Error(`Failed to push: ${error.message}`);
    }
  }

  fetch(repoPath: string): void {
    try {
      execSync('git fetch', { cwd: repoPath, stdio: 'pipe' });
    } catch (error: any) {
      throw new Error(`Failed to fetch: ${error.message}`);
    }
  }
}

/**
 * Parse owner/repo from git remote URL
 */
export function parseRepo(remote: string): string {
  // Handle various formats:
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  // https://github.com/owner/repo
  const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  if (!match) {
    throw new Error(`Invalid GitHub remote: ${remote}`);
  }
  return match[1].replace(/\.git$/, '');
}
