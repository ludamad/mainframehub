#!/usr/bin/env node
/**
 * MainframeHub CLI
 *
 * Commands:
 * - mfh list              List all sessions
 * - mfh new <prompt>      Create new PR
 * - mfh setup <pr-number> Setup existing PR
 * - mfh attach <session>  Attach to session
 * - mfh close <pr-number> Close PR
 *
 * Flags:
 * - --mock                Mock GitHub writes (for testing)
 * - --base <branch>       Base branch (default: from config)
 */

import { TmuxService } from './services/tmux.js';
import { GitService } from './services/git.js';
import { GitHubService } from './services/github.js';
import { ClaudeService } from './services/claude.js';
import { ClaudeHandoverService } from './services/handover.js';
import { PRService } from './services/pr-service.js';
import { DiscoveryService } from './services/discovery.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Load config
function loadConfig() {
  const configPaths = [
    join(process.cwd(), 'mfh.config.json'),
    join(homedir(), '.mfh.config.json'),
  ];

  for (const path of configPaths) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  }

  throw new Error('Config file not found. Create mfh.config.json');
}

// Parse args
function parseArgs(argv: string[]) {
  const args: any = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

// Main
async function main() {
  const args = parseArgs(process.argv);
  const [command, ...commandArgs] = args._;

  if (!command) {
    console.log('Usage: mfh <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  list              List all sessions');
    console.log('  new <prompt>      Create new PR');
    console.log('  setup <pr-number> Setup existing PR');
    console.log('  attach <session>  Attach to session');
    console.log('  close <pr-number> Close PR');
    console.log('');
    console.log('Flags:');
    console.log('  --mock            Mock GitHub writes');
    console.log('  --base <branch>   Base branch');
    process.exit(0);
  }

  // Load config
  const config = loadConfig();

  // Initialize services
  const tmux = new TmuxService();
  const git = new GitService();
  const github = new GitHubService({ mockWrites: args.mock || false });
  const claude = new ClaudeService();
  const handover = new ClaudeHandoverService(tmux);
  const prService = new PRService(tmux, git, github, claude, handover, config);
  const discovery = new DiscoveryService(tmux, git, github, config.sessionPrefix);

  // Execute command
  try {
    switch (command) {
      case 'list': {
        const states = await discovery.discover();

        if (states.length === 0) {
          console.log('No sessions found');
          break;
        }

        console.log(`Found ${states.length} session(s):\n`);

        states.forEach(state => {
          console.log(`${state.isActive ? '▶' : ' '} ${state.session.id}`);
          if (state.pr) {
            console.log(`   PR #${state.pr.number}: ${state.pr.title}`);
            console.log(`   ${state.pr.branch} -> ${state.pr.baseBranch}`);
          } else if (state.gitInfo) {
            console.log(`   ${state.gitInfo.branch} (no PR)`);
          } else {
            console.log(`   ${state.session.workingDir} (no git)`);
          }
          console.log('');
        });
        break;
      }

      case 'new': {
        const prompt = commandArgs.join(' ');
        if (!prompt) {
          console.error('Error: prompt required');
          console.error('Usage: mfh new <prompt>');
          process.exit(1);
        }

        const result = await prService.createNew({
          prompt,
          baseBranch: args.base,
        });

        console.log('');
        console.log(`PR created: ${result.pr.url}`);
        console.log(`Session: ${result.session.id}`);
        console.log('');
        console.log('Attach with: mfh attach ' + result.session.id);
        break;
      }

      case 'setup': {
        const prNumber = parseInt(commandArgs[0], 10);
        if (isNaN(prNumber)) {
          console.error('Error: PR number required');
          console.error('Usage: mfh setup <pr-number>');
          process.exit(1);
        }

        const result = await prService.setupExisting(prNumber);

        console.log('');
        console.log(`PR #${prNumber} set up`);
        console.log(`Session: ${result.session.id}`);
        console.log('');
        console.log('Attach with: mfh attach ' + result.session.id);
        break;
      }

      case 'attach': {
        const sessionId = commandArgs[0];
        if (!sessionId) {
          console.error('Error: session ID required');
          console.error('Usage: mfh attach <session-id>');
          process.exit(1);
        }

        console.log(`Attaching to ${sessionId}...`);
        await tmux.attach(sessionId); // Blocking
        break;
      }

      case 'close': {
        const prNumber = parseInt(commandArgs[0], 10);
        if (isNaN(prNumber)) {
          console.error('Error: PR number required');
          console.error('Usage: mfh close <pr-number>');
          process.exit(1);
        }

        await prService.close(prNumber);
        console.log(`PR #${prNumber} closed`);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
