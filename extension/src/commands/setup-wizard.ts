/**
 * Setup wizard — asks only for the repo URL and auto-derives everything
 * else: clonesDir, referenceGitPath, baseBranch, baseBranchPresets.
 *
 * Branch detection uses the GitHub API (Octokit) so it works without
 * a local clone.  The only local git call is to detect the workspace's
 * remote URL for pre-filling the input.
 */

import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import { parseRepo } from '../interfaces';

export async function runSetupWizard(): Promise<boolean> {
  // Try to pre-fill from current workspace git remote
  const prefill = await detectRepoFromWorkspace();

  const repo = await vscode.window.showInputBox({
    title: 'MainframeHub Setup',
    prompt: 'Enter the GitHub repository URL',
    value: prefill,
    placeHolder: 'https://github.com/owner/repo.git',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Repository URL is required';
      }
      if (!value.match(/github\.com[:/][^/]+\/[^/.]+/)) {
        return 'Must be a valid GitHub URL (HTTPS or SSH)';
      }
      return undefined;
    },
  });

  if (!repo) {
    return false;
  }

  // Auto-derive everything
  const repoName = parseRepo(repo);
  const [owner, repoShort] = repoName.split('/');
  const home = process.env.HOME ?? '/home/user';
  const clonesDir = `${home}/mfh-clones/${repoShort}`;
  const referenceGitPath = await findReferenceGitPath(repo);

  // Get a GitHub token for API calls
  const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
  const octokit = new Octokit({ auth: session.accessToken });

  const presets = await detectBaseBranchPresets(octokit, owner, repoShort);
  const baseBranch = presets[0];

  // Ensure clones dir exists
  const { mkdir } = await import('fs/promises');
  await mkdir(clonesDir, { recursive: true }).catch(() => {});

  // Save all settings
  const config = vscode.workspace.getConfiguration('mfh');
  await config.update('repo', repo, vscode.ConfigurationTarget.Workspace);
  await config.update('clonesDir', clonesDir, vscode.ConfigurationTarget.Workspace);
  await config.update('baseBranch', baseBranch, vscode.ConfigurationTarget.Workspace);
  await config.update('baseBranchPresets', presets, vscode.ConfigurationTarget.Workspace);

  if (referenceGitPath) {
    await config.update('referenceGitPath', referenceGitPath, vscode.ConfigurationTarget.Workspace);
  }

  return true;
}

/**
 * Detect base branch presets: the repo's default branch + any merge-train/* branches.
 * Uses the GitHub API — no local clone needed.
 */
async function detectBaseBranchPresets(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string[]> {
  const defaultBranch = await getDefaultBranch(octokit, owner, repo);
  const mergeTrainBranches = await getMergeTrainBranches(octokit, owner, repo);

  const presets = [defaultBranch, ...mergeTrainBranches];
  return [...new Set(presets)];
}

async function getDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string> {
  try {
    const { data } = await octokit.repos.get({ owner, repo });
    return data.default_branch;
  } catch {
    return 'main';
  }
}

async function getMergeTrainBranches(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string[]> {
  try {
    const branches: string[] = [];
    const iterator = octokit.paginate.iterator(octokit.repos.listBranches, {
      owner,
      repo,
      per_page: 100,
    });

    for await (const response of iterator) {
      for (const branch of response.data) {
        if (branch.name.startsWith('merge-train/')) {
          branches.push(branch.name);
        }
      }
    }

    return branches;
  } catch {
    return [];
  }
}

async function detectRepoFromWorkspace(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return '';
  }

  try {
    const { spawn } = await import('child_process');
    return await new Promise<string>((resolve) => {
      const proc = spawn('git', ['remote', 'get-url', 'origin'], {
        cwd: folders[0].uri.fsPath,
        timeout: 5000,
      });
      let out = '';
      proc.stdout.on('data', (d: Buffer) => (out += d));
      proc.on('close', (code) => resolve(code === 0 ? out.trim() : ''));
      proc.on('error', () => resolve(''));
    });
  } catch {
    return '';
  }
}

async function findReferenceGitPath(repoUrl: string): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  const wsRemote = await detectRepoFromWorkspace();
  if (wsRemote) {
    try {
      const wsRepo = parseRepo(wsRemote);
      const targetRepo = parseRepo(repoUrl);
      if (wsRepo === targetRepo) {
        return folders[0].uri.fsPath;
      }
    } catch {
      // Parse failed — not the same repo
    }
  }

  return undefined;
}
