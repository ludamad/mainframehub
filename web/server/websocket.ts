import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { TmuxService } from '../../src/services/tmux.js';

interface WSMessage {
  type: 'attach' | 'input' | 'resize';
  sessionId?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

interface TerminalSession {
  ws: WebSocket;
  process: ChildProcess;
  sessionId: string;
}

const activeSessions = new Map<WebSocket, TerminalSession>();

export function setupWebSocket(wss: WebSocketServer, tmux: TmuxService) {
  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');

    ws.on('message', async (data: Buffer) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());
        await handleMessage(ws, message, tmux);
      } catch (error: any) {
        console.error('Error handling WebSocket message:', error);
        sendError(ws, error.message);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      cleanupSession(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      cleanupSession(ws);
    });
  });
}

async function handleMessage(ws: WebSocket, message: WSMessage, tmux: TmuxService) {
  switch (message.type) {
    case 'attach':
      await handleAttach(ws, message, tmux);
      break;
    case 'input':
      handleInput(ws, message);
      break;
    case 'resize':
      handleResize(ws, message);
      break;
    default:
      sendError(ws, `Unknown message type: ${(message as any).type}`);
  }
}

async function handleAttach(ws: WebSocket, message: WSMessage, tmux: TmuxService) {
  if (!message.sessionId) {
    sendError(ws, 'sessionId is required for attach');
    return;
  }

  // Check if session exists
  const sessionExists = await tmux.exists(message.sessionId);
  if (!sessionExists) {
    sendError(ws, `Session ${message.sessionId} does not exist`);
    return;
  }

  // Clean up any existing session for this WebSocket
  cleanupSession(ws);

  // Spawn tmux attach process
  const proc = spawn('tmux', ['attach', '-t', message.sessionId], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Store session info
  activeSessions.set(ws, {
    ws,
    process: proc,
    sessionId: message.sessionId
  });

  // Forward stdout to WebSocket
  proc.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'output',
        data: data.toString('utf-8')
      }));
    }
  });

  // Forward stderr to WebSocket
  proc.stderr?.on('data', (data: Buffer) => {
    console.error('tmux stderr:', data.toString('utf-8'));
  });

  // Handle process exit
  proc.on('exit', (code) => {
    console.log(`tmux process exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'exit',
        code: code || 0
      }));
    }
    activeSessions.delete(ws);
  });

  // Handle process error
  proc.on('error', (error) => {
    console.error('tmux process error:', error);
    sendError(ws, `Failed to attach to session: ${error.message}`);
    activeSessions.delete(ws);
  });

  console.log(`Attached to session: ${message.sessionId}`);
}

function handleInput(ws: WebSocket, message: WSMessage) {
  const session = activeSessions.get(ws);
  if (!session) {
    sendError(ws, 'No active session');
    return;
  }

  if (!message.data) {
    sendError(ws, 'data is required for input');
    return;
  }

  // Write to tmux stdin
  session.process.stdin?.write(message.data);
}

function handleResize(ws: WebSocket, message: WSMessage) {
  const session = activeSessions.get(ws);
  if (!session) {
    sendError(ws, 'No active session');
    return;
  }

  if (typeof message.cols !== 'number' || typeof message.rows !== 'number') {
    sendError(ws, 'cols and rows are required for resize');
    return;
  }

  // Send resize escape sequence to tmux
  // Note: This is a simplified version. In production, you might want to use
  // tmux's control mode or send proper resize signals
  const resizeSeq = `\x1b[8;${message.rows};${message.cols}t`;
  session.process.stdin?.write(resizeSeq);
}

function cleanupSession(ws: WebSocket) {
  const session = activeSessions.get(ws);
  if (session) {
    console.log(`Cleaning up session: ${session.sessionId}`);

    // Kill the tmux attach process
    if (!session.process.killed) {
      session.process.kill('SIGTERM');
    }

    activeSessions.delete(ws);
  }
}

function sendError(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'error',
      message
    }));
  }
}
