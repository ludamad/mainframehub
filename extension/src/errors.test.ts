import { describe, it, expect } from 'vitest';
import {
  MfhError,
  RunError,
  GitError,
  TmuxError,
  GitHubError,
  ClaudeError,
} from './errors';

describe('MfhError', () => {
  it('sets message and name', () => {
    const err = new MfhError('something broke');
    expect(err.message).toBe('something broke');
    expect(err.name).toBe('MfhError');
  });

  it('is an instance of Error', () => {
    expect(new MfhError('x')).toBeInstanceOf(Error);
  });

  it('stores context when provided', () => {
    const ctx = { key: 'value' };
    const err = new MfhError('msg', ctx);
    expect(err.context).toEqual({ key: 'value' });
  });

  it('has undefined context when not provided', () => {
    const err = new MfhError('msg');
    expect(err.context).toBeUndefined();
  });
});

describe('RunError', () => {
  const err = new RunError('git', ['push', 'origin'], 1, 'out', 'err msg');

  it('stores command properties', () => {
    expect(err.cmd).toBe('git');
    expect(err.args).toEqual(['push', 'origin']);
    expect(err.exitCode).toBe(1);
    expect(err.stdout).toBe('out');
    expect(err.stderr).toBe('err msg');
  });

  it('has name RunError', () => {
    expect(err.name).toBe('RunError');
  });

  it('formats message with command details', () => {
    expect(err.message).toBe(
      'Command failed: git push origin (exit 1)\nerr msg',
    );
  });

  it('is an instance of MfhError', () => {
    expect(err).toBeInstanceOf(MfhError);
  });

  it('sets context with cmd, args, and exitCode', () => {
    expect(err.context).toEqual({
      cmd: 'git',
      args: ['push', 'origin'],
      exitCode: 1,
    });
  });
});

describe.each([
  { ErrorClass: GitError, name: 'GitError' },
  { ErrorClass: TmuxError, name: 'TmuxError' },
  { ErrorClass: GitHubError, name: 'GitHubError' },
  { ErrorClass: ClaudeError, name: 'ClaudeError' },
])('$name', ({ ErrorClass, name }) => {
  it('has correct name', () => {
    const err = new ErrorClass('fail');
    expect(err.name).toBe(name);
  });

  it('is an instance of MfhError', () => {
    expect(new ErrorClass('fail')).toBeInstanceOf(MfhError);
  });
});
