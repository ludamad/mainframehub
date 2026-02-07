/**
 * Standalone server entry point for browser-only access.
 *
 * Runs without VS Code — reads config from .vscode/settings.json,
 * gets GitHub token from `gh auth token`, creates all services,
 * and starts the HTTP server.
 *
 * Usage: node dist/server.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { rm } from 'fs/promises';

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
// Config — read from .vscode/settings.json
// ---------------------------------------------------------------------------

function readConfig(): ExtensionConfig {
  const settingsPath = path.join(process.cwd(), '.vscode', 'settings.json');

  let mfh: Record<string, unknown> = {};

  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    // Strip JSON comments (// and /* */) for VS Code settings compatibility
    const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const settings = JSON.parse(stripped);

    // Extract mfh.* keys
    for (const [key, value] of Object.entries(settings)) {
      if (key.startsWith('mfh.')) {
        const shortKey = key.slice(4); // remove "mfh."
        mfh[shortKey] = value;
      }
    }
  }

  const repo = (mfh.repo as string) ?? '';
  const explicitRepoName = (mfh.repoName as string) ?? '';
  let repoName = explicitRepoName;
  if (!repoName && repo) {
    try {
      repoName = parseRepo(repo);
    } catch {
      repoName = '';
    }
  }

  return {
    repo,
    repoName,
    referenceGitPath: (mfh.referenceGitPath as string) ?? '',
    clonesDir: (mfh.clonesDir as string) ?? '',
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

  if (!config.repo || !config.clonesDir) {
    console.error('Missing config. Ensure .vscode/settings.json has mfh.repo and mfh.clonesDir set.');
    console.error('Run the MFH Setup Wizard in VS Code first, or create .vscode/settings.json manually.');
    process.exit(1);
  }

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
