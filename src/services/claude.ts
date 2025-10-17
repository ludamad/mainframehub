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
  }): Promise<ClaudeMetadata> {
    const model = options?.model || 'haiku';
    const guidelines = options?.guidelines || '';

    const fullPrompt = `You are helping set up a GitHub pull request. Based on the user's request, generate a branch name, title, and body.

User's request: ${prompt}

${guidelines ? `Guidelines:\n${guidelines}\n` : ''}

Generate:
1. A branch name following the pattern ad/TYPE/short-description (e.g., ad/feat/add-dark-mode, ad/fix/null-check)
2. A PR title following the pattern TYPE: description (e.g., "feat: add dark mode toggle", "refactor: simplify auth logic")
3. A brief PR body (2-4 sentences) describing what will be done

IMPORTANT: The title should start with the TYPE (feat, fix, refactor, etc.) followed by a colon, NOT with "ad/"

Respond ONLY in this exact format (one line each):
BRANCH: <branch-name>
TITLE: <title>
BODY: <body>`;

    try {
      const output = execSync(`claude -p "${fullPrompt.replace(/"/g, '\\"')}" --model ${model}`, {
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
