/**
 * File decoration provider for MainframeHub tree items.
 *
 * Provides CI status and draft badges on PR tree items using the
 * 'mfh-pr' URI scheme. The tree view must set resourceUri on items
 * with the scheme `mfh-pr:<pr-number>` for decorations to appear.
 *
 * Badges:
 *   - Green checkmark for passing CI
 *   - Red exclamation for failing CI
 *   - Yellow "D" for draft PRs
 *   - Orange "P" for pending CI
 *
 * Decoration data is stored in a map keyed by PR number and updated
 * externally via the updatePR() method, which fires the change event
 * to trigger a re-render.
 */

import * as vscode from 'vscode';

export interface PRDecorationData {
  ciStatus?: 'pending' | 'passing' | 'failing' | 'unknown';
  isDraft?: boolean;
}

const MFH_PR_SCHEME = 'mfh-pr';

export class MfhDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private readonly decorations = new Map<number, PRDecorationData>();
  private readonly registration: vscode.Disposable;

  constructor() {
    this.registration = vscode.window.registerFileDecorationProvider(this);
  }

  // --------------------------------------------------------------------------
  // FileDecorationProvider
  // --------------------------------------------------------------------------

  provideFileDecoration(
    uri: vscode.Uri,
    _token: vscode.CancellationToken,
  ): vscode.FileDecoration | undefined {
    if (uri.scheme !== MFH_PR_SCHEME) {
      return undefined;
    }

    const prNumber = parseInt(uri.authority, 10);
    if (isNaN(prNumber)) {
      return undefined;
    }

    const data = this.decorations.get(prNumber);
    if (!data) {
      return undefined;
    }

    // CI status takes priority over draft badge
    if (data.ciStatus === 'failing') {
      return new vscode.FileDecoration(
        '!',
        'CI failing',
        new vscode.ThemeColor('testing.iconFailed'),
      );
    }
    if (data.ciStatus === 'passing') {
      return new vscode.FileDecoration(
        '\u2713',
        'CI passing',
        new vscode.ThemeColor('testing.iconPassed'),
      );
    }
    if (data.ciStatus === 'pending') {
      return new vscode.FileDecoration(
        'P',
        'CI pending',
        new vscode.ThemeColor('charts.orange'),
      );
    }

    // Draft badge only if no CI status to show
    if (data.isDraft) {
      return new vscode.FileDecoration(
        'D',
        'Draft PR',
        new vscode.ThemeColor('charts.yellow'),
      );
    }

    return undefined;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Update decoration data for a PR and notify the tree to re-render.
   */
  updatePR(prNumber: number, data: PRDecorationData): void {
    this.decorations.set(prNumber, data);
    this._onDidChangeFileDecorations.fire(
      vscode.Uri.parse(`${MFH_PR_SCHEME}://${prNumber}`),
    );
  }

  /**
   * Bulk-update multiple PRs at once. Fires a single change event.
   */
  updateAll(entries: Array<{ prNumber: number; data: PRDecorationData }>): void {
    const uris: vscode.Uri[] = [];
    for (const entry of entries) {
      this.decorations.set(entry.prNumber, entry.data);
      uris.push(vscode.Uri.parse(`${MFH_PR_SCHEME}://${entry.prNumber}`));
    }
    if (uris.length > 0) {
      this._onDidChangeFileDecorations.fire(uris);
    }
  }

  /**
   * Remove decoration data for a PR.
   */
  removePR(prNumber: number): void {
    if (this.decorations.delete(prNumber)) {
      this._onDidChangeFileDecorations.fire(
        vscode.Uri.parse(`${MFH_PR_SCHEME}://${prNumber}`),
      );
    }
  }

  /**
   * Clear all stored decoration data.
   */
  clear(): void {
    this.decorations.clear();
    this._onDidChangeFileDecorations.fire(undefined);
  }

  /**
   * Build the resource URI for a PR number.
   * Tree items should set `this.resourceUri` to this value for decorations
   * to be applied.
   */
  static uri(prNumber: number): vscode.Uri {
    return vscode.Uri.parse(`${MFH_PR_SCHEME}://${prNumber}`);
  }

  dispose(): void {
    this.registration.dispose();
    this._onDidChangeFileDecorations.dispose();
  }
}
