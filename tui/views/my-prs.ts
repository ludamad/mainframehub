/**
 * My PRs View - Shows user's open PRs with clone/session status
 */

import blessed from 'blessed';
import { execSync } from 'child_process';
import type { TUIServices } from '../app.js';
import type { MainframeHubTUI } from '../app.js';
import type { Loader } from '../components/loader.js';

export class MyPRsView {
  private container: blessed.Widgets.BoxElement;
  private services: TUIServices;
  private app: MainframeHubTUI;
  private list: blessed.Widgets.ListElement;
  private prs: any[] = [];

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
      label: ' My PRs ',
    });

    // Handle selection
    this.list.on('select', async (item: any, index: number) => {
      const prData = this.prs[index];
      if (prData) {
        await this.handlePRAction(prData);
      }
    });

    this.loadPRs(loader);
  }

  private async loadPRs(loader?: Loader) {
    try {
      if (loader) {
        loader.updateMessage('Loading your PRs...');
      }
      this.app.setStatus('Loading your PRs...');

      // Get current GitHub user
      const currentUser = execSync('gh api user --jq .login', { encoding: 'utf-8' }).trim();

      // Get user's open PRs
      const allPRs = await this.services.github.listPRs(this.services.config.repoName, {
        state: 'open',
        author: currentUser,
      });

      // Get all sessions to match
      const sessions = await this.services.discovery.discover();

      // Match PRs with sessions
      this.prs = allPRs.map((pr: any) => {
        const sessionId = `${this.services.config.sessionPrefix}${pr.number}`;
        const session = sessions.find((s) => s.session.id === sessionId);
        return {
          pr,
          session: session || null,
          hasSession: !!session,
          hasClone: !!session,
        };
      });

      const items = this.prs.map((prData) => {
        const { pr, hasSession } = prData;
        const status = hasSession ? '[ACTIVE]' : '[SETUP]';
        return `${status} PR #${pr.number}: ${pr.title}`;
      });

      if (items.length === 0) {
        items.push('No open PRs found. Create one from the NEW PR tab.');
      }

      // Destroy loader before showing content
      if (loader) {
        loader.destroy();
      }

      this.list.setItems(items);
      this.list.focus();
      this.app.setStatus(`${allPRs.length} PR(s) found. Press Enter to setup/attach.`, 'success');
      this.app.getScreen().render();
    } catch (error: any) {
      if (loader) {
        loader.destroy();
      }
      this.app.setStatus(`Error loading PRs: ${error.message}`, 'error');
    }
  }

  private async handlePRAction(prData: any) {
    if (prData.hasSession) {
      // Already has session, attach to it
      this.app.openTerminal(prData.session.session.id);
    } else {
      // Need to setup PR first
      await this.setupPR(prData.pr.number);
    }
  }

  private async setupPR(prNumber: number) {
    try {
      this.app.setStatus(`Setting up PR #${prNumber}...`);

      const result = await this.services.prService.setupExisting(prNumber, false);

      this.app.setStatus(`Setup complete! Opening terminal...`, 'success');
      setTimeout(() => {
        this.app.openTerminal(result.session.id);
      }, 500);
    } catch (error: any) {
      this.app.setStatus(`Error setting up PR: ${error.message}`, 'error');
    }
  }

  public destroy() {
    this.list.destroy();
  }
}
