/**
 * PostMessage bridge for the VS Code webview context.
 *
 * Uses acquireVsCodeApi() to communicate with the extension host.
 * Each call gets a correlation ID so multiple operations can be
 * in flight concurrently. Progress updates for long-running ops
 * (createPR, setupPR, createFromBranch) stream back on the same ID.
 */

import type {
  MfhBridge,
  ProgressUpdate,
  HostMessage,
  WebviewRequest,
} from './bridge';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const PROGRESS_METHODS = new Set<keyof MfhBridge>([
  'createPR',
  'setupPR',
  'createFromBranch',
]);

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (update: ProgressUpdate) => void;
}

export function createPostMessageBridge(): MfhBridge {
  const vscode = acquireVsCodeApi();
  const pending = new Map<string, PendingRequest>();

  window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
    const msg = event.data;

    if (msg.type === 'response') {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new Error(msg.error.message));
      } else {
        entry.resolve(msg.result);
      }
    }

    if (msg.type === 'progress') {
      pending.get(msg.id)?.onProgress?.(msg.update);
    }
  });

  function call<T>(
    method: keyof MfhBridge,
    params: unknown[],
    onProgress?: (update: ProgressUpdate) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });

      const request: WebviewRequest = { type: 'request', id, method, params };
      vscode.postMessage(request);

      const timeout = PROGRESS_METHODS.has(method) ? 300_000 : 30_000;
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, timeout);
    });
  }

  return {
    getGroupedPRs: () => call('getGroupedPRs', []),
    getSessionStates: () => call('getSessionStates', []),
    getConfig: () => call('getConfig', []),

    createPR: (params, onProgress) => call('createPR', [params], onProgress),
    setupPR: (prNumber, onProgress) => call('setupPR', [prNumber], onProgress),
    createFromBranch: (params, onProgress) => call('createFromBranch', [params], onProgress),

    closePR: (prNumber) => call('closePR', [prNumber]),
    mergePR: (prNumber, method) => call('mergePR', [prNumber, method]),
    killSession: (sessionId) => call('killSession', [sessionId]),
    deleteClone: (clonePath) => call('deleteClone', [clonePath]),
    refreshAll: () => call('refreshAll', []),

    openTerminal: (sessionId) => {
      vscode.postMessage({ type: 'request', id: crypto.randomUUID(), method: 'openTerminal', params: [sessionId] });
    },
    openInBrowser: (url) => {
      vscode.postMessage({ type: 'request', id: crypto.randomUUID(), method: 'openInBrowser', params: [url] });
    },
    openFolder: (folderPath) => {
      vscode.postMessage({ type: 'request', id: crypto.randomUUID(), method: 'openFolder', params: [folderPath] });
    },
  };
}
