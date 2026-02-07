/**
 * Core interfaces for the MainframeHub VS Code extension.
 * Single source of truth — every other file imports from here.
 */

// ============================================================================
// Domain Models
// ============================================================================

export interface PullRequest {
  number: number;
  title: string;
  branch: string;
  baseBranch: string;
  repo: string; // 'owner/repo' format
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
  remote: string; // Full git URL
  repo: string; // 'owner/repo' parsed from remote
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
}

export interface SessionState {
  session: TmuxSession;
  gitInfo: GitInfo | null;
  pr: PullRequest | null;
  hasGit: boolean;
  hasPR: boolean;
  isActive: boolean; // session.attached
}

export interface ClaudeMetadata {
  branchName: string;
  title: string;
  body: string;
}

// ============================================================================
// PR Status (used by tree view)
// ============================================================================

export interface PRWithStatus {
  pr: PullRequest;
  sessionId: string;
  cloneName: string;
  hasClone: boolean;
  hasSession: boolean;
  clonePath: string | null;
  ciStatus?: 'pending' | 'passing' | 'failing' | 'unknown';
}

export interface GroupedPRs {
  activeSession: PRWithStatus[];
  hasClone: PRWithStatus[];
  notSetUp: PRWithStatus[];
  closedWithClone: PRWithStatus[];
}

// ============================================================================
// Configuration
// ============================================================================

export interface ExtensionConfig {
  repo: string; // Full git URL
  repoName: string; // 'owner/repo' format (auto-derived if empty)
  referenceGitPath: string;
  clonesDir: string;
  baseBranch: string;
  sessionPrefix: string;
  baseBranchPresets: string[];
  dangerouslySkipPermissions: boolean;
  quickFixMode: boolean;
  guidelines: {
    branchFormat?: string;
    commitFormat?: string;
  };
  autoRefreshInterval: number; // milliseconds
  prCacheTTL: number; // milliseconds
}

// ============================================================================
// Progress
// ============================================================================

export type ProgressCallback = (
  step: string,
  current: number,
  total: number,
) => void;

// ============================================================================
// Run infrastructure
// ============================================================================

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  timeout?: number; // milliseconds, default 30_000
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse owner/repo from a git remote URL.
 *
 * Handles:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 *   https://github.com/owner/repo
 */
export function parseRepo(remote: string): string {
  const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  if (!match) {
    throw new Error(`Invalid GitHub remote: ${remote}`);
  }
  return match[1].replace(/\.git$/, '');
}

/**
 * Parse a PR number from a tmux session ID.
 *
 * Given prefix "pr-" and session "pr-123", returns 123.
 * Returns null when the session ID does not match the prefix or the suffix
 * is not a valid integer.
 */
export function parsePRNumber(
  sessionId: string,
  prefix: string,
): number | null {
  if (!sessionId.startsWith(prefix)) {
    return null;
  }
  const num = parseInt(sessionId.slice(prefix.length), 10);
  return isNaN(num) ? null : num;
}
