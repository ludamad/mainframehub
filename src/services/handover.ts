/**
 * ClaudeHandoverService — sends an initial Claude prompt into an existing
 * tmux session so that Claude starts working on the right task immediately.
 *
 * Two entry points:
 *   - `initialize()`       — standard PR work context.
 *   - `initializeWithError()` — error-fixing context.
 *
 * Single quotes inside the prompt are escaped for bash ('\\''). The
 * entire prompt is wrapped in single quotes and delivered via
 * `tmux send-keys`.
 */

import type { TmuxService } from './tmux';

export class ClaudeHandoverService {
  constructor(private tmux: TmuxService) {}

  /**
   * Initialize a Claude session with full PR context.
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

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private async sendClaude(
    sessionId: string,
    prompt: string,
    skipPermissions?: boolean,
  ): Promise<void> {
    const escaped = prompt.replace(/'/g, "'\\''");

    const claudeCommand = skipPermissions
      ? `claude '${escaped}' --dangerously-skip-permissions`
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
