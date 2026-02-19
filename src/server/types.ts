/**
 * Shared types for the HTTP server layer.
 *
 * These interfaces decouple the server from vscode types,
 * allowing both the embedded server (in VS Code) and the
 * standalone server (npm run web) to use the same code.
 */

import type { ExtensionConfig, GroupedPRs, SessionState } from '../interfaces';
import type { TmuxService } from '../services/tmux';
import type { GitHubService } from '../services/github';
import type { PRService } from '../services/pr-service';
import type { ClaudeHandoverService } from '../services/handover';

export interface ServerLogger {
  appendLine(line: string): void;
}

export interface ServerContainer {
  readonly config: ExtensionConfig;
  readonly tmux: TmuxService;
  readonly github: GitHubService;
  readonly prService: PRService;
  readonly handover: ClaudeHandoverService;

  readonly fs: {
    rmdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  };

  getGroupedPRs(): Promise<GroupedPRs>;
  getSessionStates(): Promise<SessionState[]>;
  invalidateCaches(): void;
}
