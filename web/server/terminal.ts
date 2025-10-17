/**
 * Terminal WebSocket handler - manages xterm.js connections to tmux sessions
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { Server } from 'http';
import { validateWebSocketToken } from './auth-middleware.js';

interface TerminalMessage {
  type: 'input' | 'output' | 'resize' | 'exit' | 'ready';
  data?: string;
  cols?: number;
  rows?: number;
  exitCode?: number;
}

interface TerminalSession {
  pty: pty.IPty;
  ws: WebSocket;
  sessionId: string;
}

const activeSessions = new Map<string, TerminalSession>();

export function setupTerminalWebSocket(httpServer: Server, repo: string) {
  // Terminal WebSocket at /terminal path
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/terminal'
  });

  wss.on('connection', async (ws: WebSocket, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session');
    const token = url.searchParams.get('token');
    const cols = parseInt(url.searchParams.get('cols') || '80', 10);
    const rows = parseInt(url.searchParams.get('rows') || '24', 10);

    if (!sessionId) {
      ws.close(1008, 'Session ID required');
      return;
    }

    // Validate token
    const authResult = await validateWebSocketToken(token || '', repo);
    if (!authResult.valid) {
      ws.close(1008, 'Invalid or missing GitHub token');
      return;
    }

    console.log(`Terminal WebSocket: Attaching to session ${sessionId}`);

    // Spawn PTY that attaches to tmux session
    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn('tmux', ['attach-session', '-t', sessionId], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.cwd(),
        env: process.env as { [key: string]: string }
      });
    } catch (error: any) {
      console.error('Failed to spawn PTY:', error);
      ws.close(1011, `Failed to attach to session: ${error.message}`);
      return;
    }

    // Store active session
    activeSessions.set(sessionId, { pty: ptyProcess, ws, sessionId });

    // Forward PTY output to WebSocket
    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const message: TerminalMessage = { type: 'output', data };
        ws.send(JSON.stringify(message));
      }
    });

    // Handle PTY exit (when tmux session ends or detach)
    ptyProcess.onExit(({ exitCode }) => {
      const message: TerminalMessage = { type: 'exit', exitCode };
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        ws.close();
      }
      activeSessions.delete(sessionId);
      console.log(`Terminal session ${sessionId} exited with code ${exitCode}`);
    });

    // Forward WebSocket messages to PTY
    ws.on('message', async (msg) => {
      try {
        const message = JSON.parse(msg.toString()) as TerminalMessage;

        switch (message.type) {
          case 'input':
            if (message.data) {
              ptyProcess.write(message.data);
            }
            break;
          case 'resize':
            if (message.cols && message.rows) {
              ptyProcess.resize(message.cols, message.rows);
            }
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    // Cleanup on disconnect
    ws.on('close', () => {
      // Kill the PTY process (detaches from tmux, but tmux session continues)
      ptyProcess.kill();
      activeSessions.delete(sessionId);
      console.log(`Terminal WebSocket closed for session ${sessionId}`);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      ptyProcess.kill();
      activeSessions.delete(sessionId);
    });

    // Send ready message
    const readyMessage: TerminalMessage = { type: 'ready' };
    ws.send(JSON.stringify(readyMessage));
  });

  return wss;
}

export function getActiveSessions(): string[] {
  return Array.from(activeSessions.keys());
}
