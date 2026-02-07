/**
 * createPR — Quick Create flow.
 *
 * 1. InputBox for the task prompt (reject empty).
 * 2. QuickPick for the base branch (config presets + "Other...").
 * 3. withProgress 8-step flow via prService.createNew().
 * 4. Auto-open terminal on success.
 *
 * Error handling offers "Retry" (same inputs) and "Start Over" (restart).
 */

import * as vscode from 'vscode';
import type { OutputChannel } from 'vscode';
import { withMfhProgress } from '../vscode/progress-adapter';

export async function createPR(
  container: {
    prService: { createNew: (params: { prompt: string; baseBranch?: string }, onProgress?: import('../interfaces').ProgressCallback) => Promise<{ pr: import('../interfaces').PullRequest; session: import('../interfaces').TmuxSession; clonePath: string }> };
    config: import('../interfaces').ExtensionConfig;
  },
  terminalManager: { openTerminal: (sessionId: string, prContext?: { prNumber: number; title: string }) => void },
  treeProvider: { refresh: () => void },
  outputChannel: OutputChannel,
): Promise<void> {
  const prompt = await vscode.window.showInputBox({
    title: 'Create New PR',
    prompt: 'Describe what this PR should do',
    placeHolder: 'e.g. Add user authentication with OAuth',
    validateInput: (value: string) => {
      if (!value.trim()) {
        return 'A description is required';
      }
      return undefined;
    },
  });

  if (prompt === undefined) {
    return;
  }

  const baseBranch = await pickBaseBranch(container.config);
  if (baseBranch === undefined) {
    return;
  }

  await executeCreatePR(prompt, baseBranch, container, terminalManager, treeProvider, outputChannel);
}

async function pickBaseBranch(config: import('../interfaces').ExtensionConfig): Promise<string | undefined> {
  const presets = config.baseBranchPresets;
  const items: vscode.QuickPickItem[] = presets.map((b) => ({ label: b }));
  items.push({ label: 'Other...', description: 'Enter a custom branch name' });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select Base Branch',
    placeHolder: 'Which branch should this PR target?',
  });

  if (!picked) {
    return undefined;
  }

  if (picked.label === 'Other...') {
    return vscode.window.showInputBox({
      title: 'Base Branch',
      prompt: 'Enter the base branch name',
      placeHolder: 'e.g. develop',
      validateInput: (value: string) => {
        if (!value.trim()) {
          return 'Branch name is required';
        }
        return undefined;
      },
    });
  }

  return picked.label;
}

async function executeCreatePR(
  prompt: string,
  baseBranch: string,
  container: {
    prService: { createNew: (params: { prompt: string; baseBranch?: string }, onProgress?: import('../interfaces').ProgressCallback) => Promise<{ pr: import('../interfaces').PullRequest; session: import('../interfaces').TmuxSession; clonePath: string }> };
  },
  terminalManager: { openTerminal: (sessionId: string, prContext?: { prNumber: number; title: string }) => void },
  treeProvider: { refresh: () => void },
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    const result = await withMfhProgress('Creating PR', (onProgress) =>
      container.prService.createNew({ prompt, baseBranch }, onProgress),
    );

    treeProvider.refresh();
    terminalManager.openTerminal(result.session.id, {
      prNumber: result.pr.number,
      title: result.pr.title,
    });

    const action = await vscode.window.showInformationMessage(
      `PR #${result.pr.number} created: ${result.pr.title}`,
      'View on GitHub',
    );

    if (action === 'View on GitHub') {
      await vscode.env.openExternal(vscode.Uri.parse(result.pr.url));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] createPR failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to create PR: ${message}`,
      'Retry',
      'Start Over',
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    } else if (action === 'Retry') {
      await executeCreatePR(prompt, baseBranch, container, terminalManager, treeProvider, outputChannel);
    } else if (action === 'Start Over') {
      await createPR(
        container as Parameters<typeof createPR>[0],
        terminalManager,
        treeProvider,
        outputChannel,
      );
    }
  }
}

export { pickBaseBranch };
