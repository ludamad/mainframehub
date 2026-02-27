/**
 * fixThis — Error-to-PR flow.
 *
 * Gathers error text from multiple sources (editor selection, terminal
 * selection, clipboard, or manual input), then creates a new PR with an
 * error-aware prompt.
 *
 * When `quickFixMode` is enabled in config, the InputBox editing step is
 * skipped and the gathered text is used directly.
 *
 * Uses handover.initializeWithError() style context for the Claude session.
 */

import * as vscode from 'vscode';
import type { OutputChannel } from 'vscode';
import type { ExtensionConfig, ProgressCallback, PullRequest, TmuxSession } from '../interfaces';
import { withMfhProgress } from '../vscode/progress-adapter';
import { pickBaseBranch } from './create-pr';

export async function fixThis(
  container: {
    prService: {
      createNew: (
        params: { prompt: string; baseBranch?: string },
        onProgress?: ProgressCallback,
      ) => Promise<{ pr: PullRequest; session: TmuxSession; clonePath: string }>;
    };
    handover: {
      initialize: (
        sessionId: string,
        context: {
          prNumber: number;
          branch: string;
          baseBranch: string;
          userPrompt: string;
          guidelines?: string;
          skipPermissions?: boolean;
        },
      ) => Promise<void>;
    };
    config: ExtensionConfig;
  },
  terminalManager: { openTerminal: (sessionId: string, prContext?: { prNumber: number; title: string }) => void },
  treeProvider: { refresh: () => void },
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Step 1: Gather error text from available sources
    let errorText = await gatherErrorText();

    // Step 2: Show InputBox pre-filled (skip in quickFixMode)
    if (!container.config.quickFixMode) {
      const edited = await vscode.window.showInputBox({
        title: 'Fix This Error',
        prompt: 'Describe the error or paste the error text',
        value: errorText,
        placeHolder: 'Paste error message or stack trace here',
        validateInput: (value: string) => {
          if (!value.trim()) {
            return 'Error description is required';
          }
          return undefined;
        },
      });

      if (edited === undefined) {
        return;
      }
      errorText = edited;
    } else if (!errorText.trim()) {
      // quickFixMode but no text gathered — need manual input
      const manual = await vscode.window.showInputBox({
        title: 'Fix This Error',
        prompt: 'No error text found. Describe the error manually.',
        placeHolder: 'Paste error message or stack trace here',
        validateInput: (value: string) => {
          if (!value.trim()) {
            return 'Error description is required';
          }
          return undefined;
        },
      });

      if (manual === undefined) {
        return;
      }
      errorText = manual;
    }

    // Step 3: Pick base branch
    const baseBranch = await pickBaseBranch(container.config);
    if (baseBranch === undefined) {
      return;
    }

    // Step 4: Create PR with error-aware prompt
    const errorPrompt = buildErrorPrompt(errorText);

    const shortError = errorText.length > 50 ? errorText.slice(0, 47) + '...' : errorText;
    const result = await withMfhProgress(`Fixing: ${shortError}`, (onProgress) =>
      container.prService.createNew({ prompt: errorPrompt, baseBranch }, onProgress),
    );

    // Step 5: Initialize Claude with error context
    const guidelines = buildGuidelinesString(container.config);
    await container.handover.initialize(result.session.id, {
      prNumber: result.pr.number,
      branch: result.pr.branch,
      baseBranch: result.pr.baseBranch,
      userPrompt: errorPrompt,
      guidelines,
      skipPermissions: container.config.dangerouslySkipPermissions,
    });

    treeProvider.refresh();
    terminalManager.openTerminal(result.session.id, {
      prNumber: result.pr.number,
      title: result.pr.title,
    });

    await vscode.window.showInformationMessage(
      `Fix PR #${result.pr.number} created: ${result.pr.title}`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] fixThis failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to create fix PR: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

async function gatherErrorText(): Promise<string> {
  // Source 1: Editor selection
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    if (!selection.isEmpty) {
      return editor.document.getText(selection);
    }
  }

  // Source 2: Terminal selection (requires vscode ^1.93.0)
  const terminal = vscode.window.activeTerminal;
  if (terminal) {
    const termSelection = (terminal as { selection?: string }).selection;
    if (typeof termSelection === 'string' && termSelection.trim()) {
      return termSelection;
    }
  }

  // Source 3: Clipboard
  const clipboard = await vscode.env.clipboard.readText();
  if (clipboard.trim()) {
    return clipboard;
  }

  // Source 4: Nothing found — return empty
  return '';
}

function buildErrorPrompt(errorText: string): string {
  return `Fix the following error:\n\n\`\`\`\n${errorText}\n\`\`\`\n\nInvestigate the root cause, implement a fix, and add a test to prevent regression.`;
}

function buildGuidelinesString(config: ExtensionConfig): string | undefined {
  const parts: string[] = [];
  if (config.guidelines.branchFormat) {
    parts.push(`Branch format: ${config.guidelines.branchFormat}`);
  }
  if (config.guidelines.commitFormat) {
    parts.push(`Commit format: ${config.guidelines.commitFormat}`);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}
