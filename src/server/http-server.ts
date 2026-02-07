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
import type * as vscode from 'vscode';
import type { ServiceContainer } from '../container';

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
  container: ServiceContainer,
  options: HttpServerOptions,
  outputChannel: vscode.OutputChannel,
): { server: http.Server; port: number; dispose: () => void } {
  const distWebview = path.join(options.extensionPath, 'dist', 'webview');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${options.port}`);

    // CORS for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Static files
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        await serveStatic(url.pathname, distWebview, res);
        return;
      }

      // API routes
      if (url.pathname.startsWith('/api/')) {
        await handleApi(url.pathname, req, res, container, outputChannel);
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[http-server] Error: ${message}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.listen(options.port, '127.0.0.1', () => {
    outputChannel.appendLine(`[http-server] Dashboard available at http://127.0.0.1:${options.port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      outputChannel.appendLine(`[http-server] Port ${options.port} in use, trying ${options.port + 1}`);
      server.listen(options.port + 1, '127.0.0.1');
    } else {
      outputChannel.appendLine(`[http-server] Server error: ${err.message}`);
    }
  });

  return {
    server,
    port: options.port,
    dispose: () => { server.close(); },
  };
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
  container: ServiceContainer,
  outputChannel: vscode.OutputChannel,
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
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
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

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[http-server] API error ${pathname}: ${message}`);
    sendJson({ error: message }, 500);
  }
}
