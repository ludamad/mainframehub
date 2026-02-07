/**
 * Command registration for the MainframeHub VS Code extension.
 *
 * Every command handler normalizes its tree-item argument via the
 * PRTreeItem / SessionTreeItem instanceof checks before extracting
 * domain data.  Commands that need a target but receive none (command
 * palette invocation) show a QuickPick fallback.
 *
 * All error catch blocks: (1) log to outputChannel, (2) show error
 * with "Show Log" button.
 */

import * as vscode from 'vscode';
import type { OutputChannel } from 'vscode';
import type {
  ExtensionConfig,
  GroupedPRs,
  PRWithStatus,
  ProgressCallback,
  PullRequest,
  SessionState,
  TmuxSession,
} from '../interfaces';
import { PRTreeItem, SessionTreeItem } from '../views/tree-items';
import { createPR } from './create-pr';
import { setupPR } from './setup-pr';
import { openPR } from './open-pr';
import { fixThis } from './fix-this';
import { mergePR } from './merge-pr';

// ============================================================================
// Types for the collaborators injected from the extension entry point
// ============================================================================

export interface ServiceContainer {
  config: ExtensionConfig;
  prService: {
    createNew: (
      params: { prompt: string; baseBranch?: string },
      onProgress?: ProgressCallback,
    ) => Promise<{ pr: PullRequest; session: TmuxSession; clonePath: string }>;
    setupExisting: (
      prNumber: number,
      onProgress?: ProgressCallback,
    ) => Promise<{ pr: PullRequest; session: TmuxSession; clonePath: string }>;
    createFromBranch: (
      params: { branch: string; title: string; baseBranch?: string },
      onProgress?: ProgressCallback,
    ) => Promise<{ pr: PullRequest; session: TmuxSession; clonePath: string }>;
    close: (prNumber: number) => Promise<void>;
  };
  tmux: {
    list: (prefix: string) => Promise<TmuxSession[]>;
    kill: (id: string) => Promise<void>;
    sendKeys: (id: string, keys: string) => Promise<void>;
  };
  github: {
    mergePR: (repo: string, number: number, method: 'merge' | 'squash' | 'rebase') => Promise<void>;
    getPR: (repo: string, number: number) => Promise<PullRequest | null>;
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
  discovery: {
    discover: () => Promise<SessionState[]>;
  };
  fs: {
    rmdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  };
  groupedPRs: () => Promise<GroupedPRs>;
  invalidateCaches: () => void;
}

export interface TreeProvider {
  refresh: () => void;
  toggleMode: () => void;
}

export interface TerminalManager {
  openTerminal: (sessionId: string, prContext?: { prNumber: number; title: string }) => void;
}

export interface StatusBar {
  startSpin: () => void;
  stopSpin: () => void;
}

// ============================================================================
// Registration
// ============================================================================

export function registerCommands(
  context: vscode.ExtensionContext,
  container: ServiceContainer,
  treeProvider: TreeProvider,
  terminalManager: TerminalManager,
  statusBar: StatusBar,
  outputChannel?: OutputChannel,
): void {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('MainframeHub');
    context.subscriptions.push(outputChannel);
  }

  function reg(command: string, handler: (...args: any[]) => Promise<void> | void): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, handler),
    );
  }

  // ------------------------------------------------------------------
  // PR lifecycle commands (delegated to separate modules)
  // ------------------------------------------------------------------

  reg('mfh.createPR', () =>
    createPR(container, terminalManager, treeProvider, outputChannel),
  );

  reg('mfh.setupPR', (arg?: PRWithStatus | PRTreeItem) =>
    setupPR(arg, container, terminalManager, treeProvider, outputChannel),
  );

  reg('mfh.createFromBranch', () =>
    handleCreateFromBranch(container, terminalManager, treeProvider, outputChannel),
  );

  reg('mfh.openPR', () =>
    openPR(container, terminalManager, outputChannel),
  );

  reg('mfh.fixThis', () =>
    fixThis(container, terminalManager, treeProvider, outputChannel),
  );

  reg('mfh.mergePR', (arg?: PRWithStatus | PRTreeItem | SessionTreeItem) =>
    mergePR(arg, container, treeProvider, outputChannel),
  );

  // ------------------------------------------------------------------
  // sendToClaude
  // ------------------------------------------------------------------

  reg('mfh.sendToClaude', () =>
    handleSendToClaude(container, outputChannel),
  );

  // ------------------------------------------------------------------
  // resumeSession
  // ------------------------------------------------------------------

  reg('mfh.resumeSession', (arg?: PRWithStatus | SessionState | PRTreeItem | SessionTreeItem) =>
    handleResumeSession(arg, container, terminalManager, outputChannel),
  );

  // ------------------------------------------------------------------
  // initClaude
  // ------------------------------------------------------------------

  reg('mfh.initClaude', (arg?: PRWithStatus | SessionState | PRTreeItem | SessionTreeItem) =>
    handleInitClaude(arg, container, outputChannel),
  );

  // ------------------------------------------------------------------
  // closePR
  // ------------------------------------------------------------------

  reg('mfh.closePR', (arg?: PRWithStatus | PRTreeItem | SessionTreeItem) =>
    handleClosePR(arg, container, treeProvider, outputChannel),
  );

  // ------------------------------------------------------------------
  // deleteClone
  // ------------------------------------------------------------------

  reg('mfh.deleteClone', (arg?: PRWithStatus | PRTreeItem | SessionTreeItem) =>
    handleDeleteClone(arg, container, treeProvider, outputChannel),
  );

  // ------------------------------------------------------------------
  // killSession
  // ------------------------------------------------------------------

  reg('mfh.killSession', (arg?: PRWithStatus | SessionState | PRTreeItem | SessionTreeItem) =>
    handleKillSession(arg, container, treeProvider, outputChannel),
  );

  // ------------------------------------------------------------------
  // openPRInBrowser
  // ------------------------------------------------------------------

  reg('mfh.openPRInBrowser', (arg?: PRWithStatus | PRTreeItem | SessionTreeItem) =>
    handleOpenPRInBrowser(arg, container, outputChannel),
  );

  // ------------------------------------------------------------------
  // openCloneFolder
  // ------------------------------------------------------------------

  reg('mfh.openCloneFolder', (arg?: PRWithStatus | PRTreeItem) =>
    handleOpenCloneFolder(arg, outputChannel),
  );

  // ------------------------------------------------------------------
  // addCloneToWorkspace
  // ------------------------------------------------------------------

  reg('mfh.addCloneToWorkspace', (arg?: PRWithStatus | PRTreeItem) =>
    handleAddCloneToWorkspace(arg, outputChannel),
  );

  // ------------------------------------------------------------------
  // Utility commands
  // ------------------------------------------------------------------

  reg('mfh.refreshAll', () =>
    handleRefreshAll(container, treeProvider, statusBar, outputChannel),
  );

  reg('mfh.toggleViewMode', () => {
    treeProvider.toggleMode();
  });

  reg('mfh.openSettings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'mfh');
  });

  reg('mfh.showLog', () => {
    outputChannel.show();
  });

  reg('mfh.cleanupClosedPRs', () =>
    handleCleanupClosedPRs(container, treeProvider, outputChannel),
  );

  reg('mfh.discover', () =>
    handleDiscover(container, outputChannel),
  );
}

// ============================================================================
// createFromBranch
// ============================================================================

async function handleCreateFromBranch(
  container: ServiceContainer,
  terminalManager: TerminalManager,
  treeProvider: TreeProvider,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    const branch = await vscode.window.showInputBox({
      title: 'Create PR from Branch',
      prompt: 'Enter the remote branch name',
      placeHolder: 'e.g. feat/my-feature',
      validateInput: (value: string) => {
        if (!value.trim()) {
          return 'Branch name is required';
        }
        return undefined;
      },
    });

    if (!branch) {
      return;
    }

    const title = await vscode.window.showInputBox({
      title: 'PR Title',
      prompt: 'Enter a title for the pull request',
      placeHolder: 'e.g. feat: add user authentication',
      validateInput: (value: string) => {
        if (!value.trim()) {
          return 'Title is required';
        }
        return undefined;
      },
    });

    if (!title) {
      return;
    }

    const { withMfhProgress } = await import('../vscode/progress-adapter');
    const result = await withMfhProgress('Creating PR from branch', (onProgress) =>
      container.prService.createFromBranch({ branch, title, baseBranch: container.config.baseBranch }, onProgress),
    );

    treeProvider.refresh();
    terminalManager.openTerminal(result.session.id, {
      prNumber: result.pr.number,
      title: result.pr.title,
    });

    await vscode.window.showInformationMessage(
      `PR #${result.pr.number} created from branch ${branch}`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] createFromBranch failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to create PR from branch: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// sendToClaude
// ============================================================================

async function handleSendToClaude(
  container: ServiceContainer,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Gather text from editor selection or clipboard
    let text = '';

    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      text = editor.document.getText(editor.selection);
    }

    if (!text) {
      text = await vscode.env.clipboard.readText();
    }

    if (!text.trim()) {
      text = await vscode.window.showInputBox({
        title: 'Send to Claude',
        prompt: 'Enter the text to send to Claude',
        placeHolder: 'Type your message...',
      }) ?? '';

      if (!text.trim()) {
        return;
      }
    }

    // Pick session
    const sessions = await container.tmux.list(container.config.sessionPrefix);
    if (sessions.length === 0) {
      await vscode.window.showWarningMessage('No active sessions found.');
      return;
    }

    let targetSession: TmuxSession;

    if (sessions.length === 1) {
      targetSession = sessions[0];
    } else {
      const items = sessions.map((s) => ({
        label: s.id,
        description: s.workingDir,
        session: s,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: 'Send to Claude',
        placeHolder: 'Select session to send text to',
      });

      if (!picked) {
        return;
      }
      targetSession = picked.session;
    }

    await container.tmux.sendKeys(targetSession.id, text);

    await vscode.window.showInformationMessage(
      `Text sent to session ${targetSession.id}`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] sendToClaude failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to send to Claude: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// resumeSession
// ============================================================================

async function handleResumeSession(
  arg: PRWithStatus | SessionState | PRTreeItem | SessionTreeItem | undefined,
  container: ServiceContainer,
  terminalManager: TerminalManager,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Normalize tree items
    if (arg instanceof PRTreeItem) {
      arg = arg.prStatus;
    }
    if (arg instanceof SessionTreeItem) {
      arg = arg.sessionState;
    }

    let sessionId: string;
    let prNumber: number | undefined;
    let prTitle: string | undefined;

    if (arg && 'session' in arg) {
      // SessionState
      const state = arg as SessionState;
      sessionId = state.session.id;
      prNumber = state.pr?.number;
      prTitle = state.pr?.title;
    } else if (arg && 'sessionId' in arg) {
      // PRWithStatus
      const pr = arg as PRWithStatus;
      sessionId = pr.sessionId;
      prNumber = pr.pr.number;
      prTitle = pr.pr.title;
    } else {
      // QuickPick fallback
      const sessions = await container.tmux.list(container.config.sessionPrefix);
      if (sessions.length === 0) {
        await vscode.window.showWarningMessage('No active sessions found.');
        return;
      }

      const items = sessions.map((s) => ({
        label: s.id,
        description: s.workingDir,
        session: s,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: 'Resume Session',
        placeHolder: 'Select a session to resume',
      });

      if (!picked) {
        return;
      }
      sessionId = picked.session.id;
    }

    terminalManager.openTerminal(sessionId, prNumber !== undefined && prTitle !== undefined
      ? { prNumber, title: prTitle }
      : undefined,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] resumeSession failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to resume session: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// initClaude
// ============================================================================

async function handleInitClaude(
  arg: PRWithStatus | SessionState | PRTreeItem | SessionTreeItem | undefined,
  container: ServiceContainer,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Normalize tree items
    if (arg instanceof PRTreeItem) {
      arg = arg.prStatus;
    }
    if (arg instanceof SessionTreeItem) {
      arg = arg.sessionState;
    }

    let sessionId: string;
    let prNumber: number | undefined;
    let branch: string | undefined;
    let baseBranch: string | undefined;

    if (arg && 'session' in arg) {
      const state = arg as SessionState;
      sessionId = state.session.id;
      prNumber = state.pr?.number;
      branch = state.pr?.branch ?? state.gitInfo?.branch;
      baseBranch = state.pr?.baseBranch;
    } else if (arg && 'sessionId' in arg) {
      const pr = arg as PRWithStatus;
      sessionId = pr.sessionId;
      prNumber = pr.pr.number;
      branch = pr.pr.branch;
      baseBranch = pr.pr.baseBranch;
    } else {
      // QuickPick fallback
      const sessions = await container.tmux.list(container.config.sessionPrefix);
      if (sessions.length === 0) {
        await vscode.window.showWarningMessage('No active sessions found.');
        return;
      }

      const items = sessions.map((s) => ({
        label: s.id,
        description: s.workingDir,
        session: s,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: 'Initialize Claude',
        placeHolder: 'Select a session to initialize Claude in',
      });

      if (!picked) {
        return;
      }
      sessionId = picked.session.id;
    }

    const task = await vscode.window.showInputBox({
      title: 'Initialize Claude',
      prompt: 'What should Claude work on in this session?',
      placeHolder: 'e.g. Implement the login page with OAuth',
      validateInput: (value: string) => {
        if (!value.trim()) {
          return 'Task description is required';
        }
        return undefined;
      },
    });

    if (!task) {
      return;
    }

    const guidelines = buildGuidelinesString(container.config);

    await container.handover.initialize(sessionId, {
      prNumber: prNumber ?? 0,
      branch: branch ?? 'unknown',
      baseBranch: baseBranch ?? container.config.baseBranch,
      userPrompt: task,
      guidelines,
      skipPermissions: container.config.dangerouslySkipPermissions,
    });

    await vscode.window.showInformationMessage(
      `Claude initialized in session ${sessionId}`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] initClaude failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to initialize Claude: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// closePR
// ============================================================================

async function handleClosePR(
  arg: PRWithStatus | PRTreeItem | SessionTreeItem | undefined,
  container: ServiceContainer,
  treeProvider: TreeProvider,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Normalize tree items
    if (arg instanceof PRTreeItem) {
      arg = arg.prStatus;
    }
    if (arg instanceof SessionTreeItem) {
      arg = undefined; // SessionTreeItem doesn't carry PR number; fall through to QuickPick
    }

    let prStatus: PRWithStatus;

    if (arg && 'pr' in arg) {
      prStatus = arg as PRWithStatus;
    } else {
      const picked = await pickPRForAction(container, 'Close PR', 'Select a PR to close');
      if (!picked) {
        return;
      }
      prStatus = picked;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Close PR #${prStatus.pr.number} "${prStatus.pr.title}"?`,
      { modal: true },
      'Close PR',
    );

    if (confirm !== 'Close PR') {
      return;
    }

    await container.prService.close(prStatus.pr.number);
    treeProvider.refresh();

    await vscode.window.showInformationMessage(
      `PR #${prStatus.pr.number} closed.`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] closePR failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to close PR: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// deleteClone
// ============================================================================

async function handleDeleteClone(
  arg: PRWithStatus | PRTreeItem | SessionTreeItem | undefined,
  container: ServiceContainer,
  treeProvider: TreeProvider,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Normalize tree items
    if (arg instanceof PRTreeItem) {
      arg = arg.prStatus;
    }
    if (arg instanceof SessionTreeItem) {
      arg = undefined;
    }

    let prStatus: PRWithStatus;

    if (arg && 'pr' in arg) {
      prStatus = arg as PRWithStatus;
    } else {
      const grouped = await container.groupedPRs();
      const withClone = [
        ...grouped.activeSession,
        ...grouped.hasClone,
        ...grouped.closedWithClone,
      ];

      if (withClone.length === 0) {
        await vscode.window.showInformationMessage('No clones to delete.');
        return;
      }

      const items = withClone.map((pr) => ({
        label: `#${pr.pr.number} ${pr.pr.title}`,
        description: pr.clonePath ?? '',
        prStatus: pr,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: 'Delete Clone',
        placeHolder: 'Select a PR clone to delete',
      });

      if (!picked) {
        return;
      }
      prStatus = picked.prStatus;
    }

    if (!prStatus.clonePath) {
      await vscode.window.showWarningMessage(
        `PR #${prStatus.pr.number} has no clone to delete.`,
      );
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete clone for PR #${prStatus.pr.number}? This will remove ${prStatus.clonePath} and kill any associated sessions.`,
      { modal: true },
      'Delete',
    );

    if (confirm !== 'Delete') {
      return;
    }

    // Kill sessions with both naming conventions
    const prefix = container.config.sessionPrefix;
    const prNum = prStatus.pr.number;
    const sessionIds = [
      `${prefix}${prNum}`,
      `mfh-${prNum}`,
    ];

    for (const sid of sessionIds) {
      try {
        await container.tmux.kill(sid);
      } catch {
        // Session may not exist — that's fine
      }
    }

    // Remove clone directory
    await container.fs.rmdir(prStatus.clonePath, { recursive: true });

    treeProvider.refresh();

    await vscode.window.showInformationMessage(
      `Clone for PR #${prStatus.pr.number} deleted.`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] deleteClone failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to delete clone: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// killSession
// ============================================================================

async function handleKillSession(
  arg: PRWithStatus | SessionState | PRTreeItem | SessionTreeItem | undefined,
  container: ServiceContainer,
  treeProvider: TreeProvider,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Normalize tree items
    if (arg instanceof PRTreeItem) {
      arg = arg.prStatus;
    }
    if (arg instanceof SessionTreeItem) {
      arg = arg.sessionState;
    }

    let sessionId: string;
    let displayName: string;

    if (arg && 'session' in arg) {
      const state = arg as SessionState;
      sessionId = state.session.id;
      displayName = state.pr
        ? `PR #${state.pr.number} (${state.session.id})`
        : state.session.id;
    } else if (arg && 'sessionId' in arg) {
      const pr = arg as PRWithStatus;
      sessionId = pr.sessionId;
      displayName = `PR #${pr.pr.number} (${pr.sessionId})`;
    } else {
      // QuickPick fallback
      const sessions = await container.tmux.list(container.config.sessionPrefix);
      if (sessions.length === 0) {
        await vscode.window.showWarningMessage('No active sessions found.');
        return;
      }

      const items = sessions.map((s) => ({
        label: s.id,
        description: s.workingDir,
        session: s,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: 'Kill Session',
        placeHolder: 'Select a session to kill',
      });

      if (!picked) {
        return;
      }
      sessionId = picked.session.id;
      displayName = picked.session.id;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Kill session ${displayName}?`,
      { modal: true },
      'Kill',
    );

    if (confirm !== 'Kill') {
      return;
    }

    await container.tmux.kill(sessionId);
    treeProvider.refresh();

    await vscode.window.showInformationMessage(`Session ${displayName} killed.`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] killSession failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to kill session: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// openPRInBrowser
// ============================================================================

async function handleOpenPRInBrowser(
  arg: PRWithStatus | PRTreeItem | SessionTreeItem | undefined,
  container: ServiceContainer,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Normalize tree items
    if (arg instanceof PRTreeItem) {
      arg = arg.prStatus;
    }
    if (arg instanceof SessionTreeItem) {
      const state = arg.sessionState;
      if (state.pr) {
        await vscode.env.openExternal(vscode.Uri.parse(state.pr.url));
        return;
      }
      arg = undefined;
    }

    if (arg && 'pr' in arg) {
      await vscode.env.openExternal(vscode.Uri.parse((arg as PRWithStatus).pr.url));
      return;
    }

    // QuickPick fallback
    const picked = await pickPRForAction(container, 'Open in Browser', 'Select a PR to open on GitHub');
    if (!picked) {
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(picked.pr.url));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] openPRInBrowser failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to open PR in browser: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// openCloneFolder
// ============================================================================

async function handleOpenCloneFolder(
  arg: PRWithStatus | PRTreeItem | undefined,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Normalize tree items
    if (arg instanceof PRTreeItem) {
      arg = arg.prStatus;
    }

    if (!arg || !('pr' in arg)) {
      await vscode.window.showWarningMessage('No PR selected. Use this from the tree view context menu.');
      return;
    }

    const prStatus = arg as PRWithStatus;
    if (!prStatus.clonePath) {
      await vscode.window.showWarningMessage(`PR #${prStatus.pr.number} has no local clone.`);
      return;
    }

    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(prStatus.clonePath),
      { forceNewWindow: true },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] openCloneFolder failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to open clone folder: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// addCloneToWorkspace
// ============================================================================

async function handleAddCloneToWorkspace(
  arg: PRWithStatus | PRTreeItem | undefined,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    // Normalize tree items
    if (arg instanceof PRTreeItem) {
      arg = arg.prStatus;
    }

    if (!arg || !('pr' in arg)) {
      await vscode.window.showWarningMessage('No PR selected. Use this from the tree view context menu.');
      return;
    }

    const prStatus = arg as PRWithStatus;
    if (!prStatus.clonePath) {
      await vscode.window.showWarningMessage(`PR #${prStatus.pr.number} has no local clone.`);
      return;
    }

    const folderCount = vscode.workspace.workspaceFolders?.length ?? 0;
    vscode.workspace.updateWorkspaceFolders(folderCount, 0, {
      uri: vscode.Uri.file(prStatus.clonePath),
      name: `PR #${prStatus.pr.number}: ${prStatus.pr.title}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] addCloneToWorkspace failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to add clone to workspace: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// refreshAll
// ============================================================================

async function handleRefreshAll(
  container: ServiceContainer,
  treeProvider: TreeProvider,
  statusBar: StatusBar,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    statusBar.startSpin();
    container.invalidateCaches();
    treeProvider.refresh();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] refreshAll failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to refresh: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  } finally {
    statusBar.stopSpin();
  }
}

// ============================================================================
// cleanupClosedPRs
// ============================================================================

async function handleCleanupClosedPRs(
  container: ServiceContainer,
  treeProvider: TreeProvider,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    const grouped = await container.groupedPRs();
    const closedWithClone = grouped.closedWithClone;

    if (closedWithClone.length === 0) {
      await vscode.window.showInformationMessage('No closed PRs with local clones.');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Clean up ${closedWithClone.length} closed PR(s) with local clones? This will kill sessions and delete clone directories.`,
      { modal: true },
      'Clean Up All',
    );

    if (confirm !== 'Clean Up All') {
      return;
    }

    const prefix = container.config.sessionPrefix;

    for (const pr of closedWithClone) {
      // Kill sessions with both naming conventions
      const sessionIds = [
        `${prefix}${pr.pr.number}`,
        `mfh-${pr.pr.number}`,
      ];

      for (const sid of sessionIds) {
        try {
          await container.tmux.kill(sid);
        } catch {
          // Session may not exist
        }
      }

      // Remove clone directory
      if (pr.clonePath) {
        try {
          await container.fs.rmdir(pr.clonePath, { recursive: true });
        } catch (rmErr: unknown) {
          const rmMsg = rmErr instanceof Error ? rmErr.message : String(rmErr);
          outputChannel.appendLine(`[WARN] Failed to remove clone ${pr.clonePath}: ${rmMsg}`);
        }
      }
    }

    treeProvider.refresh();

    await vscode.window.showInformationMessage(
      `Cleaned up ${closedWithClone.length} closed PR(s).`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] cleanupClosedPRs failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to clean up closed PRs: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// discover
// ============================================================================

async function handleDiscover(
  container: ServiceContainer,
  outputChannel: OutputChannel,
): Promise<void> {
  try {
    const sessions = await container.discovery.discover();

    outputChannel.appendLine('--- Discovery Results ---');
    outputChannel.appendLine(`Found ${sessions.length} session(s):`);

    for (const state of sessions) {
      outputChannel.appendLine(`  Session: ${state.session.id}`);
      outputChannel.appendLine(`    Working Dir: ${state.session.workingDir}`);
      outputChannel.appendLine(`    Active: ${state.isActive}`);
      outputChannel.appendLine(`    Has Git: ${state.hasGit}`);
      if (state.gitInfo) {
        outputChannel.appendLine(`    Branch: ${state.gitInfo.branch}`);
        outputChannel.appendLine(`    Repo: ${state.gitInfo.repo}`);
      }
      if (state.pr) {
        outputChannel.appendLine(`    PR: #${state.pr.number} ${state.pr.title}`);
      }
    }

    outputChannel.appendLine('--- End Discovery ---');
    outputChannel.show();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[ERROR] discover failed: ${message}`);
    if (err instanceof Error && err.stack) {
      outputChannel.appendLine(err.stack);
    }

    const action = await vscode.window.showErrorMessage(
      `Discovery failed: ${message}`,
      'Show Log',
    );

    if (action === 'Show Log') {
      outputChannel.show();
    }
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

async function pickPRForAction(
  container: ServiceContainer,
  title: string,
  placeHolder: string,
): Promise<PRWithStatus | undefined> {
  const grouped = await container.groupedPRs();
  const allPRs = [
    ...grouped.activeSession,
    ...grouped.hasClone,
    ...grouped.notSetUp,
  ];

  if (allPRs.length === 0) {
    await vscode.window.showInformationMessage('No PRs found.');
    return undefined;
  }

  const items = allPRs.map((pr) => ({
    label: `#${pr.pr.number} ${pr.pr.title}`,
    description: `${pr.pr.branch} \u2192 ${pr.pr.baseBranch}`,
    prStatus: pr,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder,
  });

  return picked?.prStatus;
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
