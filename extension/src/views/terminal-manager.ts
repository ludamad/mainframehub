/**
 * Terminal manager for MainframeHub.
 *
 * Manages VS Code integrated terminals that attach to tmux sessions.
 * Each tmux session maps to at most one VS Code terminal. The manager
 * tracks terminals by session ID and reuses them if still alive.
 *
 * Critical design:
 *   - shellPath is configurable (defaults to 'tmux', not a hardcoded path)
 *     so it works across different environments and PATH configurations.
 *   - Terminal liveness is checked via both exitStatus and presence in
 *     vscode.window.terminals — a terminal can be disposed without the
 *     close event firing in some edge cases.
 *   - dispose() cleans up the listener but does NOT close user terminals.
 */

import * as vscode from 'vscode';

const MAX_TERMINAL_NAME_LENGTH = 30;

export class TerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly closeListener: vscode.Disposable;

  constructor(private readonly tmuxPath: string = 'tmux') {
    this.closeListener = vscode.window.onDidCloseTerminal((closed) => {
      for (const [sessionId, terminal] of this.terminals) {
        if (terminal === closed) {
          this.terminals.delete(sessionId);
          break;
        }
      }
    });
  }

  /**
   * Open (or focus) a terminal attached to a tmux session.
   *
   * If a terminal for this session already exists and is still alive,
   * it is focused instead of creating a duplicate.
   */
  openTerminal(
    sessionId: string,
    prContext?: { prNumber: number; title: string },
  ): vscode.Terminal {
    const existing = this.terminals.get(sessionId);
    if (existing && this.isAlive(existing)) {
      existing.show();
      return existing;
    }

    // Clean up stale reference
    if (existing) {
      this.terminals.delete(sessionId);
    }

    const name = prContext
      ? truncateTerminalName(`MFH: PR #${prContext.prNumber} - ${prContext.title}`)
      : `MFH: ${sessionId}`;

    const terminal = vscode.window.createTerminal({
      name,
      shellPath: this.tmuxPath,
      shellArgs: ['attach-session', '-t', sessionId],
      isTransient: false,
    });

    this.terminals.set(sessionId, terminal);
    terminal.show();
    return terminal;
  }

  /**
   * Check whether a terminal is tracked for the given session ID.
   * Returns true only if the terminal is still alive.
   */
  hasTerminal(sessionId: string): boolean {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      return false;
    }
    if (!this.isAlive(terminal)) {
      this.terminals.delete(sessionId);
      return false;
    }
    return true;
  }

  /**
   * Count the number of active (alive) terminals managed by this instance.
   */
  getActiveCount(): number {
    let count = 0;
    for (const [sessionId, terminal] of this.terminals) {
      if (this.isAlive(terminal)) {
        count++;
      } else {
        this.terminals.delete(sessionId);
      }
    }
    return count;
  }

  /**
   * Dispose the close event listener.
   * Does NOT close user terminals — they belong to the user.
   */
  dispose(): void {
    this.closeListener.dispose();
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * A terminal is alive if it has no exitStatus AND is still present in
   * the VS Code terminal list.
   */
  private isAlive(terminal: vscode.Terminal): boolean {
    if (terminal.exitStatus !== undefined) {
      return false;
    }
    return vscode.window.terminals.includes(terminal);
  }
}

function truncateTerminalName(name: string): string {
  if (name.length <= MAX_TERMINAL_NAME_LENGTH) {
    return name;
  }
  return name.slice(0, MAX_TERMINAL_NAME_LENGTH - 1) + '\u2026';
}
