/**
 * Main entry point for the MainframeHub VS Code extension.
 *
 * Activation flow:
 *   1. Create output channel and wire it into the run logger.
 *   2. Run prerequisite checks (tmux, git, claude, GitHub auth).
 *   3. Determine whether the extension is configured (repo + clonesDir set).
 *   4. Create the status bar (always visible, even when unconfigured).
 *   5. Register the file decoration provider.
 *   6. If not configured: register a placeholder tree view and all commands
 *      with a null container (commands show a "not configured" prompt).
 *   7. If configured: create the ServiceContainer, tree view, terminal
 *      manager, register all commands, start the auto-refresh interval,
 *      listen for config changes, register the URI handler, and kick off
 *      the initial non-blocking data load.
 *
 * Every disposable is pushed to `context.subscriptions` so VS Code tears
 * everything down on deactivation.
 */

import * as vscode from 'vscode';
import { setRunLogger } from './lib/run';
import { readConfig } from './config';
import {
  checkPrerequisites,
  ServiceContainer,
} from './container';
import { MfhTreeDataProvider } from './views/tree-provider';
import { TerminalManager } from './views/terminal-manager';
import { StatusBarManager } from './views/status-bar';
import { MfhDecorationProvider } from './views/decoration-provider';
import { registerCommands } from './commands/index';

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // -----------------------------------------------------------------------
  // 1. Output channel + run logger
  // -----------------------------------------------------------------------
  const outputChannel = vscode.window.createOutputChannel('MainframeHub');
  context.subscriptions.push(outputChannel);
  setRunLogger(outputChannel);
  outputChannel.appendLine('[activate] MainframeHub extension activating...');

  // -----------------------------------------------------------------------
  // 2. Prerequisite checks
  // -----------------------------------------------------------------------
  const { errors: prereqErrors, tmuxPath } =
    await checkPrerequisites(outputChannel);

  for (const err of prereqErrors) {
    outputChannel.appendLine(`[prereq] WARNING: ${err.tool} — ${err.message}`);
  }

  // -----------------------------------------------------------------------
  // 3. Determine whether the extension is configured
  // -----------------------------------------------------------------------
  const config = readConfig();
  const isConfigured = !!(config.repo && config.clonesDir);

  if (!isConfigured) {
    outputChannel.appendLine('[activate] Extension is not fully configured (repo or clonesDir missing).');
  }

  // -----------------------------------------------------------------------
  // 4. Status bar (always visible)
  // -----------------------------------------------------------------------
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);

  if (!isConfigured) {
    statusBar.setConfigured(false);
  }

  // -----------------------------------------------------------------------
  // 5. File decoration provider
  // -----------------------------------------------------------------------
  // MfhDecorationProvider registers itself in its constructor
  const decorationProvider = new MfhDecorationProvider();
  context.subscriptions.push(decorationProvider);

  // -----------------------------------------------------------------------
  // 6. Not configured path
  // -----------------------------------------------------------------------
  if (!isConfigured) {
    // Placeholder tree view with welcome content
    const emptyTreeProvider = new MfhTreeDataProvider(null);
    const treeView = vscode.window.createTreeView('mfh.treeView', {
      treeDataProvider: emptyTreeProvider,
      showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Register all commands with null container — they show a prompt to configure
    registerCommands(context, null as any, emptyTreeProvider, null as any, statusBar);

    // Set when-clause contexts
    await vscode.commands.executeCommand('setContext', 'mfh.isConfigured', false);
    await vscode.commands.executeCommand('setContext', 'mfh.hasActiveSessions', false);
    await vscode.commands.executeCommand('setContext', 'mfh.hasPRs', false);

    // Listen for config changes — notify when manually configured (wizard handles its own restart)
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('mfh')) {
          return;
        }
        const updated = readConfig();
        if (updated.repo && updated.clonesDir) {
          outputChannel.appendLine('[config] Extension is now configured.');
          vscode.window
            .showInformationMessage(
              'MainframeHub is now configured. Restart to activate.',
              'Restart',
            )
            .then((action) => {
              if (action === 'Restart') {
                vscode.commands.executeCommand('workbench.action.restartExtensionHost');
              }
            });
        }
      }),
    );

    outputChannel.appendLine('[activate] Activation complete (not configured).');
    return;
  }

  // -----------------------------------------------------------------------
  // 7. Create service container
  // -----------------------------------------------------------------------
  let container: ServiceContainer;
  try {
    container = await ServiceContainer.create(outputChannel, tmuxPath);
    context.subscriptions.push(container);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[activate] Failed to create service container: ${message}`);
    vscode.window.showErrorMessage(
      `MainframeHub failed to initialize: ${message}`,
      'Show Log',
    ).then((action) => {
      if (action === 'Show Log') {
        outputChannel.show();
      }
    });
    return;
  }

  // -----------------------------------------------------------------------
  // 8. Tree view
  // -----------------------------------------------------------------------
  const treeProvider = new MfhTreeDataProvider(container);
  const treeView = vscode.window.createTreeView('mfh.treeView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // -----------------------------------------------------------------------
  // 9. Terminal manager
  // -----------------------------------------------------------------------
  const terminalManager = new TerminalManager(tmuxPath);
  context.subscriptions.push(terminalManager);

  // -----------------------------------------------------------------------
  // 10. Register all commands
  // -----------------------------------------------------------------------
  registerCommands(context, container as any, treeProvider, terminalManager, statusBar, outputChannel);

  // -----------------------------------------------------------------------
  // 11. Initial when-clause contexts
  // -----------------------------------------------------------------------
  await vscode.commands.executeCommand('setContext', 'mfh.isConfigured', true);
  await vscode.commands.executeCommand('setContext', 'mfh.hasActiveSessions', false);
  await vscode.commands.executeCommand('setContext', 'mfh.hasPRs', false);

  // -----------------------------------------------------------------------
  // 12. Auto-refresh interval
  // -----------------------------------------------------------------------
  const refreshInterval = setInterval(async () => {
    try {
      await container.sessionCache.refresh();
      treeProvider.refresh();

      const grouped = treeProvider.getCachedPRData();
      if (grouped) {
        const hasActive = grouped.activeSession.length > 0;
        const hasPRs =
          grouped.activeSession.length +
          grouped.hasClone.length +
          grouped.notSetUp.length > 0;

        await vscode.commands.executeCommand('setContext', 'mfh.hasActiveSessions', hasActive);
        await vscode.commands.executeCommand('setContext', 'mfh.hasPRs', hasPRs);

        statusBar.setActiveCount(grouped.activeSession.length);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[refresh] Auto-refresh failed: ${message}`);
    }
  }, container.config.autoRefreshInterval);

  context.subscriptions.push(
    new vscode.Disposable(() => clearInterval(refreshInterval)),
  );

  // -----------------------------------------------------------------------
  // 13. Config change listener
  // -----------------------------------------------------------------------
  const configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (!e.affectsConfiguration('mfh')) {
      return;
    }

    outputChannel.appendLine('[config] Configuration changed, rebuilding container...');

    // Dispose old container
    container.dispose();

    try {
      const newContainer = await ServiceContainer.create(outputChannel, tmuxPath);
      // Replace container reference — commands capture the container from
      // the closure in registerCommands, but the tree provider holds a
      // direct reference that we can update.
      container = newContainer;
      context.subscriptions.push(newContainer);
      treeProvider.setContainer(newContainer);
      treeProvider.refresh();

      outputChannel.appendLine('[config] Container rebuilt successfully.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[config] Failed to rebuild container: ${message}`);
      vscode.window.showErrorMessage(
        `MainframeHub failed to reconfigure: ${message}`,
        'Show Log',
      ).then((action) => {
        if (action === 'Show Log') {
          outputChannel.show();
        }
      });
    }
  });
  context.subscriptions.push(configListener);

  // -----------------------------------------------------------------------
  // 14. URI handler: vscode://mainframehub.mainframehub/fix?error=TEXT
  // -----------------------------------------------------------------------
  const uriHandler: vscode.UriHandler = {
    handleUri(uri: vscode.Uri): void {
      const params = new URLSearchParams(uri.query);
      const errorText = params.get('error');
      if (uri.path === '/fix' && errorText) {
        vscode.commands.executeCommand('mfh.fixThis', errorText);
      }
    },
  };
  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

  // -----------------------------------------------------------------------
  // 15. Initial data load (non-blocking)
  // -----------------------------------------------------------------------
  (async () => {
    try {
      outputChannel.appendLine('[activate] Starting initial data load...');

      // Load PR data
      const prs = await container.prCache.get(container.currentUser);
      outputChannel.appendLine(`[activate] Loaded ${prs.length} PRs for ${container.currentUser}.`);

      // Refresh session cache
      await container.sessionCache.refresh();

      // Update tree view
      treeProvider.refresh();

      // Update when-clause contexts and status bar
      const grouped = treeProvider.getCachedPRData();
      if (grouped) {
        const hasActive = grouped.activeSession.length > 0;
        const hasPRs =
          grouped.activeSession.length +
          grouped.hasClone.length +
          grouped.notSetUp.length > 0;

        await vscode.commands.executeCommand('setContext', 'mfh.hasActiveSessions', hasActive);
        await vscode.commands.executeCommand('setContext', 'mfh.hasPRs', hasPRs);

        statusBar.setActiveCount(grouped.activeSession.length);
      }

      // Check for closed PRs with lingering clones — fire and forget
      const closedWithClone = grouped?.closedWithClone ?? [];
      if (closedWithClone.length > 0) {
        vscode.window
          .showInformationMessage(
            `${closedWithClone.length} closed PR(s) still have local clones.`,
            'Clean Up All',
            'Dismiss',
          )
          .then((action) => {
            if (action === 'Clean Up All') {
              vscode.commands.executeCommand('mfh.cleanupClosedClones');
            }
          });
        // NOTE: intentionally not awaited — fire and forget
      }

      outputChannel.appendLine('[activate] Initial data load complete.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[activate] Initial data load failed: ${message}`);
    }
  })();

  outputChannel.appendLine('[activate] MainframeHub extension activated.');
}

export function deactivate(): void {
  // All cleanup handled by context.subscriptions disposal
}
