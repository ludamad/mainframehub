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
import { PRService } from '../../src/services/pr-service.js';
import { ClaudeHandoverService } from '../../src/services/handover.js';
import { readFileSync } from 'fs';

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
  setupAPI(app, { discovery, sessionCache, prService, github, config, configPath }, authMiddleware);

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
