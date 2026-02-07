import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupAPI } from './api.js';
import { setupTerminalWebSocket } from './terminal.js';
import { requireAuth, createValidateTokenEndpoint } from './auth-middleware.js';
import { TmuxService } from '../../src/services/tmux.js';
import { GitService } from '../../src/services/git.js';
import { GitHubService } from '../../src/services/github.js';
import { ClaudeService } from '../../src/services/claude.js';
import { DiscoveryService } from '../../src/services/discovery.js';
import { SessionCacheService } from '../../src/services/session-cache.js';
import { PRCacheService } from '../../src/services/pr-cache.js';
import { BranchCacheService } from '../../src/services/branch-cache.js';
import { PRService } from '../../src/services/pr-service.js';
import { ClaudeHandoverService } from '../../src/services/handover.js';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerOptions {
  port?: number;
  mockWrites?: boolean;
  configPath?: string;
}

export function createWebServer(options: ServerOptions = {}) {
  const port = options.port || 3000;
  const mockWrites = options.mockWrites ?? false; // Default to real writes
  const configPath = options.configPath || path.join(process.cwd(), 'mfh.config.json');

  // Load configuration
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Initialize services
  const tmux = new TmuxService();
  const git = new GitService();
  const github = new GitHubService({ mockWrites });
  const claude = new ClaudeService();
  const handover = new ClaudeHandoverService(tmux);
  const discovery = new DiscoveryService(tmux, git, github, config.sessionPrefix);
  const sessionCache = new SessionCacheService(discovery, 30000); // 30s TTL
  const prCache = new PRCacheService(github, config.repoName); // 60min TTL

  // Branch cache with fetcher function
  const branchCache = new BranchCacheService(async (username: string) => {
    // Get all open PRs to exclude branches that already have PRs
    const openPRs = await github.listPRs(config.repoName, { state: 'open' });
    const prBranches = new Set(openPRs.map((pr: any) => pr.branch));

    // Fetch ALL branches from remote in reference git folder
    try {
      execSync(`git -C "${config.repo}" fetch --all --prune`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
    } catch (fetchError: any) {
      throw new Error(`Failed to fetch branches from ${config.repo}: ${fetchError.message}`);
    }

    // Get all remote branches from the reference git folder
    const branchOutput = execSync(
      `git -C "${config.repo}" branch -r --format='%(refname:short)'`,
      { encoding: 'utf-8' }
    );
    const allBranches = branchOutput
      .trim()
      .split('\n')
      .filter(line => line.startsWith('origin/'))
      .map(line => line.replace('origin/', ''))
      .filter(line => line && line !== 'HEAD');

    // Get current user's email from token
    const userEmail = execSync('gh api user --jq .email', { encoding: 'utf-8' }).trim();

    // For each branch, check if the LAST commit is by the current user
    const userBranches = [];
    for (const branchName of allBranches) {
      // Skip branches that already have PRs
      if (prBranches.has(branchName)) {
        continue;
      }

      try {
        // Get the author email of the last commit on this branch
        const lastCommitAuthor = execSync(
          `git -C "${config.repo}" log -1 --format=%ae origin/${branchName} 2>/dev/null`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
        ).trim();

        // Check if the last commit is by the current user
        if (lastCommitAuthor === userEmail) {
          // Check if protected
          const protectedStatus = execSync(
            `gh api "repos/${config.repoName}/branches/${branchName}" --jq .protected`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
          ).trim();

          userBranches.push({
            name: branchName,
            protected: protectedStatus === 'true'
          });
        }
      } catch (error) {
        // Branch might not exist or other error, skip it
        continue;
      }
    }

    return userBranches;
  });

  const prService = new PRService(tmux, git, github, claude, handover, config);

  // Create Express app
  const app = express();
  const server = createServer(app);

  // Middleware
  app.use(express.json());
  // Serve static files from source directory (not copied to dist)
  app.use(express.static(path.join(__dirname, '../../../web/static')));

  // Public endpoint to validate token (no auth required)
  app.post('/api/auth/validate', createValidateTokenEndpoint(config.repo));

  // Authentication middleware for all other API routes
  const authMiddleware = requireAuth(config.repo);

  // Setup API routes (protected by auth middleware)
  setupAPI(app, { discovery, sessionCache, prCache, branchCache, prService, github, config, configPath }, authMiddleware);

  // Setup Terminal WebSocket (will handle auth internally)
  const terminalWss = setupTerminalWebSocket(server, config.repo);

  // Health check (public)
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      mockWrites,
      timestamp: new Date().toISOString()
    });
  });

  // SPA catch-all route - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../../web/static/index.html'));
  });

  // Start server
  server.listen(port, () => {
    console.log(`MainframeHub web server running on http://localhost:${port}`);
    console.log(`Mock writes: ${mockWrites ? 'ENABLED' : 'DISABLED'}`);
  });

  return { app, server, terminalWss };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const mockWrites = args.includes('--mock');
  const portArg = args.find(arg => arg.startsWith('--port='));
  const port = portArg ? parseInt(portArg.split('=')[1]) : 3000;
  const configArg = args.find(arg => arg.startsWith('--config='));
  const configPath = configArg?.split('=')[1];

  createWebServer({ port, mockWrites, configPath });
}
