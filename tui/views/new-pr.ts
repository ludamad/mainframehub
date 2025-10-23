/**
 * New PR View - Form to create a new PR
 */

import blessed from 'blessed';
import type { TUIServices } from '../app.js';
import type { MainframeHubTUI } from '../app.js';
import type { Loader } from '../components/loader.js';

export class NewPRView {
  private container: blessed.Widgets.BoxElement;
  private services: TUIServices;
  private app: MainframeHubTUI;
  private form: blessed.Widgets.FormElement<any>;
  private promptInput: blessed.Widgets.TextareaElement;
  private baseBranchInput: blessed.Widgets.TextboxElement;
  private submitButton: blessed.Widgets.ButtonElement;

  constructor(container: blessed.Widgets.BoxElement, services: TUIServices, app: MainframeHubTUI, loader?: Loader) {
    this.container = container;
    this.services = services;
    this.app = app;

    // Create form
    this.form = blessed.form({
      parent: container,
      top: 'center',
      left: 'center',
      width: '80%',
      height: 20,
      keys: true,
      mouse: true,
      border: {
        type: 'line',
      },
      label: ' Create New PR ',
      style: {
        border: {
          fg: 'cyan',
        },
      },
    });

    // Prompt label
    blessed.text({
      parent: this.form,
      top: 1,
      left: 2,
      content: 'Describe what you want to build (for Claude):',
    });

    // Prompt textarea
    this.promptInput = blessed.textarea({
      parent: this.form,
      top: 3,
      left: 2,
      width: '100%-4',
      height: 8,
      keys: true,
      mouse: true,
      inputOnFocus: true,
      border: {
        type: 'line',
      },
      style: {
        focus: {
          border: {
            fg: 'cyan',
          },
        },
      },
    });

    // Base branch label
    blessed.text({
      parent: this.form,
      top: 12,
      left: 2,
      content: 'Base branch (default: main):',
    });

    // Base branch input
    this.baseBranchInput = blessed.textbox({
      parent: this.form,
      top: 13,
      left: 2,
      width: 30,
      height: 3,
      keys: true,
      mouse: true,
      inputOnFocus: true,
      content: this.services.config.baseBranch || 'main',
      border: {
        type: 'line',
      },
      style: {
        focus: {
          border: {
            fg: 'cyan',
          },
        },
      },
    });

    // Submit button
    this.submitButton = blessed.button({
      parent: this.form,
      bottom: 1,
      left: 'center',
      width: 20,
      height: 3,
      content: 'Create PR',
      keys: true,
      mouse: true,
      border: {
        type: 'line',
      },
      style: {
        focus: {
          bg: 'cyan',
          fg: 'black',
          bold: true,
        },
        hover: {
          bg: 'cyan',
          fg: 'black',
        },
      },
    });

    this.submitButton.on('press', () => {
      this.handleSubmit();
    });

    // Set up tab navigation
    this.promptInput.key(['tab'], () => {
      this.baseBranchInput.focus();
    });

    this.baseBranchInput.key(['tab'], () => {
      this.submitButton.focus();
    });

    this.submitButton.key(['tab'], () => {
      this.promptInput.focus();
    });

    // Destroy loader after form is rendered
    if (loader) {
      loader.destroy();
    }

    this.promptInput.focus();
    this.app.setStatus('Fill in the form and press Enter on Create PR button', 'info');
  }

  private async handleSubmit() {
    const prompt = this.promptInput.getValue().trim();
    const baseBranch = this.baseBranchInput.getValue().trim() || this.services.config.baseBranch;

    if (!prompt) {
      this.app.setStatus('Please enter a prompt', 'error');
      return;
    }

    try {
      this.app.setStatus('Creating PR...', 'info');

      const result = await this.services.prService.createNew({
        prompt,
        baseBranch,
        skipPermissions: this.services.config.dangerouslySkipPermissions || false,
      });

      this.app.setStatus(`Created PR #${result.pr.number}! Opening terminal...`, 'success');

      // Clear form
      this.promptInput.setValue('');

      // Open terminal
      setTimeout(() => {
        this.app.openTerminal(result.session.id);
      }, 1000);
    } catch (error: any) {
      this.app.setStatus(`Error creating PR: ${error.message}`, 'error');
    }
  }

  public destroy() {
    this.form.destroy();
  }
}
