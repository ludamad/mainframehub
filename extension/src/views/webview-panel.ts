/**
 * Webview panel manager for the MainframeHub dashboard.
 *
 * Creates a WebviewPanel that hosts the unified webview UI.
 * Implements a BridgeHandler that dispatches incoming postMessage
 * requests to the ServiceContainer and streams progress updates back.
 *
 * The panel uses `retainContextWhenHidden: true` so tab switches
 * don't destroy the webview state.
 */

import * as vscode from 'vscode';
import type { ServiceContainer } from '../container';
import type { TerminalManager } from './terminal-manager';
import type {
  WebviewRequest,
  HostResponse,
  HostProgress,
  HostEvent,
} from '../webview/bridge';
import type { ProgressCallback } from '../interfaces';

export class WebviewPanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private container: ServiceContainer,
    private readonly terminalManager: TerminalManager,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  /**
   * Show the dashboard panel. Creates it if it doesn't exist,
   * or reveals it if it's already open.
   */
  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'mfh.dashboard',
      'MainframeHub',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        ],
      },
    );

    this.panel.iconPath = new vscode.ThemeIcon('terminal');
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewRequest) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
      },
      undefined,
      this.disposables,
    );
  }

  /**
   * Replace the container (e.g. after reconfiguration).
   */
  setContainer(container: ServiceContainer): void {
    this.container = container;
    this.postEvent('dataChanged');
  }

  /**
   * Notify the webview that data has changed (e.g. after auto-refresh).
   */
  notifyDataChanged(): void {
    this.postEvent('dataChanged');
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  // --------------------------------------------------------------------------
  // Message handling
  // --------------------------------------------------------------------------

  private async handleMessage(msg: WebviewRequest): Promise<void> {
    if (msg.type !== 'request') return;

    const { id, method, params } = msg;

    try {
      const result = await this.dispatch(id, method, params);
      this.postResponse(id, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[webview] ${method} failed: ${message}`);
      if (err instanceof Error && err.stack) {
        this.outputChannel.appendLine(err.stack);
      }
      this.postResponse(id, undefined, message);
    }
  }

  private async dispatch(
    id: string,
    method: string,
    params: unknown[],
  ): Promise<unknown> {
    const onProgress: ProgressCallback = (step, current, total) => {
      this.postProgress(id, { step, current, total });
    };

    switch (method) {
      // Queries
      case 'getGroupedPRs':
        return this.container.getGroupedPRs();
      case 'getSessionStates':
        return this.container.getSessionStates();
      case 'getConfig':
        return this.container.config;

      // Mutations with progress
      case 'createPR':
        return this.container.prService.createNew(params[0] as any, onProgress);
      case 'setupPR':
        return this.container.prService.setupExisting(params[0] as number, onProgress);
      case 'createFromBranch':
        return this.container.prService.createFromBranch(params[0] as any, onProgress);

      // Simple mutations
      case 'closePR':
        return this.container.prService.close(params[0] as number, onProgress);
      case 'mergePR':
        return this.container.github.mergePR(
          this.container.config.repoName,
          params[0] as number,
          params[1] as 'merge' | 'squash' | 'rebase',
        );
      case 'killSession':
        return this.container.tmux.kill(params[0] as string);
      case 'deleteClone':
        return this.container.fs.rmdir(params[0] as string, { recursive: true });
      case 'openTerminal':
        this.terminalManager.openTerminal(params[0] as string);
        return;
      case 'openInBrowser':
        await vscode.env.openExternal(vscode.Uri.parse(params[0] as string));
        return;
      case 'openFolder':
        await vscode.commands.executeCommand('vscode.openFolder',
          vscode.Uri.file(params[0] as string), { forceNewWindow: true });
        return;
      case 'refreshAll':
        this.container.invalidateCaches();
        return;

      default:
        throw new Error(`Unknown bridge method: ${method}`);
    }
  }

  // --------------------------------------------------------------------------
  // Outgoing messages
  // --------------------------------------------------------------------------

  private postResponse(id: string, result?: unknown, errorMessage?: string): void {
    const msg: HostResponse = { type: 'response', id };
    if (errorMessage) {
      msg.error = { message: errorMessage };
    } else {
      msg.result = result;
    }
    this.panel?.webview.postMessage(msg);
  }

  private postProgress(
    id: string,
    update: { step: string; current: number; total: number },
  ): void {
    const msg: HostProgress = { type: 'progress', id, update };
    this.panel?.webview.postMessage(msg);
  }

  private postEvent(name: 'dataChanged' | 'configChanged'): void {
    const msg: HostEvent = { type: 'event', name };
    this.panel?.webview.postMessage(msg);
  }

  // --------------------------------------------------------------------------
  // HTML generation
  // --------------------------------------------------------------------------

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'app.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'styles.css'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>MainframeHub</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
