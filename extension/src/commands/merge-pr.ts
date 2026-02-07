/**
 * mergePR — Merge a pull request via the GitHub API.
 *
 * Normalizes tree-item argument, falls back to QuickPick if invoked from
 * the command palette.  Lets the user choose merge strategy
 * (merge / squash / rebase), confirms, then merges via Octokit.
 *
 * On success, offers "Delete Clone" and "View on GitHub" actions.
 */

import * as vscode from 'vscode';
import type { OutputChannel } from 'vscode';
import type { GroupedPRs, PRWithStatus } from '../interfaces';
import { PRTreeItem, SessionTreeItem } from '../views/tree-items';
import { withMfhProgress } from '../vscode/progress-adapter';

export async function mergePR(
  arg: PRWithStatus | PRTreeItem | SessionTreeItem | undefined,
  container: {
    github: { mergePR: (repo: string, number: number, method: 'merge' | 'squash' | 'rebase') => Promise<void> };
    groupedPRs: () => Promise<GroupedPRs>;
  },
  treeProvider: { refresh: () => void },
  outputChannel: OutputChannel,
): Promise<void> {
  // Normalize tree item
  if (arg instanceof PRTreeItem) {
    arg = arg.prStatus;
  }
  if (arg instanceof SessionTreeItem) {
    // SessionTreeItem does not carry PRWithStatus, bail to QuickPick
    arg = undefined;
  }

  let prStatus: PRWithStatus;

  if (arg && 'pr' in arg) {
    prStatus = arg;
  } else {
    // QuickPick fallback
    const picked = await pickPRToMerge(container);
    if (!picked) {
      return;
    }
    prStatus = picked;
  }

  // Pick merge strategy
  const strategyItems: (vscode.QuickPickItem & { method: 'merge' | 'squash' | 'rebase' })[] = [
    { label: 'Merge commit', description: 'Create a merge commit', method: 'merge' },
    { label: 'Squash and merge', description: 'Squash all commits into one', method: 'squash' },
    { label: 'Rebase and merge', description: 'Rebase commits onto base branch', method: 'rebase' },
  ];

  const strategy = await vscode.window.showQuickPick(strategyItems, {
    title: `Merge PR #${prStatus.pr.number}`,
    placeHolder: 'Select merge strategy',
  });

  if (!strategy) {
    return;
  }

  // Confirmation
  const confirm = await vscode.window.showWarningMessage(
    `Merge PR #${prStatus.pr.number} "${prStatus.pr.title}" using ${strategy.label.toLowerCase()}?`,
    { modal: true },
    'Merge',
  );

  if (confirm !== 'Merge') {
    return;
  }

  try {
    await withMfhProgress(`Merging PR #${prStatus.pr.number}`, async (onProgress) => {
      onProgress('Merging pull request...', 1, 1);
      await container.github.mergePR(prStatus.pr.repo, prStatus.pr.number, strategy.method);
    });

    treeProvider.refresh();

    const action = await vscode.window.showInformationMessage(
      `PR #${prStatus.pr.number} merged successfully!`,
      'Delete Clone',
      'View on GitHub',
    );

    if (action === 'Delete Clone') {
      await vscode.commands.executeCommand('mfh.deleteClone', prStatus);
    } else if (action === 'View on GitHub') {
      await vscode.env.openExternal(vscode.Uri.parse(prStatus.pr.url));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] mergePR #${prStatus.pr.number} failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to merge PR #${prStatus.pr.number}: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

async function pickPRToMerge(container: {
  groupedPRs: () => Promise<GroupedPRs>;
}): Promise<PRWithStatus | undefined> {
  const grouped = await container.groupedPRs();
  const mergeable = [...grouped.activeSession, ...grouped.hasClone, ...grouped.notSetUp];

  if (mergeable.length === 0) {
    await vscode.window.showInformationMessage('No open PRs available to merge.');
    return undefined;
  }

  const items = mergeable.map((pr) => ({
    label: `#${pr.pr.number} ${pr.pr.title}`,
    description: `${pr.pr.branch} \u2192 ${pr.pr.baseBranch}`,
    prStatus: pr,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Merge PR',
    placeHolder: 'Select a PR to merge',
  });

  return picked?.prStatus;
}
