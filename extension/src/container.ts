/**
 * Service container and prerequisite checking for the MainframeHub extension.
 *
 * `checkPrerequisites` verifies that tmux, git, and claude are available on
 * the PATH and that a GitHub authentication session can be obtained.  It
 * returns the resolved tmux binary path so the terminal manager can use an
 * absolute path for `createTerminal`.
 *
 * `ServiceContainer` wires every service in dependency order via the async
 * `create` factory method.  It listens for GitHub token changes and updates
 * the `GitHubService` automatically.
 */

import * as vscode from 'vscode';
import { readConfig } from './config';
import { runSafe } from './lib/run';
import type { ExtensionConfig } from './interfaces';

import { TmuxService } from './services/tmux';
import { GitService } from './services/git';
import { GitHubService } from './services/github';
import { ClaudeService } from './services/claude';
import { ClaudeHandoverService } from './services/handover';
import { DiscoveryService } from './services/discovery';
import { PRService } from './services/pr-service';
import { PRStatusService } from './services/pr-status';
import { PRCacheService } from './services/pr-cache';
import { SessionCacheService } from './services/session-cache';

// ============================================================================
// Prerequisite checking
// ============================================================================

export interface PrerequisiteError {
  tool: string;
  message: string;
}

export interface PrerequisiteResult {
  errors: PrerequisiteError[];
  tmuxPath: string;
}

export async function checkPrerequisites(
  logger: vscode.OutputChannel,
): Promise<PrerequisiteResult> {
  const errors: PrerequisiteError[] = [];
  let tmuxPath = 'tmux';

  // Check tmux
  const tmuxResult = await runSafe('which', ['tmux']);
  if (tmuxResult.exitCode !== 0) {
    errors.push({
      tool: 'tmux',
      message: 'tmux is not installed or not on PATH. Install it with your package manager.',
    });
  } else {
    tmuxPath = tmuxResult.stdout;
    logger.appendLine(`[prereq] tmux found at ${tmuxPath}`);
  }

  // Check git
  const gitResult = await runSafe('which', ['git']);
  if (gitResult.exitCode !== 0) {
    errors.push({
      tool: 'git',
      message: 'git is not installed or not on PATH.',
    });
  } else {
    logger.appendLine(`[prereq] git found at ${gitResult.stdout}`);
  }

  // Check claude
  const claudeResult = await runSafe('which', ['claude']);
  if (claudeResult.exitCode !== 0) {
    errors.push({
      tool: 'claude',
      message: 'claude CLI is not installed or not on PATH. Claude metadata generation will use fallback naming.',
    });
  } else {
    logger.appendLine(`[prereq] claude found at ${claudeResult.stdout}`);
  }

  // Check GitHub authentication
  const ghSession = await vscode.authentication.getSession(
    'github',
    ['repo'],
    { createIfNone: false },
  );
  if (!ghSession) {
    errors.push({
      tool: 'github',
      message: 'No GitHub authentication session found. Sign in via the Accounts menu.',
    });
  } else {
    logger.appendLine(`[prereq] GitHub auth OK (user: ${ghSession.account.label})`);
  }

  return { errors, tmuxPath };
}

// ============================================================================
// Service container
// ============================================================================

export class ServiceContainer implements vscode.Disposable {
  public readonly config: ExtensionConfig;
  public readonly currentUser: string;
  public readonly outputChannel: vscode.OutputChannel;
  public readonly tmuxPath: string;

  public readonly tmux: TmuxService;
  public readonly git: GitService;
  public readonly github: GitHubService;
  public readonly claude: ClaudeService;
  public readonly handover: ClaudeHandoverService;
  public readonly discovery: DiscoveryService;
  public readonly prCache: PRCacheService;
  public readonly sessionCache: SessionCacheService;
  public readonly prService: PRService;
  public readonly prStatus: PRStatusService;

  private readonly authListener: vscode.Disposable;

  private constructor(
    config: ExtensionConfig,
    currentUser: string,
    outputChannel: vscode.OutputChannel,
    tmuxPath: string,
    tmux: TmuxService,
    git: GitService,
    github: GitHubService,
    claude: ClaudeService,
    handover: ClaudeHandoverService,
    discovery: DiscoveryService,
    prCache: PRCacheService,
    sessionCache: SessionCacheService,
    prService: PRService,
    prStatus: PRStatusService,
    authListener: vscode.Disposable,
  ) {
    this.config = config;
    this.currentUser = currentUser;
    this.outputChannel = outputChannel;
    this.tmuxPath = tmuxPath;
    this.tmux = tmux;
    this.git = git;
    this.github = github;
    this.claude = claude;
    this.handover = handover;
    this.discovery = discovery;
    this.prCache = prCache;
    this.sessionCache = sessionCache;
    this.prService = prService;
    this.prStatus = prStatus;
    this.authListener = authListener;
  }

  static async create(
    outputChannel: vscode.OutputChannel,
    tmuxPath: string,
  ): Promise<ServiceContainer> {
    // 1. Read config
    const config = readConfig();
    outputChannel.appendLine(`[container] Config loaded: repo=${config.repoName}, clonesDir=${config.clonesDir}`);

    // 2. Get GitHub token
    const ghSession = await vscode.authentication.getSession(
      'github',
      ['repo'],
      { createIfNone: true },
    );
    const token = ghSession.accessToken;
    const currentUser = ghSession.account.label;
    outputChannel.appendLine(`[container] GitHub user: ${currentUser}`);

    // 3. Create services in dependency order
    const tmux = new TmuxService();
    const git = new GitService();
    const github = new GitHubService(token);
    const claude = new ClaudeService();

    const handover = new ClaudeHandoverService(tmux);

    const discovery = new DiscoveryService(
      tmux,
      git,
      github,
      config.sessionPrefix,
      outputChannel,
    );

    const prCache = new PRCacheService(
      github,
      config.repoName,
      config.prCacheTTL / 60_000,   // config stores ms, constructor expects minutes
      outputChannel,
    );

    const sessionCache = new SessionCacheService(
      discovery,
      config.autoRefreshInterval / 1_000,  // config stores ms, constructor expects seconds
      outputChannel,
    );

    const prService = new PRService(
      tmux,
      git,
      github,
      claude,
      handover,
      config,
    );

    const prStatus = new PRStatusService(
      tmux,
      github,
      prCache,
      config.clonesDir,
      config.repoName,
      config.sessionPrefix,
      outputChannel,
    );

    // 4. Listen for GitHub token changes
    const authListener = vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id !== 'github') {
        return;
      }
      outputChannel.appendLine('[container] GitHub auth session changed, refreshing token...');
      vscode.authentication
        .getSession('github', ['repo'], { createIfNone: false })
        .then((session) => {
          if (session) {
            github.updateToken(session.accessToken);
            outputChannel.appendLine(`[container] GitHub token updated (user: ${session.account.label})`);
          }
        });
    });

    return new ServiceContainer(
      config,
      currentUser,
      outputChannel,
      tmuxPath,
      tmux,
      git,
      github,
      claude,
      handover,
      discovery,
      prCache,
      sessionCache,
      prService,
      prStatus,
      authListener,
    );
  }

  // Adapter methods for commands/index.ts ServiceContainer interface

  readonly fs = {
    rmdir: async (path: string, opts?: { recursive?: boolean }): Promise<void> => {
      const { rm } = await import('fs/promises');
      await rm(path, { recursive: opts?.recursive ?? false, force: true });
    },
  };

  async groupedPRs(): Promise<import('./interfaces').GroupedPRs> {
    return this.prStatus.getGroupedPRs(this.currentUser);
  }

  invalidateCaches(): void {
    void this.prCache.invalidate(this.currentUser);
    void this.sessionCache.invalidate();
  }

  // Adapter methods for tree-provider.ts TreeServiceContainer interface

  async getGroupedPRs(): Promise<import('./interfaces').GroupedPRs> {
    return this.prStatus.getGroupedPRs(this.currentUser);
  }

  async getSessionStates(): Promise<import('./interfaces').SessionState[]> {
    return this.sessionCache.get();
  }

  dispose(): void {
    this.authListener.dispose();
  }
}
