/**
 * Claude Handover - Initialize Claude sessions with proper context
 */

import type { TmuxService } from './tmux.js';
import { execSync } from 'child_process';

export class ClaudeHandoverService {
  constructor(private tmux: TmuxService) {}

  /**
   * Initialize a Claude session with full context
   *
   * Strategy: Always try --resume first to continue existing session
   * If no session exists, start fresh with the full prompt
   */
  async initialize(sessionId: string, context: {
    prNumber: number;
    branch: string;
    baseBranch: string;
    userPrompt: string;
    prUrl?: string;
    guidelines?: string;
    skipPermissions?: boolean;
  }): Promise<void> {
    const skipPermissionsFlag = context.skipPermissions ? ' --dangerously-skip-permissions' : '';

    // Check if there's an existing Claude session to resume
    const hasExistingSession = this.checkForExistingSession(context.prNumber);

    if (hasExistingSession) {
      // Try to resume existing session first
      const claudeCommand = `claude --resume${skipPermissionsFlag}`;
      await this.tmux.sendKeys(sessionId, claudeCommand);
    } else {
      // Start fresh with full context
      const fullContext = this.buildContext(context);
      const escapedPrompt = fullContext.replace(/'/g, "'\\''");
      const claudeCommand = `claude '${escapedPrompt}'${skipPermissionsFlag}`;
      await this.tmux.sendKeys(sessionId, claudeCommand);
    }
  }

  private checkForExistingSession(prNumber: number): boolean {
    try {
      // Check if there's a .claude directory with session data
      const result = execSync(`ls -la ~/.claude/projects/ 2>/dev/null | grep -q . && echo "yes" || echo "no"`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      return result === 'yes';
    } catch {
      return false;
    }
  }

  private buildContext(context: {
    prNumber: number;
    branch: string;
    baseBranch: string;
    userPrompt: string;
    prUrl?: string;
    guidelines?: string;
  }): string {
    const prFilesUrl = context.prUrl ? `${context.prUrl}/files` : `https://github.com/AztecProtocol/aztec-packages/pull/${context.prNumber}/files`;

    return `You are working on PR #${context.prNumber}
Branch: ${context.branch} -> ${context.baseBranch}
PR Link: ${prFilesUrl}

## TASK
${context.userPrompt}

${context.guidelines ? `## GUIDELINES\n${context.guidelines}\n` : ''}
## AUTOMATED MODE CHECKLIST

You are in **fully automated mode**. Do NOT ask the user questions. Execute the following workflow:

### Phase 1: Plan
1. Read and understand the task requirements
2. Explore relevant files to understand the codebase structure
3. Create a clear implementation plan (keep it in your context)

### Phase 2: Implement
4. Implement changes following your plan
5. Make incremental, focused changes

### Phase 3: Commit & Push
6. After EVERY meaningful change: stage, commit, and push immediately
   - Use clear commit messages following conventional commits (feat:, fix:, refactor:, etc.)
   - Run: git add -A && git commit -m "type: description" && git push

### Phase 4: PR Maintenance
7. After pushing, ALWAYS review and update the PR title and description if needed
   - Ensure title accurately reflects what was implemented
   - Update description with summary of changes
   - Use: gh pr edit ${context.prNumber} --title "..." --body "..."

### Phase 5: Notify
8. After completing work, remind the user to review the PR:
   "Changes pushed! Review the PR at: ${prFilesUrl}"

## IMPORTANT RULES
- NEVER ask for clarification - make reasonable decisions and proceed
- Push after EVERY change, not just at the end
- Keep PR title/description current - this context is retained when compacting
- If tests fail, fix them and push again
- If you're unsure about something, implement the most reasonable interpretation

Begin execution now.`;
  }
}
