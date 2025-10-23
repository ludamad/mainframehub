/**
 * Terminal View - Direct tmux attachment (no WebSocket!)
 *
 * This directly attaches to a tmux session using native process spawning.
 * Much simpler and more reliable than WebSocket forwarding.
 */

import blessed from 'blessed';
import { spawn } from 'child_process';
import type { TUIServices } from '../app.js';
import type { MainframeHubTUI } from '../app.js';

export class TerminalView {
  private container: blessed.Widgets.BoxElement;
  private services: TUIServices;
  private app: MainframeHubTUI;
  private sessionId: string;
  private terminal: blessed.Widgets.BoxElement | null = null;
  private tmuxProcess: any = null;

  constructor(
    container: blessed.Widgets.BoxElement,
    services: TUIServices,
    app: MainframeHubTUI,
    sessionId: string
  ) {
    this.container = container;
    this.services = services;
    this.app = app;
    this.sessionId = sessionId;

    this.attach();
  }

  private async attach() {
    try {
      // Check if session exists
      const session = await this.services.tmux.get(this.sessionId);
      if (!session) {
        this.app.setStatus(`Session ${this.sessionId} not found`, 'error');
        setTimeout(() => {
          this.detach();
          this.app.switchTab('sessions');
        }, 2000);
        return;
      }

      // Hide the TUI and directly attach to tmux
      // This gives full native tmux experience!
      this.container.hide();
      this.app.getScreen().program.showCursor();
      this.app.getScreen().program.normalBuffer();

      // Spawn tmux attach process
      this.tmuxProcess = spawn('tmux', ['attach-session', '-t', this.sessionId], {
        stdio: 'inherit',
        detached: false,
      });

      this.tmuxProcess.on('exit', (code: number) => {
        // When user detaches from tmux, return to TUI
        this.app.getScreen().program.alternateBuffer();
        this.app.getScreen().program.hideCursor();
        this.container.show();
        this.app.getScreen().render();
        this.app.switchTab('sessions');
      });

      this.tmuxProcess.on('error', (error: Error) => {
        this.app.setStatus(`Error attaching to session: ${error.message}`, 'error');
        this.detach();
        this.app.switchTab('sessions');
      });
    } catch (error: any) {
      this.app.setStatus(`Error: ${error.message}`, 'error');
      this.detach();
      this.app.switchTab('sessions');
    }
  }

  public detach() {
    if (this.tmuxProcess) {
      this.tmuxProcess.kill();
      this.tmuxProcess = null;
    }

    if (this.terminal) {
      this.terminal.destroy();
      this.terminal = null;
    }

    // Restore TUI
    this.app.getScreen().program.alternateBuffer();
    this.app.getScreen().program.hideCursor();
    this.container.show();
    this.app.getScreen().render();
  }

  public destroy() {
    this.detach();
  }
}
