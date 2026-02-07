import { describe, it, expect, vi, beforeEach } from 'vitest';
import { run, runSafe } from '../lib/run';
import type { TmuxSession } from '../interfaces';

vi.mock('../lib/run');

const SESSION_FORMAT =
  '#{session_name}|#{pane_current_path}|#{session_created}|#{session_attached}';

const mockedRun = vi.mocked(run);
const mockedRunSafe = vi.mocked(runSafe);

// Lazy import so the mock is in place before the module loads
const { TmuxService } = await import('./tmux');

describe('TmuxService', () => {
  let svc: InstanceType<typeof TmuxService>;

  beforeEach(() => {
    vi.restoreAllMocks();
    svc = new TmuxService();
  });

  describe('list', () => {
    it('returns parsed sessions filtered by prefix', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout:
          'pr-1|/home/user/pr1|1700000000|1\npr-2|/home/user/pr2|1700000100|0\nother|/tmp|1700000200|0',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.list('pr-');

      expect(mockedRunSafe).toHaveBeenCalledWith('tmux', [
        'list-sessions',
        '-F',
        SESSION_FORMAT,
      ]);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'pr-1',
        workingDir: '/home/user/pr1',
        created: new Date(1700000000 * 1000),
        attached: true,
      });
      expect(result[1]).toEqual({
        id: 'pr-2',
        workingDir: '/home/user/pr2',
        created: new Date(1700000100 * 1000),
        attached: false,
      });
    });

    it('returns all sessions when prefix is empty', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: 'a|/a|1700000000|0\nb|/b|1700000000|1',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.list('');

      expect(result).toHaveLength(2);
    });

    it('returns empty array when exitCode is non-zero', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: '',
        stderr: 'no server running',
        exitCode: 1,
      });

      const result = await svc.list('pr-');

      expect(result).toEqual([]);
    });

    it('returns empty array when stdout is empty', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.list('pr-');

      expect(result).toEqual([]);
    });
  });

  describe('get', () => {
    it('returns parsed session when found', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: 'pr-42|/home/user/pr42|1700000000|1',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.get('pr-42');

      expect(mockedRunSafe).toHaveBeenCalledWith('tmux', [
        'list-sessions',
        '-F',
        SESSION_FORMAT,
        '-f',
        '#{==:#{session_name},pr-42}',
      ]);
      expect(result).toEqual({
        id: 'pr-42',
        workingDir: '/home/user/pr42',
        created: new Date(1700000000 * 1000),
        attached: true,
      });
    });

    it('returns null when session does not exist', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const result = await svc.get('pr-999');

      expect(result).toBeNull();
    });

    it('returns null when stdout is empty with exitCode 0', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.get('pr-999');

      expect(result).toBeNull();
    });
  });

  describe('exists', () => {
    it('returns true when session exists', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.exists('pr-1');

      expect(mockedRunSafe).toHaveBeenCalledWith('tmux', [
        'has-session',
        '-t',
        'pr-1',
      ]);
      expect(result).toBe(true);
    });

    it('returns false when session does not exist', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: '',
        stderr: 'no session',
        exitCode: 1,
      });

      const result = await svc.exists('pr-999');

      expect(result).toBe(false);
    });
  });

  describe('create', () => {
    it('creates session without command and returns it', async () => {
      mockedRun.mockResolvedValue('');
      mockedRunSafe.mockResolvedValue({
        stdout: 'pr-5|/home/user/pr5|1700000000|0',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.create({
        id: 'pr-5',
        workingDir: '/home/user/pr5',
      });

      expect(mockedRun).toHaveBeenCalledWith('tmux', [
        'new-session',
        '-d',
        '-s',
        'pr-5',
        '-c',
        '/home/user/pr5',
      ]);
      expect(result.id).toBe('pr-5');
    });

    it('creates session with command', async () => {
      mockedRun.mockResolvedValue('');
      mockedRunSafe.mockResolvedValue({
        stdout: 'pr-6|/home/user/pr6|1700000000|0',
        stderr: '',
        exitCode: 0,
      });

      await svc.create({
        id: 'pr-6',
        workingDir: '/home/user/pr6',
        command: 'vim',
      });

      expect(mockedRun).toHaveBeenCalledWith('tmux', [
        'new-session',
        '-d',
        '-s',
        'pr-6',
        '-c',
        '/home/user/pr6',
        'vim',
      ]);
    });

    it('throws TmuxError when session cannot be retrieved after creation', async () => {
      mockedRun.mockResolvedValue('');
      mockedRunSafe.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      await expect(
        svc.create({ id: 'pr-7', workingDir: '/tmp' }),
      ).rejects.toThrow('Failed to create session pr-7');
    });
  });

  describe('kill', () => {
    it('kills session by id', async () => {
      mockedRun.mockResolvedValue('');

      await svc.kill('pr-1');

      expect(mockedRun).toHaveBeenCalledWith('tmux', [
        'kill-session',
        '-t',
        'pr-1',
      ]);
    });
  });

  describe('sendKeys', () => {
    it('sends keys followed by Enter', async () => {
      mockedRun.mockResolvedValue('');

      await svc.sendKeys('pr-1', 'echo hello');

      expect(mockedRun).toHaveBeenCalledWith('tmux', [
        'send-keys',
        '-t',
        'pr-1',
        'echo hello',
        'Enter',
      ]);
    });
  });
});
