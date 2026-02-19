/**
 * TmuxService — async spawn-based wrapper around the tmux CLI.
 *
 * Every method delegates to `run` / `runSafe` from `../lib/run` so that
 * command execution is logged, timed, and free of shell interpolation.
 *
 * VS Code's integrated terminal handles `tmux attach-session` directly,
 * so this service intentionally omits an `attach()` method.
 */

import { run, runSafe } from '../lib/run';
import type { TmuxSession } from '../interfaces';
import { TmuxError } from '../errors';

const SESSION_FORMAT =
  '#{session_name}|#{pane_current_path}|#{session_created}|#{session_attached}';

function parseSessionLine(line: string): TmuxSession {
  const [name, path, created, attached] = line.split('|');
  return {
    id: name,
    workingDir: path,
    created: new Date(parseInt(created, 10) * 1000),
    attached: attached === '1',
  };
}

export class TmuxService {
  /**
   * List tmux sessions whose names start with `prefix`.
   * Pass an empty string to list all sessions.
   */
  async list(prefix: string): Promise<TmuxSession[]> {
    const result = await runSafe('tmux', [
      'list-sessions',
      '-F',
      SESSION_FORMAT,
    ]);

    if (result.exitCode !== 0 || !result.stdout) {
      return [];
    }

    return result.stdout
      .split('\n')
      .filter((line) => line.startsWith(prefix))
      .map(parseSessionLine);
  }

  /**
   * Get a single session by exact id.  Returns `null` when the session does
   * not exist.
   */
  async get(id: string): Promise<TmuxSession | null> {
    const result = await runSafe('tmux', [
      'list-sessions',
      '-F',
      SESSION_FORMAT,
      '-f',
      `#{==:#{session_name},${id}}`,
    ]);

    if (result.exitCode !== 0 || !result.stdout) {
      return null;
    }

    return parseSessionLine(result.stdout);
  }

  /**
   * Check whether a session with the given id exists.
   */
  async exists(id: string): Promise<boolean> {
    const result = await runSafe('tmux', ['has-session', '-t', id]);
    return result.exitCode === 0;
  }

  /**
   * Create a new detached tmux session.
   */
  async create(params: {
    id: string;
    workingDir: string;
    command?: string;
  }): Promise<TmuxSession> {
    const args = [
      'new-session',
      '-d',
      '-s',
      params.id,
      '-c',
      params.workingDir,
    ];

    if (params.command) {
      args.push(params.command);
    }

    await run('tmux', args);

    const session = await this.get(params.id);
    if (!session) {
      throw new TmuxError(`Failed to create session ${params.id}`);
    }
    return session;
  }

  /**
   * Kill (destroy) a tmux session.
   */
  async kill(id: string): Promise<void> {
    await run('tmux', ['kill-session', '-t', id]);
  }

  /**
   * Send keystrokes to a tmux session followed by Enter.
   * The entire `keys` string is passed as a single argument so that
   * spaces and special characters are preserved without shell escaping.
   */
  async sendKeys(id: string, keys: string): Promise<void> {
    await run('tmux', ['send-keys', '-t', id, keys, 'Enter']);
  }

  /**
   * Capture recent terminal output from a tmux pane.
   *
   * Returns the last `lines` lines of visible + scrollback content,
   * with ANSI escape codes stripped and repeated blank lines collapsed
   * so the output reads as clean prose.
   */
  async capturePane(id: string, lines = 200): Promise<string> {
    const result = await runSafe('tmux', [
      'capture-pane',
      '-t', id,
      '-p',
      '-S', `-${lines}`,
    ]);

    if (result.exitCode !== 0) {
      throw new TmuxError(`Failed to capture pane for session ${id}: ${result.stderr}`);
    }

    return stripAnsi(result.stdout);
  }

  /**
   * Detach all connected tmux clients.
   * Used by focus-switching to unblock a script's `tmux attach` call.
   */
  async detachAllClients(): Promise<void> {
    const result = await runSafe('tmux', [
      'list-clients', '-F', '#{client_name}',
    ]);

    if (result.exitCode !== 0 || !result.stdout) {
      return;
    }

    for (const client of result.stdout.split('\n').filter(Boolean)) {
      await runSafe('tmux', ['detach-client', '-t', client]);
    }
  }

  /**
   * Get the current foreground command running in a tmux pane.
   * Returns the process name (e.g. 'claude', 'node', 'bash', 'zsh').
   * Returns null if the session does not exist.
   */
  async getPaneCommand(id: string): Promise<string | null> {
    const result = await runSafe('tmux', [
      'display-message',
      '-t', id,
      '-p', '#{pane_current_command}',
    ]);

    if (result.exitCode !== 0 || !result.stdout) {
      return null;
    }

    return result.stdout;
  }
}

/**
 * Strip ANSI escape codes and collapse repeated blank lines.
 */
function stripAnsi(text: string): string {
  // Remove ANSI escape sequences (colors, cursor movement, etc.)
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  // Collapse runs of 3+ blank lines into 2
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}
