/**
 * Error hierarchy for the MainframeHub VS Code extension.
 *
 * Every custom error extends MfhError so callers can catch the whole family
 * with a single `instanceof MfhError` check.  RunError carries full command
 * output for logging; the domain-specific errors (Git, Tmux, GitHub, Claude)
 * carry an optional context bag for structured diagnostics.
 */

export class MfhError extends Error {
  constructor(
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MfhError';
  }
}

export class RunError extends MfhError {
  override name = 'RunError';

  constructor(
    public cmd: string,
    public args: readonly string[],
    public exitCode: number,
    public stdout: string,
    public stderr: string,
  ) {
    super(
      `Command failed: ${cmd} ${args.join(' ')} (exit ${exitCode})\n${stderr}`,
      { cmd, args, exitCode },
    );
  }
}

export class GitError extends MfhError {
  override name = 'GitError';
}

export class TmuxError extends MfhError {
  override name = 'TmuxError';
}

export class GitHubError extends MfhError {
  override name = 'GitHubError';
}

export class ClaudeError extends MfhError {
  override name = 'ClaudeError';
}
