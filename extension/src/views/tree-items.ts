/**
 * Tree item classes and helper functions for the MainframeHub sidebar.
 *
 * Every tree item sets a stable `this.id` so VS Code can track identity
 * across refreshes (preserving expand/collapse state and selection).
 *
 * Tooltips are NOT built in constructors — they are built lazily via
 * `resolveTreeItem` in the tree data provider to avoid blocking the UI
 * thread with expensive markdown rendering on every refresh.
 */

import * as vscode from 'vscode';
import type { PRWithStatus, SessionState } from '../interfaces';

const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;

// ============================================================================
// Base class
// ============================================================================

export class MfhTreeItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
  }
}

// ============================================================================
// Group header
// ============================================================================

export class GroupTreeItem extends MfhTreeItem {
  public readonly children: MfhTreeItem[];

  constructor(
    public readonly baseLabel: string,
    children: MfhTreeItem[],
    expanded = true,
  ) {
    super(`${baseLabel} (${children.length})`, expanded ? Expanded : Collapsed);
    this.id = 'group-' + baseLabel; // Stable ID — count excluded
    this.children = children;
  }
}

// ============================================================================
// PR tree item
// ============================================================================

export class PRTreeItem extends MfhTreeItem {
  constructor(public readonly prStatus: PRWithStatus) {
    super(truncateLabel(`#${prStatus.pr.number} ${prStatus.pr.title}`), None);
    this.id = 'pr-' + prStatus.pr.number;
    this.description = buildPRDescription(prStatus);
    this.contextValue = buildPRContextValue(prStatus);
    this.iconPath = buildPRIcon(prStatus);
    // Tooltip built lazily in resolveTreeItem
    if (prStatus.hasSession) {
      this.command = {
        command: 'mfh.resumeSession',
        title: 'Open Terminal',
        arguments: [prStatus],
      };
    }
  }
}

// ============================================================================
// Session tree item
// ============================================================================

export class SessionTreeItem extends MfhTreeItem {
  constructor(public readonly sessionState: SessionState) {
    const label = sessionState.hasPR
      ? truncateLabel(`#${sessionState.pr!.number} ${sessionState.pr!.title}`)
      : sessionState.session.id;
    super(label, None);
    this.id = 'session-' + sessionState.session.id;
    this.description = buildSessionDescription(sessionState);
    this.contextValue = buildSessionContextValue(sessionState);
    this.iconPath = buildSessionIcon(sessionState);
    this.command = {
      command: 'mfh.resumeSession',
      title: 'Open Terminal',
      arguments: [sessionState],
    };
  }
}

// ============================================================================
// Label helpers
// ============================================================================

const DEFAULT_MAX_LABEL = 40;

export function truncateLabel(text: string, maxLength = DEFAULT_MAX_LABEL): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + '\u2026'; // ellipsis
}

// ============================================================================
// PR helpers
// ============================================================================

export function buildPRDescription(pr: PRWithStatus): string {
  const parts: string[] = [];
  parts.push(`${pr.pr.branch} \u2192 ${pr.pr.baseBranch}`);
  if (pr.pr.isDraft) {
    parts.push('DRAFT');
  }
  if (pr.pr.state === 'CLOSED' || pr.pr.state === 'MERGED') {
    parts.push(pr.pr.state);
  }
  return parts.join(' \u00b7 ');
}

export function buildPRContextValue(pr: PRWithStatus): string {
  const closed = pr.pr.state === 'CLOSED' || pr.pr.state === 'MERGED';
  const draft = pr.pr.isDraft;

  if (closed && draft && pr.hasClone) {
    return 'prDraftClosed';
  }
  if (closed && pr.hasClone) {
    return 'prClosed';
  }
  if (closed) {
    return 'prClosedNoClone';
  }
  if (pr.hasSession) {
    return draft ? 'prDraftWithSession' : 'prWithSession';
  }
  if (pr.hasClone) {
    return draft ? 'prDraftWithClone' : 'prWithClone';
  }
  return draft ? 'prDraftNotSetUp' : 'prNotSetUp';
}

export function buildPRIcon(pr: PRWithStatus): vscode.ThemeIcon {
  const closed = pr.pr.state === 'CLOSED' || pr.pr.state === 'MERGED';
  const draft = pr.pr.isDraft;

  if (closed) {
    return new vscode.ThemeIcon(
      'archive',
      draft ? new vscode.ThemeColor('charts.yellow') : undefined,
    );
  }
  if (pr.hasSession) {
    return new vscode.ThemeIcon(
      'terminal',
      draft ? new vscode.ThemeColor('charts.yellow') : undefined,
    );
  }
  if (pr.hasClone) {
    return new vscode.ThemeIcon(
      'folder',
      draft ? new vscode.ThemeColor('charts.yellow') : undefined,
    );
  }
  return new vscode.ThemeIcon(
    'cloud',
    draft ? new vscode.ThemeColor('charts.yellow') : undefined,
  );
}

export function buildPRTooltip(pr: PRWithStatus): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
  md.isTrusted = true;
  md.supportHtml = true;

  md.appendMarkdown(`**#${pr.pr.number}: ${escapeMarkdown(pr.pr.title)}**\n\n`);

  md.appendMarkdown('| | |\n|---|---|\n');
  md.appendMarkdown(`| Branch | \`${pr.pr.branch}\` \u2192 \`${pr.pr.baseBranch}\` |\n`);
  md.appendMarkdown(`| Author | ${escapeMarkdown(pr.pr.author)} |\n`);
  md.appendMarkdown(`| State | ${pr.pr.state}${pr.pr.isDraft ? ' (Draft)' : ''} |\n`);

  if (pr.hasSession) {
    md.appendMarkdown(`| Session | \`${pr.sessionId}\` (active) |\n`);
  } else if (pr.hasClone) {
    md.appendMarkdown(`| Clone | \`${pr.clonePath}\` |\n`);
  } else {
    md.appendMarkdown('| Status | Not set up locally |\n');
  }

  if (pr.ciStatus && pr.ciStatus !== 'unknown') {
    const ciLabel = pr.ciStatus === 'passing' ? 'Passing' : pr.ciStatus === 'failing' ? 'Failing' : 'Pending';
    md.appendMarkdown(`| CI | ${ciLabel} |\n`);
  }

  md.appendMarkdown(`| Created | ${getRelativeTime(pr.pr.created)} |\n`);
  md.appendMarkdown(`| Updated | ${getRelativeTime(pr.pr.updated)} |\n`);

  return md;
}

// ============================================================================
// Session helpers
// ============================================================================

export function buildSessionDescription(state: SessionState): string {
  const parts: string[] = [];
  if (state.hasGit && state.gitInfo) {
    parts.push(state.gitInfo.branch);
  }
  parts.push(state.isActive ? 'attached' : 'detached');
  return parts.join(' \u00b7 ');
}

export function buildSessionContextValue(state: SessionState): string {
  if (!state.hasGit) {
    return 'sessionNoGit';
  }
  if (!state.hasPR) {
    return 'sessionOrphan';
  }
  return state.isActive ? 'sessionAttached' : 'sessionDetached';
}

export function buildSessionIcon(state: SessionState): vscode.ThemeIcon {
  if (!state.hasGit) {
    return new vscode.ThemeIcon('question');
  }
  if (state.isActive) {
    return new vscode.ThemeIcon('terminal');
  }
  if (!state.hasPR) {
    return new vscode.ThemeIcon('git-branch');
  }
  return new vscode.ThemeIcon('debug-pause');
}

export function buildSessionTooltip(state: SessionState): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
  md.isTrusted = true;
  md.supportHtml = true;

  const title = state.hasPR
    ? `#${state.pr!.number}: ${escapeMarkdown(state.pr!.title)}`
    : `Session: ${state.session.id}`;
  md.appendMarkdown(`**${title}**\n\n`);

  md.appendMarkdown('| | |\n|---|---|\n');
  md.appendMarkdown(`| Session ID | \`${state.session.id}\` |\n`);
  md.appendMarkdown(`| Status | ${state.isActive ? 'Attached' : 'Detached'} |\n`);
  md.appendMarkdown(`| Working Dir | \`${state.session.workingDir}\` |\n`);

  if (state.hasGit && state.gitInfo) {
    md.appendMarkdown(`| Branch | \`${state.gitInfo.branch}\` |\n`);
    if (state.gitInfo.isDirty) {
      md.appendMarkdown('| Git | Uncommitted changes |\n');
    }
    if (state.gitInfo.ahead > 0 || state.gitInfo.behind > 0) {
      md.appendMarkdown(`| Sync | ${state.gitInfo.ahead} ahead, ${state.gitInfo.behind} behind |\n`);
    }
  } else {
    md.appendMarkdown('| Git | Not a git repository |\n');
  }

  if (state.hasPR) {
    md.appendMarkdown(`| PR | [#${state.pr!.number}](${state.pr!.url}) |\n`);
  }

  md.appendMarkdown(`| Created | ${getRelativeTime(state.session.created)} |\n`);

  return md;
}

// ============================================================================
// Relative time
// ============================================================================

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function getRelativeTime(date: Date): string {
  const now = Date.now();
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diff = now - then;

  if (diff < MINUTE) {
    return 'just now';
  }
  if (diff < HOUR) {
    const mins = Math.floor(diff / MINUTE);
    return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  const days = Math.floor(diff / DAY);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// ============================================================================
// Markdown escaping
// ============================================================================

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');
}
