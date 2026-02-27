import { describe, it, expect, vi, beforeEach } from 'vitest';
import { run, runSafe } from '../lib/run';

vi.mock('../lib/run');

const mockedRun = vi.mocked(run);
const mockedRunSafe = vi.mocked(runSafe);

const { ClaudeService } = await import('./claude');

describe('ClaudeService', () => {
  let svc: InstanceType<typeof ClaudeService>;

  beforeEach(() => {
    vi.restoreAllMocks();
    svc = new ClaudeService();
  });

  describe('generateMetadata', () => {
    it('parses valid Claude response', async () => {
      mockedRun.mockResolvedValue(
        'BRANCH: ad/feat/test\nTITLE: feat: test feature\nBODY: Implements the test feature for validation',
      );

      const result = await svc.generateMetadata('add test feature');

      expect(mockedRun).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', expect.stringContaining('add test feature'), '--model', 'haiku']),
        { timeout: 30_000 },
      );
      expect(result).toEqual({
        branchName: 'ad/feat/test',
        title: 'feat: test feature',
        body: 'Implements the test feature for validation',
      });
    });

    it('uses specified model', async () => {
      mockedRun.mockResolvedValue(
        'BRANCH: ad/fix/bug\nTITLE: fix: bug\nBODY: Fixes the bug',
      );

      await svc.generateMetadata('fix bug', { model: 'sonnet' });

      expect(mockedRun).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--model', 'sonnet']),
        { timeout: 30_000 },
      );
    });

    it('truncates title to 72 characters', async () => {
      const longTitle = 'feat: ' + 'a'.repeat(100);
      mockedRun.mockResolvedValue(
        `BRANCH: ad/feat/long\nTITLE: ${longTitle}\nBODY: Body text`,
      );

      const result = await svc.generateMetadata('long feature');

      expect(result.title.length).toBeLessThanOrEqual(72);
    });

    it('returns fallback when run throws', async () => {
      mockedRun.mockRejectedValue(new Error('command not found'));

      const result = await svc.generateMetadata('add auth');

      expect(result.branchName).toMatch(/^ad\/feat\/task-\d+$/);
      expect(result.title).toMatch(/^feat: add auth/);
      expect(result.body).toBe('Working on: add auth');
    });

    it('returns fallback when response cannot be parsed', async () => {
      mockedRun.mockResolvedValue('some garbage output without labels');

      const result = await svc.generateMetadata('implement caching');

      expect(result.branchName).toMatch(/^ad\/feat\/task-\d+$/);
      expect(result.title).toMatch(/^feat: implement caching/);
      expect(result.body).toBe('Working on: implement caching');
    });

    it('returns fallback with truncated first sentence as title', async () => {
      mockedRun.mockRejectedValue(new Error('fail'));

      const result = await svc.generateMetadata(
        'Fix the authentication bug. Also update docs.',
      );

      expect(result.title).toBe('feat: Fix the authentication bug');
    });

    it('includes guidelines in prompt when provided', async () => {
      mockedRun.mockResolvedValue(
        'BRANCH: ad/feat/x\nTITLE: feat: x\nBODY: Does x',
      );

      await svc.generateMetadata('task', {
        guidelines: 'Use conventional commits',
      });

      expect(mockedRun).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '-p',
          expect.stringContaining('Use conventional commits'),
        ]),
        { timeout: 30_000 },
      );
    });
  });

  describe('isAvailable', () => {
    it('returns true when claude is on PATH', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: '/usr/local/bin/claude',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.isAvailable();

      expect(mockedRunSafe).toHaveBeenCalledWith('which', ['claude']);
      expect(result).toBe(true);
    });

    it('returns false when claude is not on PATH', async () => {
      mockedRunSafe.mockResolvedValue({
        stdout: '',
        stderr: 'claude not found',
        exitCode: 1,
      });

      const result = await svc.isAvailable();

      expect(result).toBe(false);
    });
  });
});
