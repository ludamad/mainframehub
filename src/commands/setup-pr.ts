/**
 * setupPR — Clone and set up a tmux session for an existing GitHub PR.
 *
 * When invoked from the tree view, the PRWithStatus is passed directly.
 * When invoked from the command palette, a QuickPick lists "Not Set Up" PRs
 * plus a manual PR number input option.
 *
 * Uses a withProgress 4-step flow via prService.setupExisting().
 */

import * as vscode from 'vscode';
import type { OutputChannel } from 'vscode';
import type { PRWithStatus, ProgressCallback, PullRequest } from '../interfaces';
import { PRTreeItem } from '../views/tree-items';
import { withMfhProgress } from '../vscode/progress-adapter';

export async function setupPR(
  arg: PRWithStatus | PRTreeItem | undefined,
  container: {
    prService: {
      setupExisting: (
        prNumber: number,
        onProgress?: ProgressCallback,
      ) => Promise<{ pr: PullRequest; session: import('../interfaces').TmuxSession; clonePath: string }>;
    };
    groupedPRs: () => Promise<import('../interfaces').GroupedPRs>;
  },
  terminalManager: { openTerminal: (sessionId: string, prContext?: { prNumber: number; title: string }) => void },
  treeProvider: { refresh: () => void },
  outputChannel: OutputChannel,
): Promise<void> {
  // Normalize tree item to data
  if (arg instanceof PRTreeItem) {
    arg = arg.prStatus;
  }

  let prNumber: number;
  let prTitle: string | undefined;

  if (arg) {
    prNumber = arg.pr.number;
    prTitle = arg.pr.title;
  } else {
    // QuickPick fallback
    const picked = await pickPRToSetup(container);
    if (!picked) {
      return;
    }
    prNumber = picked.number;
    prTitle = picked.title;
  }

  try {
    const result = await withMfhProgress(
      `Setting up PR #${prNumber}`,
      (onProgress) => container.prService.setupExisting(prNumber, onProgress),
    );

    treeProvider.refresh();
    terminalManager.openTerminal(result.session.id, {
      prNumber: result.pr.number,
      title: result.pr.title,
    });

    await vscode.window.showInformationMessage(
      `PR #${result.pr.number} set up: ${result.pr.title}`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] setupPR #${prNumber} failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to set up PR #${prNumber}${prTitle ? ` (${prTitle})` : ''}: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

async function pickPRToSetup(container: {
  groupedPRs: () => Promise<import('../interfaces').GroupedPRs>;
}): Promise<{ number: number; title?: string } | undefined> {
  const grouped = await container.groupedPRs();
  const notSetUp = grouped.notSetUp;

  const items: (vscode.QuickPickItem & { prNumber?: number })[] = notSetUp.map(
    (pr) => ({
      label: `#${pr.pr.number} ${pr.pr.title}`,
      description: `${pr.pr.branch} \u2192 ${pr.pr.baseBranch}`,
      prNumber: pr.pr.number,
    }),
  );

  items.push({
    label: '$(edit) Enter PR number manually...',
    description: 'Set up a PR not in the list',
    prNumber: -1,
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Setup Existing PR',
    placeHolder: 'Select a PR to clone and set up locally',
  });

  if (!picked) {
    return undefined;
  }

  if (picked.prNumber === -1) {
    const input = await vscode.window.showInputBox({
      title: 'PR Number',
      prompt: 'Enter the GitHub PR number',
      placeHolder: 'e.g. 123',
      validateInput: (value: string) => {
        const num = parseInt(value, 10);
        if (isNaN(num) || num <= 0) {
          return 'Enter a valid PR number';
        }
        return undefined;
      },
    });

    if (!input) {
      return undefined;
    }

    return { number: parseInt(input, 10) };
  }

  return { number: picked.prNumber!, title: picked.label };
}
