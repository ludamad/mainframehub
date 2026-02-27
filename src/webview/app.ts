/**
 * MainframeHub webview dashboard.
 *
 * Tabs: MY PRs (grouped cards with contextual actions) | NEW PR (form).
 * Uses the MfhBridge for all data and mutations.
 * Toast notifications for action feedback.
 * Inline confirmation for destructive actions.
 */

import type { MfhBridge, ProgressUpdate, CreatePRResult } from './bridge';
import type { PRWithStatus, GroupedPRs, ExtensionConfig } from '../interfaces';
import { createPostMessageBridge } from './postmessage-bridge';
import { createHttpBridge } from './http-bridge';

// ============================================================================
// Context detection + bridge creation
// ============================================================================

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const isVSCode = typeof acquireVsCodeApi === 'function';

function createBridge(): MfhBridge {
  return isVSCode ? createPostMessageBridge() : createHttpBridge();
}

// ============================================================================
// State
// ============================================================================

const bridge = createBridge();
const app = document.getElementById('app')!;
let currentGrouped: GroupedPRs | null = null;
let currentConfig: ExtensionConfig | null = null;

// ============================================================================
// Toast notifications
// ============================================================================

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================================
// Main init
// ============================================================================

async function init(): Promise<void> {
  app.innerHTML = '<div class="loading">LOADING...</div>';

  try {
    const [grouped, config] = await Promise.all([
      bridge.getGroupedPRs(),
      bridge.getConfig(),
    ]);

    currentGrouped = grouped;
    currentConfig = config;
    renderDashboard(grouped, config);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    app.innerHTML = `<div class="error">Failed to load: ${escapeHtml(message)}</div>`;
  }
}

// ============================================================================
// Dashboard render
// ============================================================================

function renderDashboard(grouped: GroupedPRs, config: ExtensionConfig): void {
  const totalOpen =
    grouped.activeSession.length +
    grouped.hasClone.length +
    grouped.notSetUp.length;

  app.innerHTML = `
    <div class="dashboard">
      <div class="header">
        <h1>MAINFRAMEHUB</h1>
        <div class="header-actions">
          <button class="btn-icon" data-action="refreshAll" title="Refresh">&#x21bb;</button>
        </div>
      </div>
      <div class="tabs">
        <button class="tab active" data-tab="my-prs">MY PRs</button>
        <button class="tab" data-tab="new-pr">NEW PR</button>
      </div>

      <div class="tab-content" id="tab-my-prs">
        ${totalOpen === 0 && grouped.closedWithClone.length === 0
          ? renderEmptyState()
          : renderPRList(grouped)}
      </div>

      <div class="tab-content hidden" id="tab-new-pr">
        ${renderNewPRForm(config)}
      </div>
    </div>
  `;

  initTabs();
  initNewPRForm();
  initActionButtons();
}

// ============================================================================
// Empty state
// ============================================================================

function renderEmptyState(): string {
  return `
    <div class="empty">
      <div class="empty-icon">&#x25cb;</div>
      <div>No pull requests found.</div>
      <button class="btn-action" data-action="switchTab" data-tab="new-pr"
        style="margin-top:12px;">CREATE NEW PR</button>
    </div>
  `;
}

// ============================================================================
// PR list with groups
// ============================================================================

function renderPRList(grouped: GroupedPRs): string {
  const totalOpen =
    grouped.activeSession.length +
    grouped.hasClone.length +
    grouped.notSetUp.length;

  return `
    <div class="section-title">PULL REQUESTS (${totalOpen} open)</div>
    ${renderPRGroup('ACTIVE SESSIONS', grouped.activeSession, 'active')}
    ${renderPRGroup('HAS CLONE', grouped.hasClone, 'cloned')}
    ${renderPRGroup('NOT SET UP', grouped.notSetUp, 'remote')}
    ${grouped.closedWithClone.length > 0
      ? renderPRGroup('CLOSED WITH CLONE', grouped.closedWithClone, 'closed')
      : ''}
  `;
}

function renderPRGroup(title: string, prs: PRWithStatus[], groupType: string): string {
  if (prs.length === 0) return '';

  return `
    <div class="pr-group">
      <div class="group-title">${title} (${prs.length})</div>
      ${prs.map((prStatus) => renderPRCard(prStatus, groupType)).join('')}
    </div>
  `;
}

// ============================================================================
// PR card
// ============================================================================

function renderPRCard(prStatus: PRWithStatus, groupType: string): string {
  const pr = prStatus.pr;
  const sessionId = prStatus.sessionId;

  return `
    <div class="pr-card" data-pr-number="${pr.number}">
      <div class="pr-header">
        <span class="pr-number">#${pr.number}</span>
        <span class="pr-title">${escapeHtml(pr.title)}</span>
        ${pr.isDraft ? '<span class="badge draft">DRAFT</span>' : ''}
        ${pr.state === 'CLOSED' ? '<span class="badge closed">CLOSED</span>' : ''}
        ${pr.state === 'MERGED' ? '<span class="badge merged">MERGED</span>' : ''}
      </div>
      <div class="pr-meta">
        ${escapeHtml(pr.branch)} &#x2192; ${escapeHtml(pr.baseBranch)}
      </div>
      <div class="pr-actions">
        ${renderCardActions(prStatus, groupType)}
      </div>
    </div>
  `;
}

function renderCardActions(prStatus: PRWithStatus, groupType: string): string {
  const pr = prStatus.pr;
  const sessionId = prStatus.sessionId;
  const clonePath = prStatus.clonePath;

  switch (groupType) {
    case 'active':
      return `
        <button class="btn-action" data-action="openTerminal"
          data-session="${escapeAttr(sessionId)}"
          data-pr-number="${pr.number}" data-pr-title="${escapeAttr(pr.title)}">OPEN TERMINAL</button>
        <button class="btn-action secondary" data-action="initClaude"
          data-session="${escapeAttr(sessionId)}" data-pr-number="${pr.number}">INIT CLAUDE</button>
        <button class="btn-action secondary" data-action="openInBrowser"
          data-url="${escapeAttr(pr.url)}">GITHUB</button>
        <button class="btn-action danger" data-action="killSession"
          data-session="${escapeAttr(sessionId)}" data-pr-number="${pr.number}">KILL</button>
      `;

    case 'cloned':
      return `
        <button class="btn-action" data-action="setupPR"
          data-pr="${pr.number}">START SESSION</button>
        <button class="btn-action secondary" data-action="openFolder"
          data-path="${escapeAttr(clonePath ?? '')}">OPEN FOLDER</button>
        <button class="btn-action secondary" data-action="openInBrowser"
          data-url="${escapeAttr(pr.url)}">GITHUB</button>
        <button class="btn-action danger" data-action="deleteClone"
          data-path="${escapeAttr(clonePath ?? '')}" data-pr-number="${pr.number}">DELETE</button>
      `;

    case 'remote':
      return `
        <button class="btn-action" data-action="setupPR"
          data-pr="${pr.number}">SETUP + ATTACH</button>
        <button class="btn-action secondary" data-action="openInBrowser"
          data-url="${escapeAttr(pr.url)}">GITHUB</button>
      `;

    case 'closed':
      return `
        <button class="btn-action danger" data-action="deleteClone"
          data-path="${escapeAttr(clonePath ?? '')}" data-pr-number="${pr.number}">DELETE CLONE</button>
        <button class="btn-action secondary" data-action="openInBrowser"
          data-url="${escapeAttr(pr.url)}">GITHUB</button>
      `;

    default:
      return '';
  }
}

// ============================================================================
// New PR form
// ============================================================================

function renderNewPRForm(config: ExtensionConfig): string {
  return `
    <div class="section-title">CREATE NEW PR</div>
    <form id="new-pr-form">
      <div class="form-group">
        <label>TASK DESCRIPTION</label>
        <textarea id="pr-prompt" rows="4" required
          placeholder="Describe what this PR should do. Be specific: what to build, key requirements, and acceptance criteria."></textarea>
      </div>
      <div class="form-group">
        <label>BASE BRANCH</label>
        <div class="branch-presets">
          ${config.baseBranchPresets.map((b: string) =>
            `<button type="button" class="preset-btn" data-branch="${escapeAttr(b)}">${escapeHtml(b)}</button>`
          ).join('')}
        </div>
        <input type="text" id="base-branch" value="${escapeAttr(config.baseBranch)}" required>
      </div>
      <button type="submit" class="btn-primary" id="create-btn">CREATE PR + SESSION</button>
    </form>
    <div id="create-progress" class="progress-area hidden"></div>
  `;
}

function initNewPRForm(): void {
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const branch = (btn as HTMLElement).dataset.branch!;
      (document.getElementById('base-branch') as HTMLInputElement).value = branch;
    });
  });

  const form = document.getElementById('new-pr-form') as HTMLFormElement | null;
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = (document.getElementById('pr-prompt') as HTMLTextAreaElement).value;
    const baseBranch = (document.getElementById('base-branch') as HTMLInputElement).value;
    const progressEl = document.getElementById('create-progress')!;
    const submitBtn = document.getElementById('create-btn') as HTMLButtonElement;

    submitBtn.disabled = true;
    submitBtn.textContent = 'CREATING...';
    progressEl.classList.remove('hidden');
    progressEl.textContent = 'Starting...';

    try {
      const result: CreatePRResult = await bridge.createPR(
        { prompt, baseBranch },
        (update: ProgressUpdate) => {
          progressEl.textContent = `[${update.current}/${update.total}] ${update.step}`;
        },
      );

      progressEl.textContent = `PR #${result.pr.number} created: ${result.pr.title}`;
      showToast(`PR #${result.pr.number} created`, 'success');
      bridge.openTerminal(result.session.id);

      form.reset();
      setTimeout(() => init(), 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      progressEl.textContent = `Failed: ${message}`;
      showToast(`Failed to create PR: ${message}`, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'CREATE PR + SESSION';
    }
  });
}

// ============================================================================
// Tab switching
// ============================================================================

function initTabs(): void {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchToTab((tab as HTMLElement).dataset.tab!);
    });
  });
}

function switchToTab(tabName: string): void {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`)?.classList.add('active');
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.add('hidden');
  });
  const target = document.getElementById(`tab-${tabName}`);
  if (target) target.classList.remove('hidden');
}

// ============================================================================
// Action button handlers
// ============================================================================

function initActionButtons(): void {
  app.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;

    const action = btn.dataset.action!;

    switch (action) {
      case 'openTerminal':
        if (isVSCode) {
          bridge.openTerminal(btn.dataset.session!);
        } else {
          showToast('Terminal requires VS Code', 'info');
        }
        break;

      case 'openInBrowser':
        bridge.openInBrowser(btn.dataset.url!);
        break;

      case 'openFolder':
        if (isVSCode) {
          bridge.openFolder(btn.dataset.path!);
        } else {
          showToast('Open Folder requires VS Code', 'info');
        }
        break;

      case 'switchTab':
        switchToTab(btn.dataset.tab!);
        break;

      case 'refreshAll':
        await handleRefresh(btn);
        break;

      case 'setupPR':
        await handleSetupPR(btn);
        break;

      case 'initClaude':
        await handleInitClaude(btn);
        break;

      case 'killSession':
        await handleKillSession(btn);
        break;

      case 'deleteClone':
        await handleDeleteClone(btn);
        break;
    }
  });
}

// ============================================================================
// Action handlers
// ============================================================================

async function handleRefresh(btn: HTMLElement): Promise<void> {
  btn.classList.add('spinning');
  try {
    await bridge.refreshAll();
    await init();
    showToast('Refreshed', 'success');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(`Refresh failed: ${message}`, 'error');
  } finally {
    btn.classList.remove('spinning');
  }
}

async function handleSetupPR(btn: HTMLElement): Promise<void> {
  const prNumber = parseInt(btn.dataset.pr!, 10);
  const originalText = btn.textContent!;
  btn.textContent = 'Setting up...';
  btn.setAttribute('disabled', 'true');

  try {
    const result = await bridge.setupPR(prNumber, (update: ProgressUpdate) => {
      btn.textContent = `[${update.current}/${update.total}] ${update.step}`;
    });

    showToast(`PR #${prNumber} ready`, 'success');
    bridge.openTerminal(result.session.id);
    await init();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    btn.textContent = originalText;
    btn.removeAttribute('disabled');
    showToast(`Setup failed: ${message}`, 'error');
  }
}

async function handleInitClaude(btn: HTMLElement): Promise<void> {
  if (isVSCode) {
    bridge.openTerminal(btn.dataset.session!);
    showToast('Terminal opened — type your prompt to start Claude', 'info');
  } else {
    showToast('Terminal requires VS Code', 'info');
  }
}

async function handleKillSession(btn: HTMLElement): Promise<void> {
  const sessionId = btn.dataset.session!;
  const prNumber = btn.dataset.prNumber;

  // Inline confirmation
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = 'CONFIRM KILL?';
    setTimeout(() => {
      if (btn.classList.contains('confirming')) {
        btn.classList.remove('confirming');
        btn.textContent = 'KILL';
      }
    }, 3000);
    return;
  }

  btn.classList.remove('confirming');
  btn.textContent = 'KILLING...';
  btn.setAttribute('disabled', 'true');

  try {
    await bridge.killSession(sessionId);
    showToast(`Session killed${prNumber ? ` (PR #${prNumber})` : ''}`, 'success');
    await init();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    btn.textContent = 'KILL';
    btn.removeAttribute('disabled');
    showToast(`Kill failed: ${message}`, 'error');
  }
}

async function handleDeleteClone(btn: HTMLElement): Promise<void> {
  const clonePath = btn.dataset.path!;
  const prNumber = btn.dataset.prNumber;

  // Inline confirmation
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = 'CONFIRM DELETE?';
    setTimeout(() => {
      if (btn.classList.contains('confirming')) {
        btn.classList.remove('confirming');
        btn.textContent = btn.dataset.action === 'deleteClone' ? 'DELETE CLONE' : 'DELETE';
      }
    }, 3000);
    return;
  }

  btn.classList.remove('confirming');
  btn.textContent = 'DELETING...';
  btn.setAttribute('disabled', 'true');

  try {
    await bridge.deleteClone(clonePath);
    showToast(`Clone deleted${prNumber ? ` (PR #${prNumber})` : ''}`, 'success');
    await init();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    btn.textContent = 'DELETE';
    btn.removeAttribute('disabled');
    showToast(`Delete failed: ${message}`, 'error');
  }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// Listen for data change events from extension host
// ============================================================================

window.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type === 'event' && event.data.name === 'dataChanged') {
    init();
  }
});

// Go!
init();
