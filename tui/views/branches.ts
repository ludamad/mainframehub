/**
 * Branches View - Shows user's branches without PRs
 */

import blessed from 'blessed';
import { execSync } from 'child_process';
import type { TUIServices } from '../app.js';
import type { MainframeHubTUI } from '../app.js';
import type { Loader } from '../components/loader.js';

export class BranchesView {
  private container: blessed.Widgets.BoxElement;
  private services: TUIServices;
  private app: MainframeHubTUI;
  private list: blessed.Widgets.ListElement;
  private branches: any[] = [];

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
      label: ' Branches (without PRs) ',
    });

    // Handle selection
    this.list.on('select', async (item: any, index: number) => {
      const branch = this.branches[index];
      if (branch && !branch.protected) {
        await this.createPRFromBranch(branch.name);
      } else if (branch && branch.protected) {
        this.app.setStatus('Cannot create PR from protected branch', 'error');
      }
    });

    this.loadBranches(loader);
  }

  private async loadBranches(loader?: Loader) {
    try {
      if (loader) {
        loader.updateMessage('Loading branches...');
      }
      this.app.setStatus('Loading branches...');

      // Validate config.repo exists
      if (!this.services.config.repo) {
        throw new Error('Reference git repository path not configured');
      }

      // Get all open PRs to exclude branches that already have PRs
      const openPRs = await this.services.github.listPRs(this.services.config.repoName, { state: 'open' });
      const prBranches = new Set(openPRs.map((pr: any) => pr.branch));

      // Fetch ALL branches from remote
      try {
        execSync(`git -C "${this.services.config.repo}" fetch --all --prune`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch (fetchError: any) {
        throw new Error(`Failed to fetch branches: ${fetchError.message}`);
      }

      // Get all remote branches
      const branchOutput = execSync(`git -C "${this.services.config.repo}" branch -r --format='%(refname:short)'`, {
        encoding: 'utf-8',
      });
      const allBranches = branchOutput
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('origin/'))
        .map((line) => line.replace('origin/', ''))
        .filter((line) => line && line !== 'HEAD');

      // Get current user's email
      const userEmail = execSync('gh api user --jq .email', { encoding: 'utf-8' }).trim();

      // Filter to user's branches
      const userBranches = [];
      for (const branchName of allBranches) {
        // Skip branches that already have PRs
        if (prBranches.has(branchName)) {
          continue;
        }

        try {
          // Get the author email of the last commit on this branch
          const lastCommitAuthor = execSync(
            `git -C "${this.services.config.repo}" log -1 --format=%ae origin/${branchName} 2>/dev/null`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
          ).trim();

          // Check if the last commit is by the current user
          if (lastCommitAuthor === userEmail) {
            // Check if protected
            const protectedStatus = execSync(
              `gh api "repos/${this.services.config.repoName}/branches/${branchName}" --jq .protected`,
              { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
            ).trim();

            userBranches.push({
              name: branchName,
              protected: protectedStatus === 'true',
            });
          }
        } catch (error) {
          // Branch might not exist or other error, skip it
          continue;
        }
      }

      this.branches = userBranches;

      const items = userBranches.map((branch) => {
        const status = branch.protected ? '[PROTECTED]' : '[CREATE PR]';
        return `${status} ${branch.name}`;
      });

      if (items.length === 0) {
        items.push('No branches found without PRs.');
      }

      // Destroy loader before showing content
      if (loader) {
        loader.destroy();
      }

      this.list.setItems(items);
      this.list.focus();
      this.app.setStatus(`${userBranches.length} branch(es) found. Press Enter to create PR.`, 'success');
      this.app.getScreen().render();
    } catch (error: any) {
      if (loader) {
        loader.destroy();
      }
      this.app.setStatus(`Error loading branches: ${error.message}`, 'error');
    }
  }

  private async createPRFromBranch(branchName: string) {
    // Prompt for PR title
    const titleInput = blessed.prompt({
      parent: this.container,
      top: 'center',
      left: 'center',
      width: '80%',
      height: 'shrink',
      keys: true,
      mouse: true,
      border: {
        type: 'line',
      },
      label: ' Enter PR Title ',
    });

    titleInput.input(`PR title for branch "${branchName}":`, '', async (err, value) => {
      titleInput.destroy();
      this.app.getScreen().render();

      if (err || !value) {
        this.app.setStatus('PR creation cancelled', 'error');
        return;
      }

      const title = value.trim();
      if (!title) {
        this.app.setStatus('PR title cannot be empty', 'error');
        return;
      }

      try {
        this.app.setStatus(`Creating PR from ${branchName}...`, 'info');

        const result = await this.services.prService.createFromBranch({
          branchName,
          title,
          baseBranch: this.services.config.baseBranch,
          skipPermissions: this.services.config.dangerouslySkipPermissions || false,
        });

        this.app.setStatus(`Created PR #${result.pr.number}! Opening terminal...`, 'success');
        setTimeout(() => {
          this.app.openTerminal(result.session.id);
        }, 1000);
      } catch (error: any) {
        this.app.setStatus(`Error creating PR: ${error.message}`, 'error');
      }
    });

    this.app.getScreen().render();
  }

  public destroy() {
    this.list.destroy();
  }
}
