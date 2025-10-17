/**
 * Core interfaces for mainframehub
 * All external dependencies are abstracted for full testability
 */

// ============================================================================
// Domain Models
// ============================================================================

export interface PullRequest {
  number: number;
  title: string;
  branch: string;
  baseBranch: string;
  repo: string;  // 'owner/repo' format
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  author: string;
  isDraft: boolean;
  created: Date;
  updated: Date;
}

export interface TmuxSession {
  id: string;
  workingDir: string;
  created: Date;
  attached: boolean;
}

export interface GitInfo {
  remote: string;  // Full git URL
  repo: string;    // 'owner/repo' parsed from remote
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
}

export interface SessionState {
  session: TmuxSession;
  workingDir: string;
  gitInfo: GitInfo | null;
  pr: PullRequest | null;
  // Derived states
  hasValidGit: boolean;
  hasPR: boolean;
  isActive: boolean;  // session.attached
}

export interface ClaudeMetadata {
  branchName: string;
  title: string;
  body: string;
}

// ============================================================================
// Service Interfaces
// ============================================================================

export interface ITmuxService {
  /**
   * List all sessions with given prefix
   */
  list(prefix: string): Promise<TmuxSession[]>;

  /**
   * Get a specific session
   */
  get(id: string): Promise<TmuxSession | null>;

  /**
   * Check if session exists
   */
  exists(id: string): Promise<boolean>;

  /**
   * Create a new session
   */
  create(params: {
    id: string;
    workingDir: string;
    command?: string;
  }): Promise<TmuxSession>;

  /**
   * Kill a session
   */
  kill(id: string): Promise<void>;

  /**
   * Send keys to a session (for Claude handover)
   */
  sendKeys(id: string, keys: string): Promise<void>;

  /**
   * Attach to a session (blocking)
   */
  attach(id: string): Promise<void>;
}

export interface IGitService {
  /**
   * Get remote URL for a git repo
   */
  getRemote(repoPath: string): Promise<string>;

  /**
   * Get current branch
   */
  getBranch(repoPath: string): Promise<string>;

  /**
   * Get git status (dirty, ahead, behind)
   */
  getStatus(repoPath: string): Promise<{
    isDirty: boolean;
    ahead: number;
    behind: number;
  }>;

  /**
   * Get full git info for a repo
   */
  getInfo(repoPath: string): Promise<GitInfo>;

  /**
   * Clone a repository
   */
  clone(url: string, targetPath: string, options?: {
    branch?: string;
    depth?: number;
  }): Promise<void>;

  /**
   * Create a branch
   */
  createBranch(repoPath: string, branchName: string): Promise<void>;

  /**
   * Checkout a branch
   */
  checkout(repoPath: string, branch: string): Promise<void>;

  /**
   * Create a commit
   */
  commit(repoPath: string, message: string, options?: {
    allowEmpty?: boolean;
  }): Promise<void>;

  /**
   * Push to remote
   */
  push(repoPath: string, options?: {
    setUpstream?: boolean;
    force?: boolean;
    branch?: string;
  }): Promise<void>;

  /**
   * Fetch from remote
   */
  fetch(repoPath: string): Promise<void>;
}

export interface IGitHubService {
  /**
   * List PRs for a repo
   */
  listPRs(repo: string, options?: {
    author?: string;
    state?: 'open' | 'closed' | 'all';
  }): Promise<PullRequest[]>;

  /**
   * Find a PR by repo and branch
   */
  findPR(params: {
    repo: string;
    branch: string;
  }): Promise<PullRequest | null>;

  /**
   * Get a specific PR
   */
  getPR(repo: string, number: number): Promise<PullRequest | null>;

  /**
   * Create a new PR
   */
  createPR(params: {
    repo: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<PullRequest>;

  /**
   * Update a PR
   */
  updatePR(repo: string, number: number, updates: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
  }): Promise<void>;

  /**
   * Close a PR
   */
  closePR(repo: string, number: number): Promise<void>;
}

export interface IClaudeService {
  /**
   * Generate PR metadata from user prompt
   */
  generateMetadata(prompt: string, options?: {
    guidelines?: string;
    model?: 'haiku' | 'sonnet';
  }): Promise<ClaudeMetadata>;

  /**
   * Check if Claude CLI is available
   */
  isAvailable(): Promise<boolean>;
}

export interface IFileSystem {
  /**
   * Check if path exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Create directory
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Remove directory
   */
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Read directory
   */
  readdir(path: string): Promise<string[]>;
}

// ============================================================================
// Configuration
// ============================================================================

export interface Config {
  repo: string;  // Full git URL
  repoName: string;  // 'owner/repo' format
  referenceGitPath: string;
  clonesDir: string;
  baseBranch: string;
  sessionPrefix: string;
  currentUser?: string;
  guidelines?: {
    branchFormat?: string;
    commitFormat?: string;
  };
}

// ============================================================================
// Session Discovery Service
// ============================================================================

export interface ISessionDiscoveryService {
  /**
   * Discover all sessions and their states
   * This is the core tmux-centric operation
   */
  discover(): Promise<SessionState[]>;

  /**
   * Discover a specific session
   */
  discoverOne(sessionId: string): Promise<SessionState | null>;
}

// ============================================================================
// PR Service
// ============================================================================

export interface IPRService {
  /**
   * Create a new PR with full flow:
   * 1. Generate metadata with Claude
   * 2. Create PR on GitHub
   * 3. Clone repository
   * 4. Create branch and empty commit
   * 5. Push
   * 6. Create tmux session
   * 7. Initialize Claude session
   */
  createNew(params: {
    prompt: string;
    baseBranch?: string;
  }): Promise<{
    pr: PullRequest;
    session: TmuxSession;
    clonePath: string;
  }>;

  /**
   * Setup an existing PR:
   * 1. Clone the PR's branch
   * 2. Create tmux session
   */
  setupExisting(prNumber: number): Promise<{
    pr: PullRequest;
    session: TmuxSession;
    clonePath: string;
  }>;

  /**
   * Close a PR and cleanup:
   * 1. Close PR on GitHub
   * 2. Kill tmux session
   * 3. Remove clone directory
   */
  close(prNumber: number): Promise<void>;
}

// ============================================================================
// Claude Handover Service
// ============================================================================

export interface IClaudeHandoverService {
  /**
   * Initialize Claude session with full context
   */
  initialize(sessionId: string, context: {
    prNumber: number;
    branch: string;
    baseBranch: string;
    userPrompt: string;
    guidelines?: string;
  }): Promise<void>;
}

// ============================================================================
// Utilities
// ============================================================================

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

/**
 * Parse PR number from session ID
 */
export function parsePRNumber(sessionId: string, prefix: string): number | null {
  if (!sessionId.startsWith(prefix)) return null;
  const num = parseInt(sessionId.slice(prefix.length), 10);
  return isNaN(num) ? null : num;
}
