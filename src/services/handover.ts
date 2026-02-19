/**
 * ClaudeHandoverService — sends an initial Claude prompt into an existing
 * tmux session so that Claude starts working on the right task immediately.
 *
 * Three entry points:
 *   - `initialize()`        — standard PR work context (first launch).
 *   - `initializeWithError()` — error-fixing context.
 *   - `resume()`            — resume an existing Claude session by ID.
 *
 * Session IDs are discovered by scanning ~/.claude/projects/ after launch.
 * Each worktree stores its Claude session ID in `.mfh-session`.
 */

import { readdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import type { TmuxService } from './tmux';

const CLAUDE_PROJECTS_DIR = join(
  process.env.HOME ?? '/home/user',
  '.claude',
  'projects',
);

export class ClaudeHandoverService {
  private workerModel: string;

  constructor(private tmux: TmuxService, workerModel = '') {
    this.workerModel = workerModel;
  }

  /**
   * Initialize a Claude session with full PR context.
   * After launching, discovers and stores the Claude session ID.
   */
  async initialize(
    sessionId: string,
    context: {
      prNumber: number;
      branch: string;
      baseBranch: string;
      userPrompt: string;
      guidelines?: string;
      skipPermissions?: boolean;
    },
  ): Promise<void> {
    const fullContext = this.buildContext(context);
    await this.sendClaude(sessionId, fullContext, context.skipPermissions);
  }

  /**
   * Initialize a Claude session focused on fixing a specific error.
   */
  async initializeWithError(
    sessionId: string,
    context: {
      prNumber: number;
      branch: string;
      baseBranch: string;
      error: string;
      skipPermissions?: boolean;
    },
  ): Promise<void> {
    const fullContext = this.buildErrorContext(context);
    await this.sendClaude(sessionId, fullContext, context.skipPermissions);
  }

  /**
   * Resume an existing Claude conversation by session ID.
   * Uses `claude --resume <id>`.
   */
  async resume(
    tmuxSessionId: string,
    claudeSessionId: string,
    skipPermissions?: boolean,
  ): Promise<void> {
    const flags = skipPermissions ? ' --dangerously-skip-permissions' : '';
    await this.tmux.sendKeys(
      tmuxSessionId,
      `claude --resume ${claudeSessionId}${flags}`,
    );
  }

  /**
   * Find the most recent Claude session ID for a worktree path.
   * Scans ~/.claude/projects/{slug}/ for the newest .jsonl file.
   * Returns null if no session exists.
   */
  async findSessionId(workingDir: string): Promise<string | null> {
    const slug = workingDir.replace(/\//g, '-');
    const projectDir = join(CLAUDE_PROJECTS_DIR, slug);

    try {
      const entries = await readdir(projectDir);
      const jsonlFiles = entries.filter(
        (f) => f.endsWith('.jsonl') && !f.includes('/'),
      );

      if (jsonlFiles.length === 0) {
        return null;
      }

      // Find the most recently modified session file
      let newest: { name: string; mtime: number } | null = null;
      for (const file of jsonlFiles) {
        const s = await stat(join(projectDir, file));
        if (!newest || s.mtimeMs > newest.mtime) {
          newest = { name: file, mtime: s.mtimeMs };
        }
      }

      // Session ID is the filename without .jsonl
      return newest ? newest.name.replace('.jsonl', '') : null;
    } catch {
      return null;
    }
  }

  /**
   * Read the stored Claude session ID for a worktree.
   */
  async getStoredSessionId(clonePath: string): Promise<string | null> {
    try {
      const content = await readFile(join(clonePath, '.mfh-session'), 'utf-8');
      return content.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Store a Claude session ID for a worktree.
   */
  async storeSessionId(clonePath: string, sessionId: string): Promise<void> {
    await writeFile(join(clonePath, '.mfh-session'), sessionId + '\n');
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private async sendClaude(
    sessionId: string,
    prompt: string,
    skipPermissions?: boolean,
  ): Promise<void> {
    const escaped = prompt.replace(/'/g, "'\\''");

    const flags = [
      this.workerModel ? `--model ${this.workerModel}` : '',
      skipPermissions ? '--dangerously-skip-permissions' : '',
    ].filter(Boolean).join(' ');

    const claudeCommand = flags
      ? `claude '${escaped}' ${flags}`
      : `claude '${escaped}'`;

    await this.tmux.sendKeys(sessionId, claudeCommand);
  }

  private buildContext(context: {
    prNumber: number;
    branch: string;
    baseBranch: string;
    userPrompt: string;
    guidelines?: string;
  }): string {
    return [
      `Working on PR #${context.prNumber}`,
      `Branch: ${context.branch} -> ${context.baseBranch}`,
      '',
      `Task: ${context.userPrompt}`,
      '',
      ...(context.guidelines
        ? [`Guidelines:`, context.guidelines, '']
        : []),
      "You're in the PR's git repo. Implement the task following these steps:",
      '1. Read relevant files to understand the codebase',
      '2. Implement the changes',
      '3. Test your changes',
      '4. Commit with a clear message',
      '',
      "Focus on correctness and incremental progress. Let's build this.",
    ].join('\n');
  }

  private buildErrorContext(context: {
    prNumber: number;
    branch: string;
    baseBranch: string;
    error: string;
  }): string {
    return [
      `You're fixing an error in PR #${context.prNumber}`,
      `Branch: ${context.branch} -> ${context.baseBranch}`,
      '',
      'Error context:',
      context.error,
      '',
      'Fix this error. Read the relevant files, understand the root cause,',
      'apply the minimal fix, verify it compiles/passes, and commit.',
    ].join('\n');
  }
}
