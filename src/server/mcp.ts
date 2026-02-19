/**
 * MCP (Model Context Protocol) tools for MainframeHub.
 *
 * Registers all MFH tools on an McpServer instance. Each tool calls
 * the ServerContainer directly — the same container used by VS Code
 * commands and HTTP routes.
 *
 * The McpServer is connected to a StreamableHTTPServerTransport mounted
 * at /mcp on the existing HTTP server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type * as http from 'http';
import type { ServerContainer, ServerLogger } from './types';

export function createMcpServer(
  container: ServerContainer,
  logger: ServerLogger,
): { handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> } {
  const mcp = new McpServer(
    { name: 'mainframehub', version: '0.2.0' },
  );

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  mcp.tool(
    'mfh_list_prs',
    'List all PRs grouped by status (active session, has clone, not set up, closed with clone)',
    {},
    async () => {
      const data = await container.getGroupedPRs();
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  mcp.tool(
    'mfh_session_states',
    'Get all tmux session states with git info and PR associations',
    {},
    async () => {
      const data = await container.getSessionStates();
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  mcp.tool(
    'mfh_create_pr',
    'Create a new PR. Generates branch/title via Claude, clones repo, creates branch, opens draft PR, starts tmux session with Claude.',
    {
      prompt: z.string().describe('What this PR should implement'),
      baseBranch: z.string().optional().describe('Base branch (default: main)'),
    },
    async ({ prompt, baseBranch }) => {
      const data = await container.prService.createNew({ prompt, baseBranch });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  mcp.tool(
    'mfh_setup_pr',
    'Set up a local clone and tmux session for an existing GitHub PR',
    { prNumber: z.number().describe('PR number to set up') },
    async ({ prNumber }) => {
      const data = await container.prService.setupExisting(prNumber);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  mcp.tool(
    'mfh_close_pr',
    'Close a PR on GitHub, kill its tmux session, and remove the local clone',
    { prNumber: z.number().describe('PR number to close') },
    async ({ prNumber }) => {
      await container.prService.close(prNumber);
      return { content: [{ type: 'text' as const, text: 'PR closed and cleaned up.' }] };
    },
  );

  mcp.tool(
    'mfh_merge_pr',
    'Merge a PR on GitHub',
    {
      prNumber: z.number().describe('PR number to merge'),
      method: z.enum(['merge', 'squash', 'rebase']).default('squash').describe('Merge method'),
    },
    async ({ prNumber, method }) => {
      await container.github.mergePR(container.config.repoName, prNumber, method);
      return { content: [{ type: 'text' as const, text: `PR #${prNumber} merged via ${method}.` }] };
    },
  );

  mcp.tool(
    'mfh_get_session_output',
    'Read recent terminal output from a tmux session. Use this to see what a worker Claude is doing.',
    {
      sessionId: z.string().describe('Tmux session ID (e.g. pr-123)'),
      lines: z.number().optional().default(200).describe('Number of lines to capture'),
    },
    async ({ sessionId, lines }) => {
      const output = await container.tmux.capturePane(sessionId, lines);
      return { content: [{ type: 'text' as const, text: output }] };
    },
  );

  mcp.tool(
    'mfh_resume_session',
    'Resume Claude in an existing tmux session using a stored session ID',
    {
      sessionId: z.string().describe('Tmux session ID (e.g. pr-123)'),
      claudeSessionId: z.string().describe('Claude session ID to resume'),
      skipPermissions: z.boolean().optional().describe('Pass --dangerously-skip-permissions'),
    },
    async ({ sessionId, claudeSessionId, skipPermissions }) => {
      await container.handover.resume(sessionId, claudeSessionId, skipPermissions);
      return { content: [{ type: 'text' as const, text: `Resumed Claude session ${claudeSessionId} in ${sessionId}.` }] };
    },
  );

  mcp.tool(
    'mfh_send_keys',
    'Send text to a tmux session (followed by Enter). Use this to talk to a worker Claude.',
    {
      sessionId: z.string().describe('Tmux session ID (e.g. pr-123)'),
      keys: z.string().describe('Text to send (Enter is appended automatically)'),
    },
    async ({ sessionId, keys }) => {
      await container.tmux.sendKeys(sessionId, keys);
      return { content: [{ type: 'text' as const, text: `Sent to ${sessionId}.` }] };
    },
  );

  // -------------------------------------------------------------------------
  // Transport — stateless Streamable HTTP (one shared instance)
  // -------------------------------------------------------------------------

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  mcp.connect(transport).then(
    () => logger.appendLine('[mcp] MCP server connected to transport'),
    (err) => logger.appendLine(`[mcp] Failed to connect: ${err}`),
  );

  return {
    handleRequest: (req, res) => transport.handleRequest(req, res),
  };
}
