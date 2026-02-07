import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscoveryService } from './discovery';
import type { TmuxService } from './tmux';
import type { GitService } from './git';
import type { GitHubService } from './github';
import type { TmuxSession, GitInfo, PullRequest } from '../interfaces';

function makeSession(overrides: Partial<TmuxSession> & { id: string }): TmuxSession {
  return {
    workingDir: `/clones/${overrides.id}`,
    created: new Date(),
    attached: false,
    ...overrides,
  };
}

function makeGitInfo(overrides: Partial<GitInfo> & { branch: string }): GitInfo {
  return {
    remote: 'https://github.com/owner/repo.git',
    repo: 'owner/repo',
    isDirty: false,
    ahead: 0,
    behind: 0,
    ...overrides,
  };
}

function makePR(overrides: Partial<PullRequest> & { number: number; branch: string }): PullRequest {
  return {
    title: `PR #${overrides.number}`,
    baseBranch: 'main',
    repo: 'owner/repo',
    state: 'OPEN',
    url: '',
    author: 'user',
    isDraft: false,
    created: new Date(),
    updated: new Date(),
    ...overrides,
  };
}

describe('DiscoveryService', () => {
  const tmux = { list: vi.fn(), get: vi.fn() } as unknown as TmuxService;
  const git = { getInfo: vi.fn() } as unknown as GitService;
  const github = { listPRs: vi.fn(), findPR: vi.fn() } as unknown as GitHubService;
  const logger = { appendLine: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('discover', () => {
    const session123 = makeSession({ id: 'pr-123', attached: true });
    const session456 = makeSession({ id: 'pr-456', attached: false });
    const gitInfo123 = makeGitInfo({ branch: 'feat/auth' });
    const gitInfo456 = makeGitInfo({ branch: 'fix/bug' });
    const pr123 = makePR({ number: 123, branch: 'feat/auth', title: 'Auth' });

    function setupDefaults() {
      vi.mocked(tmux.list).mockResolvedValue([session123, session456]);

      vi.mocked(git.getInfo).mockImplementation(async (dir: string) => {
        if (dir === session123.workingDir) return gitInfo123;
        if (dir === session456.workingDir) return gitInfo456;
        throw new Error(`Unexpected dir: ${dir}`);
      });

      vi.mocked(github.listPRs).mockResolvedValue([pr123]);
    }

    it('discovers sessions and matches PRs by branch', async () => {
      setupDefaults();
      const svc = new DiscoveryService(tmux, git, github, 'pr-', logger);

      const results = await svc.discover();

      expect(results).toHaveLength(2);
      expect(results[0].pr).toEqual(pr123);
      expect(results[1].pr).toBeNull();
    });

    it('returns correct SessionState fields', async () => {
      setupDefaults();
      const svc = new DiscoveryService(tmux, git, github, 'pr-', logger);

      const results = await svc.discover();

      expect(results[0]).toEqual({
        session: session123,
        gitInfo: gitInfo123,
        pr: pr123,
        hasGit: true,
        hasPR: true,
        isActive: true,
      });

      expect(results[1]).toEqual({
        session: session456,
        gitInfo: gitInfo456,
        pr: null,
        hasGit: true,
        hasPR: false,
        isActive: false,
      });
    });

    it('calls listPRs once per unique repo', async () => {
      setupDefaults();
      const svc = new DiscoveryService(tmux, git, github, 'pr-', logger);

      await svc.discover();

      expect(github.listPRs).toHaveBeenCalledTimes(1);
      expect(github.listPRs).toHaveBeenCalledWith('owner/repo', { state: 'open' });
    });

    it('handles session without git gracefully', async () => {
      vi.mocked(tmux.list).mockResolvedValue([session123]);
      vi.mocked(git.getInfo).mockRejectedValue(new Error('not a git repo'));

      const svc = new DiscoveryService(tmux, git, github, 'pr-', logger);

      const results = await svc.discover();

      expect(results).toHaveLength(1);
      expect(results[0].hasGit).toBe(false);
      expect(results[0].hasPR).toBe(false);
      expect(results[0].gitInfo).toBeNull();
      expect(results[0].pr).toBeNull();
      expect(github.listPRs).not.toHaveBeenCalled();
    });
  });

  describe('discoverOne', () => {
    it('returns SessionState with git info and PR match', async () => {
      const session = makeSession({ id: 'pr-10', attached: true });
      const gitInfo = makeGitInfo({ branch: 'feat/login' });
      const pr = makePR({ number: 10, branch: 'feat/login' });

      vi.mocked(git.getInfo).mockResolvedValue(gitInfo);
      vi.mocked(github.findPR).mockResolvedValue(pr);

      const svc = new DiscoveryService(tmux, git, github, 'pr-', logger);

      const result = await svc.discoverOne(session);

      expect(result).toEqual({
        session,
        gitInfo,
        pr,
        hasGit: true,
        hasPR: true,
        isActive: true,
      });
      expect(github.findPR).toHaveBeenCalledWith({
        repo: 'owner/repo',
        branch: 'feat/login',
      });
    });

    it('returns hasPR=false when findPR returns null', async () => {
      const session = makeSession({ id: 'pr-20', attached: false });
      const gitInfo = makeGitInfo({ branch: 'orphan-branch' });

      vi.mocked(git.getInfo).mockResolvedValue(gitInfo);
      vi.mocked(github.findPR).mockResolvedValue(null);

      const svc = new DiscoveryService(tmux, git, github, 'pr-', logger);

      const result = await svc.discoverOne(session);

      expect(result.hasGit).toBe(true);
      expect(result.hasPR).toBe(false);
      expect(result.pr).toBeNull();
    });

    it('returns hasGit=false when getInfo throws', async () => {
      const session = makeSession({ id: 'no-git', attached: false });

      vi.mocked(git.getInfo).mockRejectedValue(new Error('not a git repo'));

      const svc = new DiscoveryService(tmux, git, github, 'pr-', logger);

      const result = await svc.discoverOne(session);

      expect(result.hasGit).toBe(false);
      expect(result.hasPR).toBe(false);
      expect(result.gitInfo).toBeNull();
      expect(result.pr).toBeNull();
      expect(github.findPR).not.toHaveBeenCalled();
    });
  });

  describe('getByPRNumber', () => {
    it('finds session with pr-N naming', async () => {
      const session = makeSession({ id: 'pr-123', attached: true });
      const gitInfo = makeGitInfo({ branch: 'feat/auth' });
      const pr = makePR({ number: 123, branch: 'feat/auth' });

      vi.mocked(tmux.get).mockResolvedValue(session);
      vi.mocked(git.getInfo).mockResolvedValue(gitInfo);
      vi.mocked(github.findPR).mockResolvedValue(pr);

      const svc = new DiscoveryService(tmux, git, github, 'pr-', logger);

      const result = await svc.getByPRNumber(123);

      expect(tmux.get).toHaveBeenCalledWith('pr-123');
      expect(result).not.toBeNull();
      expect(result!.session).toEqual(session);
      expect(result!.hasPR).toBe(true);
    });

    it('falls back to legacy prefix naming', async () => {
      const session = makeSession({ id: 'mfh-42', attached: false });
      const gitInfo = makeGitInfo({ branch: 'fix/typo' });

      vi.mocked(tmux.get)
        .mockResolvedValueOnce(null)   // pr-42 not found
        .mockResolvedValueOnce(session); // mfh-42 found

      vi.mocked(git.getInfo).mockResolvedValue(gitInfo);
      vi.mocked(github.findPR).mockResolvedValue(null);

      const svc = new DiscoveryService(tmux, git, github, 'mfh-', logger);

      const result = await svc.getByPRNumber(42);

      expect(tmux.get).toHaveBeenNthCalledWith(1, 'pr-42');
      expect(tmux.get).toHaveBeenNthCalledWith(2, 'mfh-42');
      expect(result).not.toBeNull();
      expect(result!.session).toEqual(session);
    });

    it('returns null when no session found', async () => {
      vi.mocked(tmux.get).mockResolvedValue(null);

      const svc = new DiscoveryService(tmux, git, github, 'mfh-', logger);

      const result = await svc.getByPRNumber(999);

      expect(result).toBeNull();
      expect(tmux.get).toHaveBeenCalledTimes(2);
    });
  });
});
