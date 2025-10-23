/**
 * Loading Indicator Component
 */

import blessed from 'blessed';

export class Loader {
  private box: blessed.Widgets.BoxElement;
  private loadingChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentFrame = 0;
  private interval: NodeJS.Timeout | null = null;

  constructor(parent: blessed.Widgets.BoxElement, message: string = 'Loading...') {
    this.box = blessed.box({
      parent,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 5,
      content: '',
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
    });

    this.start(message);
  }

  private start(message: string) {
    this.interval = setInterval(() => {
      const spinner = this.loadingChars[this.currentFrame];
      this.box.setContent(`\n  {cyan-fg}${spinner}{/cyan-fg} ${message}`);
      this.box.screen.render();
      this.currentFrame = (this.currentFrame + 1) % this.loadingChars.length;
    }, 80);
  }

  public updateMessage(message: string) {
    const spinner = this.loadingChars[this.currentFrame];
    this.box.setContent(`\n  {cyan-fg}${spinner}{/cyan-fg} ${message}`);
    this.box.screen.render();
  }

  public destroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.box.destroy();
  }
}
