/**
 * openPR — QuickPick PR Switcher.
 *
 * Presents all PRs grouped with separators:
 *   Active Session  →  click opens terminal
 *   Cloned          →  click opens terminal
 *   Remote          →  click triggers setup
 *   ─── Actions ─── →  "Create new PR..." / "Setup existing PR..."
 *
 * This is the primary keyboard-driven navigation command.
 */

import * as vscode from 'vscode';
import type { OutputChannel } from 'vscode';
import type { GroupedPRs, PRWithStatus } from '../interfaces';

interface PRQuickPickItem extends vscode.QuickPickItem {
  action:
    | { kind: 'openTerminal'; prStatus: PRWithStatus }
    | { kind: 'setup'; prStatus: PRWithStatus }
    | { kind: 'createPR' }
    | { kind: 'setupPR' };
}

export async function openPR(
  container: {
    groupedPRs: () => Promise<GroupedPRs>;
  },
  terminalManager: { openTerminal: (sessionId: string, prContext?: { prNumber: number; title: string }) => void },
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    const grouped = await container.groupedPRs();
    const items = buildQuickPickItems(grouped);

    if (items.length === 0) {
      const action = await vscode.window.showInformationMessage(
        'No PRs found. Create one?',
        'Create New PR',
        'Setup Existing PR',
      );

      if (action === 'Create New PR') {
        await vscode.commands.executeCommand('mfh.createPR');
      } else if (action === 'Setup Existing PR') {
        await vscode.commands.executeCommand('mfh.setupPR');
      }
      return;
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Open PR',
      placeHolder: 'Search PRs by number, title, or branch...',
      matchOnDescription: true,
    });

    if (!picked) {
      return;
    }

    switch (picked.action.kind) {
      case 'openTerminal': {
        const pr = picked.action.prStatus;
        terminalManager.openTerminal(pr.sessionId, {
          prNumber: pr.pr.number,
          title: pr.pr.title,
        });
        break;
      }
      case 'setup': {
        await vscode.commands.executeCommand('mfh.setupPR', picked.action.prStatus);
        break;
      }
      case 'createPR': {
        await vscode.commands.executeCommand('mfh.createPR');
        break;
      }
      case 'setupPR': {
        await vscode.commands.executeCommand('mfh.setupPR');
        break;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] openPR failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to load PRs: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

function buildQuickPickItems(grouped: GroupedPRs): PRQuickPickItem[] {
  const items: PRQuickPickItem[] = [];

  // Active Session group
  if (grouped.activeSession.length > 0) {
    items.push({
      label: 'Active Session',
      kind: vscode.QuickPickItemKind.Separator,
      action: { kind: 'createPR' }, // never selected — separator
    });

    for (const pr of grouped.activeSession) {
      items.push({
        label: `$(terminal) #${pr.pr.number} ${pr.pr.title}`,
        description: `${pr.pr.branch} \u2192 ${pr.pr.baseBranch}`,
        detail: 'Active',
        action: { kind: 'openTerminal', prStatus: pr },
      });
    }
  }

  // Cloned group
  if (grouped.hasClone.length > 0) {
    items.push({
      label: 'Cloned',
      kind: vscode.QuickPickItemKind.Separator,
      action: { kind: 'createPR' },
    });

    for (const pr of grouped.hasClone) {
      items.push({
        label: `$(folder) #${pr.pr.number} ${pr.pr.title}`,
        description: `${pr.pr.branch} \u2192 ${pr.pr.baseBranch}`,
        detail: 'Cloned',
        action: { kind: 'openTerminal', prStatus: pr },
      });
    }
  }

  // Remote group (not set up)
  if (grouped.notSetUp.length > 0) {
    items.push({
      label: 'Remote',
      kind: vscode.QuickPickItemKind.Separator,
      action: { kind: 'createPR' },
    });

    for (const pr of grouped.notSetUp) {
      items.push({
        label: `$(cloud) #${pr.pr.number} ${pr.pr.title}`,
        description: `${pr.pr.branch} \u2192 ${pr.pr.baseBranch}`,
        detail: 'Remote — click to set up',
        action: { kind: 'setup', prStatus: pr },
      });
    }
  }

  // Actions separator
  items.push({
    label: 'Actions',
    kind: vscode.QuickPickItemKind.Separator,
    action: { kind: 'createPR' },
  });

  items.push({
    label: '$(add) Create new PR...',
    action: { kind: 'createPR' },
  });

  items.push({
    label: '$(cloud-download) Setup existing PR...',
    action: { kind: 'setupPR' },
  });

  return items;
}
