/**
 * Claude service for generating PR metadata
 */

import { execSync } from 'child_process';

export interface ClaudeMetadata {
  branchName: string;
  title: string;
  body: string;
}

export class ClaudeService {
  async generateMetadata(prompt: string, options?: {
    guidelines?: string;
    model?: 'haiku' | 'sonnet';
    skipPermissions?: boolean;
  }): Promise<ClaudeMetadata> {
    const model = options?.model || 'haiku';
    const guidelines = options?.guidelines || '';
    const skipPermissionsFlag = options?.skipPermissions ? ' --dangerously-skip-permissions' : '';

    const fullPrompt = `Generate PR metadata from this task:

"${prompt}"

${guidelines ? `Guidelines:\n${guidelines}\n` : ''}
Create:
1. Branch name: ad/TYPE/short-kebab-case
   Types: feat, fix, refactor, test, docs, chore
   Examples: ad/feat/add-auth, ad/fix/null-check

2. PR title: TYPE: concise description (max 72 chars)
   Examples: "feat: add user authentication", "fix: handle null values"

3. PR body: 2-4 sentences describing WHAT will be implemented and WHY

Output format (one line each):
BRANCH: <branch-name>
TITLE: <title>
BODY: <body>`;

    try {
      const output = execSync(`claude -p "${fullPrompt.replace(/"/g, '\\"')}" --model ${model}${skipPermissionsFlag}`, {
        encoding: 'utf-8',
        timeout: 30000,
      });

      const branchMatch = output.match(/BRANCH:\s*(.+)/);
      const titleMatch = output.match(/TITLE:\s*(.+)/);
      const bodyMatch = output.match(/BODY:\s*(.+)/);

      if (!branchMatch || !titleMatch || !bodyMatch) {
        throw new Error('Failed to parse Claude response');
      }

      return {
        branchName: branchMatch[1].trim(),
        title: titleMatch[1].trim().substring(0, 72),
        body: bodyMatch[1].trim(),
      };
    } catch (error: any) {
      // Fallback if Claude fails
      console.warn('Claude generation failed, using fallback');
      const timestamp = Date.now();
      return {
        branchName: `ad/feat/task-${timestamp}`,
        title: `feat: ${prompt.split(/[.!?\n]/)[0].trim()}`.substring(0, 72),
        body: `Working on: ${prompt}`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync('which claude', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
