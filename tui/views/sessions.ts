/**
 * Sessions View - Shows all tmux sessions with PR associations
 */

import blessed from 'blessed';
import type { TUIServices } from '../app.js';
import type { MainframeHubTUI } from '../app.js';
import type { Loader } from '../components/loader.js';

export class SessionsView {
  private container: blessed.Widgets.BoxElement;
  private services: TUIServices;
  private app: MainframeHubTUI;
  private list: blessed.Widgets.ListElement;
  private sessions: any[] = [];

  constructor(container: blessed.Widgets.BoxElement, services: TUIServices, app: MainframeHubTUI, loader?: Loader) {
    this.container = container;
    this.services = services;
    this.app = app;

    // Create list widget
    this.list = blessed.list({
      parent: container,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      keys: true,
      mouse: true,
      vi: true,
      scrollbar: {
        ch: '█',
        style: {
          fg: 'cyan',
        },
      },
      style: {
        selected: {
          bg: 'cyan',
          fg: 'black',
          bold: true,
        },
        item: {
          fg: 'white',
        },
      },
      border: {
        type: 'line',
      },
      label: ' Sessions ',
    });

    // Handle selection
    this.list.on('select', (item: any, index: number) => {
      const session = this.sessions[index];
      if (session) {
        this.app.openTerminal(session.sessionId);
      }
    });

    this.loadSessions(loader);
  }

  private async loadSessions(loader?: Loader) {
    try {
      if (loader) {
        loader.updateMessage('Loading sessions...');
      }
      this.app.setStatus('Loading sessions...');

      const states = await this.services.discovery.discover();
      this.sessions = states;

      const items = states.map((state) => {
        const displayName = state.pr ? state.pr.title : state.session.id;
        const statusIcon = state.isActive ? '●' : '○';
        const prInfo = state.pr
          ? ` PR #${state.pr.number} • ${state.pr.branch} → ${state.pr.baseBranch}`
          : ' No PR associated';

        return `${statusIcon} ${displayName}${prInfo}`;
      });

      if (items.length === 0) {
        items.push('No sessions found. Create a new PR from the NEW PR tab.');
      }

      // Destroy loader before showing content
      if (loader) {
        loader.destroy();
      }

      this.list.setItems(items);
      this.list.focus();
      this.app.setStatus(`${states.length} session(s) found. Press Enter to attach.`, 'success');
      this.app.getScreen().render();
    } catch (error: any) {
      if (loader) {
        loader.destroy();
      }
      this.app.setStatus(`Error loading sessions: ${error.message}`, 'error');
    }
  }

  public destroy() {
    this.list.destroy();
  }
}
