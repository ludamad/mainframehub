/**
 * Read extension settings from VS Code workspace configuration.
 *
 * All settings live under the "mfh" namespace.  `repoName` is auto-derived
 * from `repo` when not explicitly provided.
 */

import * as vscode from 'vscode';
import { type ExtensionConfig, parseRepo } from './interfaces';

export function readConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('mfh');

  const repo = cfg.get<string>('repo', '');
  const explicitRepoName = cfg.get<string>('repoName', '');

  let repoName = explicitRepoName;
  if (!repoName && repo) {
    try {
      repoName = parseRepo(repo);
    } catch {
      // repo URL is not a valid GitHub remote — leave repoName empty
      repoName = '';
    }
  }

  return {
    repo,
    repoName,
    referenceGitPath: cfg.get<string>('referenceGitPath', ''),
    clonesDir: cfg.get<string>('clonesDir', ''),
    baseBranch: cfg.get<string>('baseBranch', 'main'),
    sessionPrefix: cfg.get<string>('sessionPrefix', 'pr-'),
    baseBranchPresets: cfg.get<string[]>('baseBranchPresets', ['main']),
    dangerouslySkipPermissions: cfg.get<boolean>('dangerouslySkipPermissions', false),
    quickFixMode: cfg.get<boolean>('quickFixMode', false),
    guidelines: {
      branchFormat: cfg.get<string>('guidelines.branchFormat'),
      commitFormat: cfg.get<string>('guidelines.commitFormat'),
    },
    autoRefreshInterval: cfg.get<number>('autoRefreshInterval', 30_000),
    prCacheTTL: cfg.get<number>('prCacheTTL', 3_600_000),
  };
}
