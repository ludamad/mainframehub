/**
 * MainframeHub TUI Application
 *
 * Main application class that manages the screen, navigation, and views
 */

import blessed from 'blessed';
import type { TmuxService } from '../src/services/tmux.js';
import type { GitService } from '../src/services/git.js';
import type { GitHubService } from '../src/services/github.js';
import type { ClaudeService } from '../src/services/claude.js';
import type { DiscoveryService } from '../src/services/discovery.js';
import type { PRService } from '../src/services/pr-service.js';
import { SessionsView } from './views/sessions.js';
import { MyPRsView } from './views/my-prs.js';
import { NewPRView } from './views/new-pr.js';
import { BranchesView } from './views/branches.js';
import { TerminalView } from './views/terminal.js';

export interface TUIServices {
  tmux: TmuxService;
  git: GitService;
  github: GitHubService;
  claude: ClaudeService;
  discovery: DiscoveryService;
  prService: PRService;
  config: any;
}

export class MainframeHubTUI {
  private screen: blessed.Widgets.Screen;
  private services: TUIServices;
  private container: blessed.Widgets.BoxElement;
  private header: blessed.Widgets.BoxElement;
  private tabs: blessed.Widgets.BoxElement;
  private content: blessed.Widgets.BoxElement;
  private statusBar: blessed.Widgets.BoxElement;

  private currentTab: string = 'sessions';
  private currentView: any = null;

  // Tab definitions
  private tabList = [
    { key: 'sessions', label: 'SESSIONS', hotkey: '1' },
    { key: 'my-prs', label: 'MY PRs', hotkey: '2' },
    { key: 'branches', label: 'BRANCHES', hotkey: '3' },
    { key: 'new-pr', label: 'NEW PR', hotkey: '4' },
  ];

  constructor(services: TUIServices) {
    this.services = services;

    // Create blessed screen with mouse support
    this.screen = blessed.screen({
      smartCSR: true,
      mouse: true,
      title: 'MainframeHub',
      fullUnicode: true,
    });

    // Create main container
    this.container = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    });

    // Create header
    this.header = blessed.box({
      parent: this.container,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' {bold}{cyan-fg}MAINFRAMEHUB{/cyan-fg}{/bold}',
      tags: true,
      style: {
        bg: 'black',
      },
    });

    // Create tab bar
    this.tabs = blessed.box({
      parent: this.container,
      top: 1,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: {
        bg: 'black',
      },
    });

    // Create content area
    this.content = blessed.box({
      parent: this.container,
      top: 2,
      left: 0,
      width: '100%',
      height: '100%-3',
      scrollable: false,
    });

    // Create status bar
    this.statusBar = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' {gray-fg}q: quit | 1-4: switch tabs | mouse: click to navigate{/gray-fg}',
      tags: true,
      style: {
        bg: 'black',
      },
    });

    this.setupKeyBindings();
    this.setupTabClickHandlers();
    this.renderTabs();
  }

  private setupKeyBindings() {
    // Quit
    this.screen.key(['q', 'C-c'], () => {
      return process.exit(0);
    });

    // Tab switching
    this.tabList.forEach((tab) => {
      this.screen.key([tab.hotkey], () => {
        this.switchTab(tab.key);
      });
    });

    // Escape to go back to tabs from terminal
    this.screen.key(['escape'], () => {
      if (this.currentView instanceof TerminalView) {
        this.currentView.detach();
        this.switchTab('sessions');
      }
    });
  }

  private setupTabClickHandlers() {
    this.tabs.on('click', (data: any) => {
      // Calculate which tab was clicked based on x position
      const x = data.x;
      let currentX = 1;

      for (const tab of this.tabList) {
        const tabWidth = tab.label.length + 4; // label + padding
        if (x >= currentX && x < currentX + tabWidth) {
          this.switchTab(tab.key);
          break;
        }
        currentX += tabWidth;
      }
    });
  }

  private renderTabs() {
    let content = ' ';
    for (const tab of this.tabList) {
      const isActive = tab.key === this.currentTab;
      if (isActive) {
        content += `{bold}{cyan-bg}{black-fg} ${tab.label} {/black-fg}{/cyan-bg}{/bold} `;
      } else {
        content += `{gray-fg} ${tab.label} {/gray-fg} `;
      }
    }
    this.tabs.setContent(content);
    this.screen.render();
  }

  public async switchTab(tabKey: string) {
    if (tabKey === this.currentTab) return;

    // Destroy current view
    if (this.currentView) {
      this.currentView.destroy();
      this.currentView = null;
    }

    // INSTANT FEEDBACK: Update tab visual immediately
    this.currentTab = tabKey;
    this.renderTabs();

    // Show loading indicator while view initializes
    const { Loader } = await import('./components/loader.js');
    const loader = new Loader(this.content, 'Loading view...');

    // Small delay to ensure loader is visible
    await new Promise(resolve => setTimeout(resolve, 10));

    try {
      // Create new view asynchronously
      switch (tabKey) {
        case 'sessions':
          this.currentView = new SessionsView(this.content, this.services, this, loader);
          break;
        case 'my-prs':
          this.currentView = new MyPRsView(this.content, this.services, this, loader);
          break;
        case 'branches':
          this.currentView = new BranchesView(this.content, this.services, this, loader);
          break;
        case 'new-pr':
          this.currentView = new NewPRView(this.content, this.services, this, loader);
          break;
      }
    } catch (error) {
      loader.destroy();
      this.setStatus('Error loading view', 'error');
    }

    this.screen.render();
  }

  public openTerminal(sessionId: string) {
    // Destroy current view
    if (this.currentView) {
      this.currentView.destroy();
      this.currentView = null;
    }

    // Create terminal view (full takeover)
    this.currentView = new TerminalView(this.container, this.services, this, sessionId);
    this.screen.render();
  }

  public setStatus(message: string, style: 'info' | 'success' | 'error' = 'info') {
    let color = 'gray';
    if (style === 'success') color = 'green';
    if (style === 'error') color = 'red';

    this.statusBar.setContent(` {${color}-fg}${message}{/${color}-fg}`);
    this.screen.render();
  }

  public start() {
    // Load initial view
    this.switchTab('sessions');
    this.screen.render();
  }

  public getScreen(): blessed.Widgets.Screen {
    return this.screen;
  }
}
