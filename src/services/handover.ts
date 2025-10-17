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
  }): Promise<void> {
    // Build the full context prompt
    const fullContext = this.buildContext(context);

    // Escape the prompt for shell
    const escapedPrompt = fullContext.replace(/'/g, "'\\''");

    // Start Claude with the prompt as an argument
    // This way the prompt is queued and sent automatically after permission approval
    await this.tmux.sendKeys(sessionId, `claude '${escapedPrompt}'`);
  }

  private buildContext(context: {
    prNumber: number;
    branch: string;
    baseBranch: string;
    userPrompt: string;
    guidelines?: string;
  }): string {
    return `I'm working on PR #${context.prNumber} (${context.branch} -> ${context.baseBranch}).

User's request: ${context.userPrompt}

${context.guidelines ? `Project guidelines:\n${context.guidelines}\n` : ''}

Please help me implement this. Start by:
1. Updating the PR title and description if needed
2. Understanding the codebase context
3. Implementing the requested changes

Let me know when you're ready to start!`;
  }
}
