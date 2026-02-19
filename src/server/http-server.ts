/**
 * Lightweight embedded HTTP server for browser access to the dashboard.
 *
 * Uses Node's built-in `http` module — no Express dependency.
 * Serves the same webview bundle (app.js + styles.css) and provides
 * REST endpoints backed by the running ServiceContainer.
 *
 * The server starts on extension activation and stops on deactivation.
 * Browser clients use the HttpBridge (fetch-based) instead of postMessage.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import type { ServerContainer, ServerLogger } from './types';
import { createMcpServer } from './mcp';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export interface HttpServerOptions {
  port: number;
  extensionPath: string;
}

export function createHttpServer(
  container: ServerContainer,
  options: HttpServerOptions,
  logger: ServerLogger,
): { server: http.Server; port: number; dispose: () => void } {
  const distWebview = path.join(options.extensionPath, 'dist', 'webview');
  const mcpServer = createMcpServer(container, logger);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${options.port}`);

    // CORS for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // MCP protocol endpoint
      if (url.pathname === '/mcp') {
        await mcpServer.handleRequest(req, res);
        return;
      }

      // Static files
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        await serveStatic(url.pathname, distWebview, res);
        return;
      }

      // API routes
      if (url.pathname.startsWith('/api/')) {
        await handleApi(url.pathname, req, res, container, logger);
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.appendLine(`[http-server] Error: ${message}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: message }));
    }
  });

  const result = { server, port: options.port, dispose: () => { server.close(); } };

  server.listen(options.port, '127.0.0.1', () => {
    logger.appendLine(`[http-server] Dashboard available at http://127.0.0.1:${result.port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = result.port + 1;
      logger.appendLine(`[http-server] Port ${result.port} in use, trying ${nextPort}`);
      result.port = nextPort;
      server.listen(nextPort, '127.0.0.1');
    } else {
      logger.appendLine(`[http-server] Server error: ${err.message}`);
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

async function serveStatic(
  pathname: string,
  distWebview: string,
  res: http.ServerResponse,
): Promise<void> {
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getIndexHtml());
    return;
  }

  // Only serve files from dist/webview/
  const safeName = path.basename(pathname);
  const filePath = path.join(distWebview, safeName);
  const ext = path.extname(safeName);
  const contentType = CONTENT_TYPES[ext];

  if (!contentType) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/styles.css">
  <title>MainframeHub</title>
</head>
<body>
  <div id="app"></div>
  <script src="/app.js"></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// API route handling
// ---------------------------------------------------------------------------

async function handleApi(
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  container: ServerContainer,
  logger: ServerLogger,
): Promise<void> {
  const sendJson = (data: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const readBody = (): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString();
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });

  try {
    switch (pathname) {
      // Queries (GET)
      case '/api/grouped-prs':
        sendJson(await container.getGroupedPRs());
        return;

      case '/api/session-states':
        sendJson(await container.getSessionStates());
        return;

      case '/api/config':
        sendJson(container.config);
        return;

      // Mutations (POST)
      case '/api/create-pr': {
        const body = await readBody();
        const result = await container.prService.createNew(body as any, () => {});
        sendJson(result);
        return;
      }

      case '/api/setup-pr': {
        const body = await readBody();
        const result = await container.prService.setupExisting(body.prNumber as number, () => {});
        sendJson(result);
        return;
      }

      case '/api/create-from-branch': {
        const body = await readBody();
        const result = await container.prService.createFromBranch(body as any, () => {});
        sendJson(result);
        return;
      }

      case '/api/close-pr': {
        const body = await readBody();
        await container.prService.close(body.prNumber as number, () => {});
        sendJson({ ok: true });
        return;
      }

      case '/api/merge-pr': {
        const body = await readBody();
        await container.github.mergePR(
          container.config.repoName,
          body.prNumber as number,
          body.method as 'merge' | 'squash' | 'rebase',
        );
        sendJson({ ok: true });
        return;
      }

      case '/api/kill-session': {
        const body = await readBody();
        await container.tmux.kill(body.sessionId as string);
        sendJson({ ok: true });
        return;
      }

      case '/api/delete-clone': {
        const body = await readBody();
        await container.fs.rmdir(body.clonePath as string, { recursive: true });
        sendJson({ ok: true });
        return;
      }

      case '/api/refresh':
        container.invalidateCaches();
        sendJson({ ok: true });
        return;

      case '/api/session-output': {
        const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const id = params.get('id');
        const lines = parseInt(params.get('lines') ?? '200', 10);
        if (!id) {
          sendJson({ error: 'Missing id parameter' }, 400);
          return;
        }
        const output = await container.tmux.capturePane(id, lines);
        sendJson({ output });
        return;
      }

      case '/api/resume-session': {
        const body = await readBody();
        const sessionId = body.sessionId as string;
        const claudeSessionId = body.claudeSessionId as string;
        await container.handover.resume(
          sessionId,
          claudeSessionId,
          body.skipPermissions as boolean | undefined,
        );
        sendJson({ ok: true });
        return;
      }

      case '/api/send-keys': {
        const body = await readBody();
        await container.tmux.sendKeys(
          body.sessionId as string,
          body.keys as string,
        );
        sendJson({ ok: true });
        return;
      }

      case '/api/worker-status': {
        const sessions = await container.tmux.list('pr-');
        const statuses = await Promise.all(
          sessions.map(async (session) => {
            const command = await container.tmux.getPaneCommand(session.id);
            const isShell = command === 'bash' || command === 'zsh' || command === 'sh' || command === 'fish';
            return {
              sessionId: session.id,
              command: command ?? 'unknown',
              status: (command === null || isShell) ? 'finished' : 'running',
            };
          }),
        );
        sendJson(statuses);
        return;
      }

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.appendLine(`[http-server] API error ${pathname}: ${message}`);
    sendJson({ error: message }, 500);
  }
}
