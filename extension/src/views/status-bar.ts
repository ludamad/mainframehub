/**
 * Status bar manager for MainframeHub.
 *
 * Shows a persistent status bar item with:
 *   - Active session count: "$(terminal) 3 PRs active"
 *   - Not configured state:  "$(circle-slash) MFH: not configured"
 *   - Refreshing state:      "$(sync~spin) MFH: refreshing..."
 *
 * Clicking the status bar item triggers the mfh.openPR quick pick command.
 */

import * as vscode from 'vscode';

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private isConfigured = false;
  private isRefreshing = false;
  private activeCount = 0;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.item.command = 'mfh.openPR';
    this.render();
    this.item.show();
  }

  /**
   * Update the configured state. When not configured, the status bar
   * shows a warning icon and disables the click command.
   */
  setConfigured(configured: boolean): void {
    this.isConfigured = configured;
    this.render();
  }

  /**
   * Update the active session count displayed in the status bar.
   */
  setActiveCount(count: number): void {
    this.activeCount = count;
    this.render();
  }

  /**
   * Show a spinning refresh indicator. Call setRefreshing(false) when done.
   */
  setRefreshing(refreshing: boolean): void {
    this.isRefreshing = refreshing;
    this.render();
  }

  startSpin(): void {
    this.setRefreshing(true);
  }

  stopSpin(): void {
    this.setRefreshing(false);
  }

  dispose(): void {
    this.item.dispose();
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private render(): void {
    if (this.isRefreshing) {
      this.item.text = '$(sync~spin) MFH: refreshing\u2026';
      this.item.tooltip = 'MainframeHub is refreshing session data';
      this.item.command = 'mfh.openPR';
      return;
    }

    if (!this.isConfigured) {
      this.item.text = '$(circle-slash) MFH: not configured';
      this.item.tooltip = 'MainframeHub is not configured. Click to open settings.';
      this.item.command = 'workbench.action.openSettings';
      return;
    }

    if (this.activeCount === 0) {
      this.item.text = '$(terminal) MFH: no active PRs';
      this.item.tooltip = 'MainframeHub \u2014 no active sessions. Click to open PR list.';
    } else if (this.activeCount === 1) {
      this.item.text = '$(terminal) 1 PR active';
      this.item.tooltip = 'MainframeHub \u2014 1 active session. Click to open PR list.';
    } else {
      this.item.text = `$(terminal) ${this.activeCount} PRs active`;
      this.item.tooltip = `MainframeHub \u2014 ${this.activeCount} active sessions. Click to open PR list.`;
    }
    this.item.command = 'mfh.openPR';
  }
}
