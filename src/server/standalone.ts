/**
 * Standalone server entry point for browser-only access.
 *
 * Runs without VS Code — auto-detects config from git remote and
 * .vscode/settings.json, gets GitHub token from `gh auth token`,
 * creates all services, and starts the HTTP server.
 *
 * Usage: node dist/server.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { rm, mkdir } from 'fs/promises';

import { type ExtensionConfig, parseRepo } from '../interfaces';
import { TmuxService } from '../services/tmux';
import { GitService } from '../services/git';
import { GitHubService } from '../services/github';
import { ClaudeService } from '../services/claude';
import { ClaudeHandoverService } from '../services/handover';
import { DiscoveryService } from '../services/discovery';
import { PRService } from '../services/pr-service';
import { PRStatusService } from '../services/pr-status';
import { PRCacheService } from '../services/pr-cache';
import { SessionCacheService } from '../services/session-cache';

import type { ServerContainer, ServerLogger } from './types';
import { createHttpServer } from './http-server';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger: ServerLogger = {
  appendLine(line: string) {
    console.log(line);
  },
};

// ---------------------------------------------------------------------------
// Config — auto-detect from git, override from .vscode/settings.json
// ---------------------------------------------------------------------------

function readSettingsFile(): Record<string, unknown> {
  const settingsPath = path.join(process.cwd(), '.vscode', 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  const raw = fs.readFileSync(settingsPath, 'utf-8');
  // Strip JSON comments (// and /* */) for VS Code settings compatibility
  const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const settings = JSON.parse(stripped);

  const mfh: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith('mfh.')) {
      mfh[key.slice(4)] = value;
    }
  }
  return mfh;
}

function detectRepoFromGit(): string {
  try {
    return execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function readConfig(): ExtensionConfig {
  const mfh = readSettingsFile();

  // Auto-detect repo from git remote, settings override
  const repo = (mfh.repo as string) || detectRepoFromGit();

  let repoName = (mfh.repoName as string) || '';
  if (!repoName && repo) {
    try {
      repoName = parseRepo(repo);
    } catch {
      repoName = '';
    }
  }

  // Auto-derive clonesDir like the Setup Wizard does
  const home = process.env.HOME ?? '/home/user';
  const repoShort = repoName.split('/')[1] ?? 'repo';
  const defaultClonesDir = path.join(home, 'mfh-clones', repoShort);
  const clonesDir = (mfh.clonesDir as string) || defaultClonesDir;

  // referenceGitPath defaults to cwd if it's the same repo
  let referenceGitPath = (mfh.referenceGitPath as string) || '';
  if (!referenceGitPath && repo) {
    const gitRemote = detectRepoFromGit();
    if (gitRemote) {
      try {
        if (parseRepo(gitRemote) === repoName) {
          referenceGitPath = process.cwd();
        }
      } catch { /* not the same repo */ }
    }
  }

  return {
    repo,
    repoName,
    referenceGitPath,
    clonesDir,
    baseBranch: (mfh.baseBranch as string) ?? 'main',
    sessionPrefix: (mfh.sessionPrefix as string) ?? 'pr-',
    baseBranchPresets: (mfh.baseBranchPresets as string[]) ?? ['main'],
    dangerouslySkipPermissions: (mfh.dangerouslySkipPermissions as boolean) ?? false,
    quickFixMode: (mfh.quickFixMode as boolean) ?? false,
    guidelines: {
      branchFormat: (mfh['guidelines.branchFormat'] as string) ?? undefined,
      commitFormat: (mfh['guidelines.commitFormat'] as string) ?? undefined,
    },
    autoRefreshInterval: (mfh.autoRefreshInterval as number) ?? 30_000,
    prCacheTTL: (mfh.prCacheTTL as number) ?? 3_600_000,
  };
}

// ---------------------------------------------------------------------------
// GitHub token — from gh CLI
// ---------------------------------------------------------------------------

function getGitHubToken(): string {
  try {
    return execSync('gh auth token', { encoding: 'utf-8' }).trim();
  } catch {
    console.error('Failed to get GitHub token. Run `gh auth login` first.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = readConfig();

  if (!config.repo) {
    console.error('Could not detect repository. Run from a git repo with a GitHub remote,');
    console.error('or set mfh.repo in .vscode/settings.json.');
    process.exit(1);
  }

  // Ensure clones dir exists (auto-derived or from settings)
  await mkdir(config.clonesDir, { recursive: true }).catch(() => {});

  logger.appendLine(`[standalone] repo=${config.repoName}, clonesDir=${config.clonesDir}`);

  const token = getGitHubToken();
  logger.appendLine('[standalone] GitHub token obtained from gh CLI');

  // Create services
  const tmux = new TmuxService();
  const git = new GitService();
  const github = new GitHubService(token);
  const claude = new ClaudeService();
  const handover = new ClaudeHandoverService(tmux);

  const discovery = new DiscoveryService(
    tmux, git, github, config.sessionPrefix, logger,
  );

  const prCache = new PRCacheService(
    github, config.repoName, config.prCacheTTL / 60_000, logger,
  );

  const sessionCache = new SessionCacheService(
    discovery, config.autoRefreshInterval / 1_000, logger,
  );

  const prService = new PRService(
    tmux, git, github, claude, handover, config,
  );

  const prStatus = new PRStatusService(
    tmux, github, prCache, config.clonesDir,
    config.repoName, config.sessionPrefix, logger,
  );

  // Get current user from gh CLI
  let currentUser = 'unknown';
  try {
    const userJson = execSync('gh api user --jq .login', { encoding: 'utf-8' }).trim();
    currentUser = userJson;
    logger.appendLine(`[standalone] GitHub user: ${currentUser}`);
  } catch {
    logger.appendLine('[standalone] Could not determine GitHub user, using "unknown"');
  }

  // Build container
  const container: ServerContainer = {
    config,
    tmux,
    github,
    prService,
    fs: {
      rmdir: async (p: string, opts?: { recursive?: boolean }) => {
        await rm(p, { recursive: opts?.recursive ?? false, force: true });
      },
    },
    getGroupedPRs: () => prStatus.getGroupedPRs(currentUser),
    getSessionStates: () => sessionCache.get(),
    invalidateCaches: () => {
      void prCache.invalidate(currentUser);
      void sessionCache.invalidate();
    },
  };

  const port = parseInt(process.env.PORT ?? '3000', 10);

  createHttpServer(container, {
    port,
    extensionPath: path.resolve(__dirname, '..'),
  }, logger);

  logger.appendLine(`[standalone] Server starting on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
