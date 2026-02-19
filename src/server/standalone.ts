/**
 * Standalone server entry point for browser-only access.
 *
 * Takes a local repo path as argument, detects git remote + derives config,
 * writes .vscode/settings.json so VS Code shares the same config,
 * gets GitHub token from `gh auth token`, and starts the HTTP server.
 *
 * Usage: node dist/server.js /path/to/repo
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { rm, mkdir, writeFile } from 'fs/promises';

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
// Config — detect from repo path, read/write .vscode/settings.json
// ---------------------------------------------------------------------------

function readSettingsFile(): Record<string, unknown> {
  const settingsPath = path.join(process.cwd(), '.vscode', 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  const raw = fs.readFileSync(settingsPath, 'utf-8');
  const settings = JSON.parse(raw);

  const mfh: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith('mfh.')) {
      mfh[key.slice(4)] = value;
    }
  }
  return mfh;
}

function getRemoteUrl(repoPath: string): string {
  try {
    return execSync('git remote get-url origin', {
      cwd: repoPath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}

function buildConfig(repoPath: string): ExtensionConfig {
  const existing = readSettingsFile();

  const repo = (existing.repo as string) || getRemoteUrl(repoPath);

  let repoName = (existing.repoName as string) || '';
  if (!repoName && repo) {
    try {
      repoName = parseRepo(repo);
    } catch {
      repoName = '';
    }
  }

  const home = process.env.HOME ?? '/home/user';
  const repoShort = repoName.split('/')[1] ?? 'repo';
  const clonesDir = (existing.clonesDir as string) || path.join(home, 'mfh-clones', repoShort);
  const referenceGitPath = (existing.referenceGitPath as string) || repoPath;

  return {
    repo,
    repoName,
    referenceGitPath,
    clonesDir,
    baseBranch: (existing.baseBranch as string) ?? 'main',
    sessionPrefix: (existing.sessionPrefix as string) ?? 'pr-',
    baseBranchPresets: (existing.baseBranchPresets as string[]) ?? ['main'],
    dangerouslySkipPermissions: (existing.dangerouslySkipPermissions as boolean) ?? false,
    quickFixMode: (existing.quickFixMode as boolean) ?? false,
    guidelines: {
      branchFormat: (existing['guidelines.branchFormat'] as string) ?? undefined,
      commitFormat: (existing['guidelines.commitFormat'] as string) ?? undefined,
    },
    workerModel: (existing.workerModel as string) ?? '',
    autoRefreshInterval: (existing.autoRefreshInterval as number) ?? 30_000,
    prCacheTTL: (existing.prCacheTTL as number) ?? 3_600_000,
  };
}

async function writeSettings(config: ExtensionConfig): Promise<void> {
  const settingsPath = path.join(process.cwd(), '.vscode', 'settings.json');

  // Read existing settings to preserve non-mfh keys
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  }

  // Write mfh settings
  settings['mfh.repo'] = config.repo;
  settings['mfh.clonesDir'] = config.clonesDir;
  settings['mfh.referenceGitPath'] = config.referenceGitPath;
  settings['mfh.baseBranch'] = config.baseBranch;
  settings['mfh.baseBranchPresets'] = config.baseBranchPresets;

  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  logger.appendLine(`[standalone] Wrote settings to ${settingsPath}`);
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
  const repoPath = process.argv[2];

  if (!repoPath) {
    console.error('Usage: npm run web -- /path/to/repo');
    console.error('');
    console.error('Pass the path to a local git checkout of your GitHub repo.');
    console.error('Config is auto-detected and written to .vscode/settings.json');
    console.error('so VS Code picks it up too.');
    process.exit(1);
  }

  const resolved = path.resolve(repoPath);

  if (!fs.existsSync(resolved)) {
    console.error(`Path does not exist: ${resolved}`);
    process.exit(1);
  }

  const config = buildConfig(resolved);

  if (!config.repo) {
    console.error(`Could not detect a GitHub remote in: ${resolved}`);
    console.error('Make sure the repo has an "origin" remote pointing to GitHub.');
    process.exit(1);
  }

  // Ensure clones dir exists
  await mkdir(config.clonesDir, { recursive: true }).catch(() => {});

  // Write settings so VS Code shares the same config
  await writeSettings(config);

  logger.appendLine(`[standalone] repo=${config.repoName}`);
  logger.appendLine(`[standalone] clonesDir=${config.clonesDir}`);
  logger.appendLine(`[standalone] referenceGitPath=${config.referenceGitPath}`);

  const token = getGitHubToken();
  logger.appendLine('[standalone] GitHub token obtained from gh CLI');

  // Create services
  const tmux = new TmuxService();
  const git = new GitService();
  const github = new GitHubService(token);
  const claude = new ClaudeService();
  const handover = new ClaudeHandoverService(tmux, config.workerModel);

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
    handover,
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

  const port = parseInt(process.env.PORT ?? '3002', 10);

  createHttpServer(container, {
    port,
    extensionPath: path.resolve(__dirname, '..'),
  }, logger);

  // Write MCP config for Claude Code discovery
  const mcpPath = path.join(process.cwd(), '.vscode', 'mcp.json');
  const mcpConfig = {
    servers: {
      mainframehub: {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
      },
    },
  };
  await mkdir(path.dirname(mcpPath), { recursive: true });
  await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  logger.appendLine(`[standalone] Wrote MCP config to ${mcpPath}`);

  logger.appendLine(`[standalone] Server starting on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
