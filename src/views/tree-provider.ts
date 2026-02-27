/**
 * Tree data provider for the MainframeHub sidebar.
 *
 * Supports two modes:
 *   - "pr" (default): PRs grouped by status — Active Session, Has Clone,
 *     Not Set Up, Closed with Clone. Empty groups are skipped.
 *   - "session": tmux sessions grouped by Attached, Detached, Orphaned.
 *
 * Critical design:
 *   - getChildren reads from **cached** data (never from services directly).
 *   - refresh() fetches fresh data from services, stores in cache, then fires
 *     the change event. This avoids blocking the tree render on network calls.
 *   - resolveTreeItem builds tooltips lazily so the initial render is fast.
 */

import * as vscode from 'vscode';
import type { GroupedPRs, SessionState } from '../interfaces';
import {
  MfhTreeItem,
  GroupTreeItem,
  PRTreeItem,
  SessionTreeItem,
  buildPRTooltip,
  buildSessionTooltip,
} from './tree-items';

/**
 * Minimal interface for the service container.
 * The real container lives in '../container' and may not exist yet.
 */
export interface TreeServiceContainer {
  getGroupedPRs(): Promise<GroupedPRs>;
  getSessionStates(): Promise<SessionState[]>;
}

export class MfhTreeDataProvider
  implements vscode.TreeDataProvider<MfhTreeItem>, vscode.Disposable
{
  private mode: 'pr' | 'session' = 'pr';
  private cachedPRData: GroupedPRs | null = null;
  private cachedSessionData: SessionState[] | null = null;

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<MfhTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private container: TreeServiceContainer | null) {}

  // --------------------------------------------------------------------------
  // TreeDataProvider
  // --------------------------------------------------------------------------

  getTreeItem(element: MfhTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MfhTreeItem): MfhTreeItem[] {
    // Not configured — return empty so the welcome view shows
    if (!this.container) {
      return [];
    }

    // Second level: children of a group header
    if (element instanceof GroupTreeItem) {
      return element.children;
    }

    // Top level: build groups from cached data
    if (this.mode === 'pr') {
      return this.buildPRGroups();
    }
    return this.buildSessionGroups();
  }

  resolveTreeItem(
    item: MfhTreeItem,
    _element: MfhTreeItem,
    _token: vscode.CancellationToken,
  ): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (item instanceof PRTreeItem) {
      item.tooltip = buildPRTooltip(item.prStatus);
    } else if (item instanceof SessionTreeItem) {
      item.tooltip = buildSessionTooltip(item.sessionState);
    }
    return item;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Fetch fresh data from services, update cache, then notify the tree.
   */
  async refresh(): Promise<void> {
    if (!this.container) {
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    if (this.mode === 'pr') {
      this.cachedPRData = await this.container.getGroupedPRs();
    } else {
      this.cachedSessionData = await this.container.getSessionStates();
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Toggle between PR and Session view modes and refresh.
   */
  async toggleMode(): Promise<void> {
    this.mode = this.mode === 'pr' ? 'session' : 'pr';
    await this.refresh();
  }

  getMode(): 'pr' | 'session' {
    return this.mode;
  }

  /**
   * Replace the service container (e.g. after reconfiguration).
   */
  setContainer(container: TreeServiceContainer | null): void {
    this.container = container;
    this.cachedPRData = null;
    this.cachedSessionData = null;
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Return the cached PR data (useful for other components like status bar).
   */
  getCachedPRData(): GroupedPRs | null {
    return this.cachedPRData;
  }

  /**
   * Return the cached session data.
   */
  getCachedSessionData(): SessionState[] | null {
    return this.cachedSessionData;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  // --------------------------------------------------------------------------
  // Group builders
  // --------------------------------------------------------------------------

  private buildPRGroups(): MfhTreeItem[] {
    if (!this.cachedPRData) {
      return [];
    }

    const groups: GroupTreeItem[] = [];
    const data = this.cachedPRData;

    const activePRItems = data.activeSession.map((pr) => new PRTreeItem(pr));
    const clonePRItems = data.hasClone.map((pr) => new PRTreeItem(pr));
    const notSetUpPRItems = data.notSetUp.map((pr) => new PRTreeItem(pr));
    const closedPRItems = data.closedWithClone.map((pr) => new PRTreeItem(pr));

    if (activePRItems.length > 0) {
      groups.push(new GroupTreeItem('Active Sessions', activePRItems, true));
    }
    if (clonePRItems.length > 0) {
      groups.push(new GroupTreeItem('Has Clone', clonePRItems, true));
    }
    if (notSetUpPRItems.length > 0) {
      // Expand "Not Set Up" if it's the only non-empty group
      const isOnlyGroup =
        activePRItems.length === 0 &&
        clonePRItems.length === 0 &&
        closedPRItems.length === 0;
      groups.push(new GroupTreeItem('Not Set Up', notSetUpPRItems, isOnlyGroup));
    }
    if (closedPRItems.length > 0) {
      groups.push(new GroupTreeItem('Closed with Clone', closedPRItems, false));
    }

    return groups;
  }

  private buildSessionGroups(): MfhTreeItem[] {
    if (!this.cachedSessionData) {
      return [];
    }

    const attached: SessionTreeItem[] = [];
    const detached: SessionTreeItem[] = [];
    const orphaned: SessionTreeItem[] = [];

    for (const state of this.cachedSessionData) {
      const item = new SessionTreeItem(state);
      if (state.isActive) {
        attached.push(item);
      } else if (state.hasPR) {
        detached.push(item);
      } else {
        orphaned.push(item);
      }
    }

    const groups: GroupTreeItem[] = [];

    if (attached.length > 0) {
      groups.push(new GroupTreeItem('Attached', attached, true));
    }
    if (detached.length > 0) {
      groups.push(new GroupTreeItem('Detached', detached, true));
    }
    if (orphaned.length > 0) {
      groups.push(new GroupTreeItem('Orphaned', orphaned, false));
    }

    return groups;
  }
}
