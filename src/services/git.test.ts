import { describe, it, expect, vi, beforeEach } from 'vitest';
import { run, runSafe } from '../lib/run';
import { parseRepo } from '../interfaces';

vi.mock('../lib/run');

const mockedRun = vi.mocked(run);
const mockedRunSafe = vi.mocked(runSafe);

const { GitService } = await import('./git');

describe('GitService', () => {
  let svc: InstanceType<typeof GitService>;

  beforeEach(() => {
    vi.restoreAllMocks();
    svc = new GitService();
  });

  describe('clone', () => {
    it('clones with url and target only', async () => {
      mockedRun.mockResolvedValue('');

      await svc.clone('https://github.com/o/r.git', '/tmp/r');

      expect(mockedRun).toHaveBeenCalledWith('git', [
        'clone',
        'https://github.com/o/r.git',
        '/tmp/r',
      ]);
    });

    it('clones with branch option', async () => {
      mockedRun.mockResolvedValue('');

      await svc.clone('https://github.com/o/r.git', '/tmp/r', {
        branch: 'dev',
      });

      expect(mockedRun).toHaveBeenCalledWith('git', [
        'clone',
        '--branch',
        'dev',
        'https://github.com/o/r.git',
        '/tmp/r',
      ]);
    });

    it('clones with depth option', async () => {
      mockedRun.mockResolvedValue('');

      await svc.clone('https://github.com/o/r.git', '/tmp/r', { depth: 1 });

      expect(mockedRun).toHaveBeenCalledWith('git', [
        'clone',
        '--depth',
        '1',
        'https://github.com/o/r.git',
        '/tmp/r',
      ]);
    });

    it('clones with both branch and depth', async () => {
      mockedRun.mockResolvedValue('');

      await svc.clone('https://github.com/o/r.git', '/tmp/r', {
        branch: 'feat',
        depth: 5,
      });

      expect(mockedRun).toHaveBeenCalledWith('git', [
        'clone',
        '--depth',
        '5',
        '--branch',
        'feat',
        'https://github.com/o/r.git',
        '/tmp/r',
      ]);
    });
  });

  describe('createBranch', () => {
    it('creates a branch with cwd', async () => {
      mockedRun.mockResolvedValue('');

      await svc.createBranch('/repo', 'my-branch');

      expect(mockedRun).toHaveBeenCalledWith('git', ['branch', 'my-branch'], {
        cwd: '/repo',
      });
    });
  });

  describe('checkout', () => {
    it('checks out a branch with cwd', async () => {
      mockedRun.mockResolvedValue('');

      await svc.checkout('/repo', 'main');

      expect(mockedRun).toHaveBeenCalledWith('git', ['checkout', 'main'], {
        cwd: '/repo',
      });
    });
  });

  describe('commit', () => {
    it('creates a commit with message', async () => {
      mockedRun.mockResolvedValue('');

      await svc.commit('/repo', 'fix: stuff');

      expect(mockedRun).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'fix: stuff'],
        { cwd: '/repo' },
      );
    });

    it('creates a commit with allowEmpty', async () => {
      mockedRun.mockResolvedValue('');

      await svc.commit('/repo', 'init', { allowEmpty: true });

      expect(mockedRun).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'init', '--allow-empty'],
        { cwd: '/repo' },
      );
    });
  });

  describe('push', () => {
    it('pushes with no options', async () => {
      mockedRun.mockResolvedValue('');

      await svc.push('/repo');

      expect(mockedRun).toHaveBeenCalledWith('git', ['push'], {
        cwd: '/repo',
      });
    });

    it('pushes with setUpstream and branch', async () => {
      mockedRun.mockResolvedValue('');

      await svc.push('/repo', { setUpstream: true, branch: 'feat' });

      expect(mockedRun).toHaveBeenCalledWith(
        'git',
        ['push', '--set-upstream', 'origin', 'feat'],
        { cwd: '/repo' },
      );
    });

    it('pushes with force', async () => {
      mockedRun.mockResolvedValue('');

      await svc.push('/repo', { force: true });

      expect(mockedRun).toHaveBeenCalledWith(
        'git',
        ['push', '--force-with-lease'],
        { cwd: '/repo' },
      );
    });

    it('pushes with force and setUpstream', async () => {
      mockedRun.mockResolvedValue('');

      await svc.push('/repo', {
        force: true,
        setUpstream: true,
        branch: 'dev',
      });

      expect(mockedRun).toHaveBeenCalledWith(
        'git',
        ['push', '--force-with-lease', '--set-upstream', 'origin', 'dev'],
        { cwd: '/repo' },
      );
    });
  });

  describe('listBranches', () => {
    it('returns branch names without origin/ prefix and HEAD', async () => {
      mockedRun.mockResolvedValue(
        '  origin/main\n  origin/feat\n  origin/HEAD -> origin/main\n',
      );

      const result = await svc.listBranches('/repo');

      expect(mockedRun).toHaveBeenCalledWith('git', ['branch', '-r'], {
        cwd: '/repo',
      });
      expect(result).toEqual(['main', 'feat']);
    });

    it('returns empty array when no branches', async () => {
      mockedRun.mockResolvedValue('');

      const result = await svc.listBranches('/repo');

      expect(result).toEqual([]);
    });
  });

  describe('getStatus', () => {
    it('returns clean status with ahead/behind counts', async () => {
      mockedRun.mockResolvedValue('');
      mockedRunSafe.mockResolvedValue({
        stdout: '2\t3',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.getStatus('/repo');

      expect(mockedRun).toHaveBeenCalledWith('git', ['status', '--porcelain'], {
        cwd: '/repo',
      });
      expect(mockedRunSafe).toHaveBeenCalledWith(
        'git',
        ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
        { cwd: '/repo' },
      );
      expect(result).toEqual({ isDirty: false, behind: 2, ahead: 3 });
    });

    it('returns dirty status when porcelain has output', async () => {
      mockedRun.mockResolvedValue(' M src/main.ts');
      mockedRunSafe.mockResolvedValue({
        stdout: '0\t0',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.getStatus('/repo');

      expect(result.isDirty).toBe(true);
    });

    it('returns zero ahead/behind when rev-list fails', async () => {
      mockedRun.mockResolvedValue('');
      mockedRunSafe.mockResolvedValue({
        stdout: '',
        stderr: 'no upstream',
        exitCode: 128,
      });

      const result = await svc.getStatus('/repo');

      expect(result).toEqual({ isDirty: false, ahead: 0, behind: 0 });
    });
  });

  describe('getInfo', () => {
    it('aggregates remote, branch, and status', async () => {
      // Call order: getRemote, getBranch, getStatus (porcelain), getStatus (rev-list)
      mockedRun
        .mockResolvedValueOnce('https://github.com/owner/repo.git') // getRemote
        .mockResolvedValueOnce('feat-branch') // getBranch
        .mockResolvedValueOnce(''); // getStatus porcelain
      mockedRunSafe.mockResolvedValue({
        stdout: '1\t2',
        stderr: '',
        exitCode: 0,
      });

      const result = await svc.getInfo('/repo');

      expect(result).toEqual({
        remote: 'https://github.com/owner/repo.git',
        repo: 'owner/repo',
        branch: 'feat-branch',
        isDirty: false,
        behind: 1,
        ahead: 2,
      });
    });

    it('throws when HEAD is detached', async () => {
      mockedRun
        .mockResolvedValueOnce('https://github.com/owner/repo.git')
        .mockResolvedValueOnce('HEAD');

      await expect(svc.getInfo('/repo')).rejects.toThrow(
        'HEAD is in detached state',
      );
    });
  });
});
