import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupAPI } from './api.js';
import { setupWebSocket } from './websocket.js';
import { TmuxService } from '../../src/services/tmux.js';
import { GitService } from '../../src/services/git.js';
import { GitHubService } from '../../src/services/github.js';
import { ClaudeService } from '../../src/services/claude.js';
import { DiscoveryService } from '../../src/services/discovery.js';
import { PRService } from '../../src/services/pr-service.js';
import { ClaudeHandoverService } from '../../src/services/handover.js';
import { readFileSync } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export function createWebServer(options = {}) {
    const port = options.port || 3000;
    const mockWrites = options.mockWrites ?? true; // Default to mock writes for safety
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
    const prService = new PRService(tmux, git, github, claude, handover, config);
    // Create Express app
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ server });
    // Middleware
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../static')));
    // Setup API routes
    setupAPI(app, { discovery, prService, config });
    // Setup WebSocket
    setupWebSocket(wss, tmux);
    // Health check
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            mockWrites,
            timestamp: new Date().toISOString()
        });
    });
    // Start server
    server.listen(port, () => {
        console.log(`MainframeHub web server running on http://localhost:${port}`);
        console.log(`Mock writes: ${mockWrites ? 'ENABLED' : 'DISABLED'}`);
    });
    return { app, server, wss };
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
//# sourceMappingURL=index.js.map