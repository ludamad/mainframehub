/**
 * Bridge types shared between the webview and the extension host.
 *
 * The MfhBridge interface is the single API the webview calls.
 * Two implementations exist:
 *   - PostMessageBridge (VS Code webview → extension host)
 *   - HttpBridge (browser → Express server)  [Stage 3]
 *
 * The postMessage protocol uses correlation IDs so multiple concurrent
 * operations can be in flight simultaneously.
 */

import type { GroupedPRs, SessionState, ExtensionConfig, PullRequest, TmuxSession } from '../interfaces';

// ============================================================================
// Progress
// ============================================================================

export interface ProgressUpdate {
  step: string;
  current: number;
  total: number;
}

// ============================================================================
// Results
// ============================================================================

export interface CreatePRResult {
  pr: Pick<PullRequest, 'number' | 'title' | 'url' | 'branch' | 'baseBranch'>;
  session: Pick<TmuxSession, 'id' | 'workingDir'>;
  clonePath: string;
}

// ============================================================================
// MfhBridge — the single interface the webview calls
// ============================================================================

export interface MfhBridge {
  // Queries
  getGroupedPRs(): Promise<GroupedPRs>;
  getSessionStates(): Promise<SessionState[]>;
  getConfig(): Promise<ExtensionConfig>;

  // Mutations with progress
  createPR(
    params: { prompt: string; baseBranch: string },
    onProgress?: (update: ProgressUpdate) => void,
  ): Promise<CreatePRResult>;
  setupPR(
    prNumber: number,
    onProgress?: (update: ProgressUpdate) => void,
  ): Promise<CreatePRResult>;
  createFromBranch(
    params: { branch: string; title: string; baseBranch: string },
    onProgress?: (update: ProgressUpdate) => void,
  ): Promise<CreatePRResult>;

  // Simple mutations
  closePR(prNumber: number): Promise<void>;
  mergePR(prNumber: number, method: 'merge' | 'squash' | 'rebase'): Promise<void>;
  killSession(sessionId: string): Promise<void>;
  deleteClone(clonePath: string): Promise<void>;
  openTerminal(sessionId: string): void;
  openInBrowser(url: string): void;
  openFolder(folderPath: string): void;
  refreshAll(): Promise<void>;
}

// ============================================================================
// postMessage protocol
// ============================================================================

/** Webview → Extension Host */
export interface WebviewRequest {
  type: 'request';
  id: string;
  method: keyof MfhBridge;
  params: unknown[];
}

/** Extension Host → Webview */
export type HostMessage = HostResponse | HostProgress | HostEvent;

export interface HostResponse {
  type: 'response';
  id: string;
  result?: unknown;
  error?: { message: string };
}

export interface HostProgress {
  type: 'progress';
  id: string;
  update: ProgressUpdate;
}

export interface HostEvent {
  type: 'event';
  name: 'dataChanged' | 'configChanged';
}
