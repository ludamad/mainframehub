/**
 * ClaudeService — generates PR metadata (branch name, title, body) by
 * shelling out to the `claude` CLI.
 *
 * Falls back to timestamp-based naming when Claude is unavailable or the
 * response cannot be parsed.
 */

import { run, runSafe } from '../lib/run';
import type { ClaudeMetadata } from '../interfaces';
import { ClaudeError } from '../errors';

export class ClaudeService {
  /**
   * Ask Claude to generate branch name, PR title, and PR body from a
   * free-form task description.
   *
   * On failure the method returns a deterministic fallback so callers
   * never need to handle the error case themselves.
   */
  async generateMetadata(
    prompt: string,
    opts?: {
      guidelines?: string;
      model?: 'haiku' | 'sonnet';
    },
  ): Promise<ClaudeMetadata> {
    const model = opts?.model ?? 'haiku';
    const guidelines = opts?.guidelines ?? '';

    const fullPrompt = `Generate PR metadata from this task:

"${prompt}"

${guidelines ? `Guidelines:\n${guidelines}\n` : ''}Create:
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
      const output = await run(
        'claude',
        ['-p', fullPrompt, '--model', model],
        { timeout: 30_000 },
      );

      const branchMatch = output.match(/BRANCH:\s*(.+)/);
      const titleMatch = output.match(/TITLE:\s*(.+)/);
      const bodyMatch = output.match(/BODY:\s*(.+)/);

      if (!branchMatch || !titleMatch || !bodyMatch) {
        throw new ClaudeError('Failed to parse Claude response', {
          output,
        });
      }

      return {
        branchName: branchMatch[1].trim(),
        title: titleMatch[1].trim().substring(0, 72),
        body: bodyMatch[1].trim(),
      };
    } catch {
      const timestamp = Date.now();
      return {
        branchName: `ad/feat/task-${timestamp}`,
        title: `feat: ${prompt.split(/[.!?\n]/)[0].trim()}`.substring(0, 72),
        body: `Working on: ${prompt}`,
      };
    }
  }

  /**
   * Check whether the `claude` binary is available on PATH.
   */
  async isAvailable(): Promise<boolean> {
    const result = await runSafe('which', ['claude']);
    return result.exitCode === 0;
  }
}
