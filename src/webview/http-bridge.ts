/**
 * HTTP bridge for browser access to the MfhBridge API.
 *
 * Uses fetch() to call the embedded HTTP server's REST endpoints.
 * VS Code-specific actions (openTerminal, openFolder) show a toast
 * since they require native VS Code APIs.
 */

import type {
  MfhBridge,
  ProgressUpdate,
  CreatePRResult,
} from './bridge';
import type { GroupedPRs, SessionState, ExtensionConfig } from '../interfaces';

export function createHttpBridge(): MfhBridge {
  const baseUrl = window.location.origin;

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    getGroupedPRs: () => get<GroupedPRs>('/api/grouped-prs'),
    getSessionStates: () => get<SessionState[]>('/api/session-states'),
    getConfig: () => get<ExtensionConfig>('/api/config'),

    // Progress callbacks are not supported in HTTP mode — browser shows inline status
    createPR: (params, _onProgress) => post<CreatePRResult>('/api/create-pr', params),
    setupPR: (prNumber, _onProgress) => post<CreatePRResult>('/api/setup-pr', { prNumber }),
    createFromBranch: (params, _onProgress) => post<CreatePRResult>('/api/create-from-branch', params),

    closePR: (prNumber) => post('/api/close-pr', { prNumber }).then(() => {}),
    mergePR: (prNumber, method) => post('/api/merge-pr', { prNumber, method }).then(() => {}),
    killSession: (sessionId) => post('/api/kill-session', { sessionId }).then(() => {}),
    deleteClone: (clonePath) => post('/api/delete-clone', { clonePath }).then(() => {}),
    refreshAll: () => post('/api/refresh', {}).then(() => {}),

    // VS Code-specific actions — not available in browser
    openTerminal: () => {},
    openInBrowser: (url) => { window.open(url, '_blank'); },
    openFolder: () => {},
  };
}
