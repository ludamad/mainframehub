/**
 * Claude Handover - Initialize Claude sessions with proper context
 */

import type { TmuxService } from './tmux.js';

export class ClaudeHandoverService {
  constructor(private tmux: TmuxService) {}

  /**
   * Initialize a Claude session with full context
   *
   * This is critical to get right:
   * 1. Start Claude with the prompt as an argument
   * 2. The prompt will be queued and sent after permission approval
   */
  async initialize(sessionId: string, context: {
    prNumber: number;
    branch: string;
    baseBranch: string;
    userPrompt: string;
    guidelines?: string;
    skipPermissions?: boolean;
  }): Promise<void> {
    // Build the full context prompt
    const fullContext = this.buildContext(context);

    // Escape the prompt for shell
    const escapedPrompt = fullContext.replace(/'/g, "'\\''");

    // Build Claude command with optional skip permissions flag
    const skipPermissionsFlag = context.skipPermissions ? ' --dangerously-skip-permissions' : '';
    const claudeCommand = `claude '${escapedPrompt}'${skipPermissionsFlag}`;

    // Start Claude with the prompt as an argument
    // This way the prompt is queued and sent automatically after permission approval
    await this.tmux.sendKeys(sessionId, claudeCommand);
  }

  private buildContext(context: {
    prNumber: number;
    branch: string;
    baseBranch: string;
    userPrompt: string;
    guidelines?: string;
  }): string {
    return `Working on PR #${context.prNumber}
Branch: ${context.branch} -> ${context.baseBranch}

Task: ${context.userPrompt}

${context.guidelines ? `Guidelines:\n${context.guidelines}\n` : ''}You're in the PR's git repo. Implement the task following these steps:
1. Read relevant files to understand the codebase
2. Implement the changes
3. Test your changes
4. Commit with a clear message

Focus on correctness and incremental progress. Let's build this.`;
  }
}
