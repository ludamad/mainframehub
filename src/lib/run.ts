/**
 * Process execution utilities for the MainframeHub VS Code extension.
 *
 * All external tool invocations (tmux, git, gh, claude) go through `run` or
 * `runSafe`.  Every call is logged to a VS Code OutputChannel (when one has
 * been registered via `setRunLogger`) with wall-clock timing so users can
 * diagnose slow or failing commands from the "MainframeHub" output panel.
 *
 * Key design choices:
 *   - `spawn` with argument arrays — no shell interpolation, no injection.
 *   - `run` rejects with a typed `RunError` on non-zero exit.
 *   - `runSafe` always resolves with `{ stdout, stderr, exitCode }`.
 */

import { spawn } from 'child_process';
import type { OutputChannel } from 'vscode';
import type { RunOptions, RunResult } from '../interfaces';
import { RunError } from '../errors';

const DEFAULT_TIMEOUT = 30_000;

let logger: OutputChannel | null = null;

/**
 * Register a VS Code OutputChannel for command logging.
 * Call once at activation with the extension's output channel.
 */
export function setRunLogger(channel: OutputChannel): void {
  logger = channel;
}

function log(message: string): void {
  if (!logger) {
    return;
  }
  const ts = new Date().toISOString();
  logger.appendLine(`[${ts}] ${message}`);
}

/**
 * Run a command and reject with `RunError` on non-zero exit code.
 * Returns trimmed stdout on success.
 */
export async function run(
  cmd: string,
  args: readonly string[],
  opts?: RunOptions,
): Promise<string> {
  const result = await runSafe(cmd, args, opts);
  if (result.exitCode !== 0) {
    throw new RunError(cmd, args, result.exitCode, result.stdout, result.stderr);
  }
  return result.stdout;
}

/**
 * Run a command and always resolve.
 * Returns `{ stdout, stderr, exitCode }` regardless of exit code.
 */
export function runSafe(
  cmd: string,
  args: readonly string[],
  opts?: RunOptions,
): Promise<RunResult> {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  const label = `${cmd} ${args.join(' ')}`;

  log(`> ${label}${opts?.cwd ? `  (cwd: ${opts.cwd})` : ''}`);

  const start = Date.now();

  return new Promise<RunResult>((resolve) => {
    const proc = spawn(cmd, args as string[], {
      cwd: opts?.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err: Error) => {
      const elapsed = Date.now() - start;
      log(`  ERROR (${elapsed}ms): ${err.message}`);
      // Treat spawn errors (e.g. ENOENT) as exit code 1
      resolve({ stdout: stdout.trim(), stderr: err.message, exitCode: 1 });
    });

    proc.on('close', (code: number | null) => {
      const elapsed = Date.now() - start;
      const exitCode = code ?? 1;
      log(`  exit ${exitCode} (${elapsed}ms)`);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode });
    });
  });
}
