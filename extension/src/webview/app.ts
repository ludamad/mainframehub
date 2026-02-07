/**
 * Main entry point for the MainframeHub webview.
 *
 * Detects the runtime context (VS Code webview vs browser),
 * creates the appropriate bridge, and renders the dashboard UI.
 *
 * Stage 1: minimal skeleton that proves the bridge works.
 * Stage 2: full tab-based UI with PR cards, clones, branches, new PR form.
 */

import type { MfhBridge, ProgressUpdate } from './bridge';
import { createPostMessageBridge } from './postmessage-bridge';

// ============================================================================
// Context detection + bridge creation
// ============================================================================

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

function createBridge(): MfhBridge {
  if (typeof acquireVsCodeApi === 'function') {
    return createPostMessageBridge();
  }
  // Stage 3: return createHttpBridge() for browser context
  throw new Error('Browser bridge not implemented yet');
}

// ============================================================================
// App initialization
// ============================================================================

const bridge = createBridge();
const app = document.getElementById('app')!;

async function init(): Promise<void> {
  app.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const [grouped, config] = await Promise.all([
      bridge.getGroupedPRs(),
      bridge.getConfig(),
    ]);

    const totalPRs =
      grouped.activeSession.length +
      grouped.hasClone.length +
      grouped.notSetUp.length;

    app.innerHTML = `
      <div class="dashboard">
        <div class="header">
          <h1>MAINFRAMEHUB</h1>
          <div class="status">READY</div>
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="my-prs">MY PRs</button>
          <button class="tab" data-tab="new-pr">NEW PR</button>
        </div>
        <div class="tab-content active" id="tab-my-prs">
          <div class="section-title">MY PULL REQUESTS (${totalPRs})</div>
          ${renderPRGroup('ACTIVE SESSIONS', grouped.activeSession)}
          ${renderPRGroup('HAS CLONE', grouped.hasClone)}
          ${renderPRGroup('NOT SET UP', grouped.notSetUp)}
          ${grouped.closedWithClone.length > 0
            ? renderPRGroup('CLOSED WITH CLONE', grouped.closedWithClone)
            : ''}
          ${totalPRs === 0 ? '<div class="empty">No pull requests found.</div>' : ''}
        </div>
        <div class="tab-content" id="tab-new-pr" style="display:none;">
          <div class="section-title">CREATE NEW PR</div>
          <form id="new-pr-form">
            <div class="form-group">
              <label>TASK DESCRIPTION</label>
              <textarea id="pr-prompt" rows="4" required
                placeholder="Describe what this PR should do"></textarea>
            </div>
            <div class="form-group">
              <label>BASE BRANCH</label>
              <div class="branch-presets">
                ${config.baseBranchPresets.map((b: string) =>
                  `<button type="button" class="preset-btn" data-branch="${b}">${b}</button>`
                ).join('')}
              </div>
              <input type="text" id="base-branch" value="${config.baseBranch}" required>
            </div>
            <button type="submit" class="btn-primary">CREATE PR + SESSION</button>
          </form>
          <div id="create-progress" style="display:none;"></div>
        </div>
      </div>
    `;

    initTabs();
    initNewPRForm();
    initActionButtons();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    app.innerHTML = `<div class="error">Failed to load: ${message}</div>`;
  }
}

// ============================================================================
// Tab switching
// ============================================================================

function initTabs(): void {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = (tab as HTMLElement).dataset.tab!;
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-content').forEach((c) => {
        (c as HTMLElement).style.display = 'none';
      });
      const target = document.getElementById(`tab-${tabName}`);
      if (target) target.style.display = 'block';
    });
  });
}

// ============================================================================
// PR rendering
// ============================================================================

function renderPRGroup(title: string, prs: any[]): string {
  if (prs.length === 0) return '';

  return `
    <div class="pr-group">
      <div class="group-title">${title} (${prs.length})</div>
      ${prs.map((prStatus: any) => renderPRCard(prStatus)).join('')}
    </div>
  `;
}

function renderPRCard(prStatus: any): string {
  const pr = prStatus.pr;
  const hasSession = prStatus.hasSession;
  const hasClone = prStatus.hasClone;

  return `
    <div class="pr-card" data-pr-number="${pr.number}">
      <div class="pr-header">
        <span class="pr-number">#${pr.number}</span>
        <span class="pr-title">${escapeHtml(pr.title)}</span>
        ${pr.isDraft ? '<span class="badge draft">DRAFT</span>' : ''}
      </div>
      <div class="pr-meta">
        ${escapeHtml(pr.branch)} → ${escapeHtml(pr.baseBranch)}
      </div>
      <div class="pr-actions">
        ${hasSession
          ? `<button class="btn-action" data-action="openTerminal" data-session="${prStatus.sessionId}">OPEN TERMINAL</button>`
          : hasClone
            ? `<button class="btn-action" data-action="setupPR" data-pr="${pr.number}">START SESSION</button>`
            : `<button class="btn-action" data-action="setupPR" data-pr="${pr.number}">SETUP + ATTACH</button>`
        }
        <button class="btn-action secondary" data-action="openInBrowser" data-url="${escapeHtml(pr.url)}">GITHUB</button>
      </div>
    </div>
  `;
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
        bridge.openTerminal(btn.dataset.session!);
        break;
      case 'openInBrowser':
        bridge.openInBrowser(btn.dataset.url!);
        break;
      case 'setupPR': {
        const prNumber = parseInt(btn.dataset.pr!, 10);
        btn.textContent = 'Setting up...';
        btn.setAttribute('disabled', 'true');
        try {
          await bridge.setupPR(prNumber, (update: ProgressUpdate) => {
            btn.textContent = `[${update.current}/${update.total}] ${update.step}`;
          });
          await init(); // Reload dashboard
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          btn.textContent = `Failed: ${message}`;
          btn.removeAttribute('disabled');
        }
        break;
      }
    }
  });
}

// ============================================================================
// New PR form
// ============================================================================

function initNewPRForm(): void {
  // Branch preset buttons
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
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
    progressEl.style.display = 'block';

    try {
      const result = await bridge.createPR({ prompt, baseBranch }, (update: ProgressUpdate) => {
        progressEl.textContent = `[${update.current}/${update.total}] ${update.step}`;
      });

      progressEl.textContent = `PR #${result.pr.number} created: ${result.pr.title}`;
      bridge.openTerminal(result.session.id);

      // Reset form and reload
      form.reset();
      setTimeout(() => init(), 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      progressEl.textContent = `Failed: ${message}`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'CREATE PR + SESSION';
    }
  });
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
