#!/usr/bin/env node
/**
 * MainframeHub TUI - Terminal User Interface
 *
 * Full-featured TUI that runs entirely on the host machine with:
 * - Direct service integration (no HTTP)
 * - Native tmux forwarding (no WebSocket)
 * - Mouse-based navigation
 * - All web app functionality
 */

import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MainframeHubTUI } from './app.js';
import { TmuxService } from '../src/services/tmux.js';
import { GitService } from '../src/services/git.js';
import { GitHubService } from '../src/services/github.js';
import { ClaudeService } from '../src/services/claude.js';
import { DiscoveryService } from '../src/services/discovery.js';
import { PRService } from '../src/services/pr-service.js';
import { ClaudeHandoverService } from '../src/services/handover.js';

async function main() {
  // Redirect console output to log file to avoid interfering with TUI
  const logFile = join(tmpdir(), 'mfh-tui.log');
  const logStream = {
    write: (msg: string) => {
      try {
        appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
      } catch (e) {
        // Ignore log errors
      }
    }
  };

  // Redirect console.log and console.error
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  console.log = (...args: any[]) => logStream.write(`LOG: ${args.join(' ')}`);
  console.error = (...args: any[]) => logStream.write(`ERROR: ${args.join(' ')}`);

  // Write initial log entry
  logStream.write(`TUI started - logs at ${logFile}`);

  // Load configuration
  const configPath = process.argv[2] || join(process.cwd(), 'mfh.config.json');
  let config: any;

  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (error: any) {
    // Restore console for errors during init
    console.error = originalConsoleError;
    console.error(`Failed to load config from ${configPath}:`);
    console.error(error.message);
    process.exit(1);
  }

  // Initialize services (direct, no HTTP/WebSocket)
  const tmux = new TmuxService();
  const git = new GitService();
  const github = new GitHubService({ mockWrites: false });
  const claude = new ClaudeService();
  const handover = new ClaudeHandoverService(tmux);
  const discovery = new DiscoveryService(tmux, git, github, config.sessionPrefix);
  const prService = new PRService(tmux, git, github, claude, handover, config);

  // Create and start TUI
  const app = new MainframeHubTUI({
    tmux,
    git,
    github,
    claude,
    discovery,
    prService,
    config,
  });

  app.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
