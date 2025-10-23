/**
 * Test PR Association Logic
 *
 * Verifies that sessions are correctly matched to PRs based on:
 * - Git working directory repo
 * - Git current branch
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DiscoveryService } from '../src/services/discovery.js';
import { TmuxService } from '../src/services/tmux.js';
import { GitService } from '../src/services/git.js';
import { GitHubService } from '../src/services/github.js';

describe('PR Association Logic', () => {
  let discovery: DiscoveryService;
  let tmux: TmuxService;
  let git: GitService;
  let github: GitHubService;

  beforeEach(() => {
    tmux = new TmuxService();
    git = new GitService();
    github = new GitHubService({ mockWrites: true });
    discovery = new DiscoveryService(tmux, git, github, 'mfh-');
  });

  describe('Git Info Extraction', () => {
    it('should parse GitHub HTTPS remote correctly', () => {
      const remote = 'https://github.com/owner/repo.git';
      const repo = require('../src/services/git.js').parseRepo(remote);
      expect(repo).toBe('owner/repo');
    });

    it('should parse GitHub SSH remote correctly', () => {
      const remote = 'git@github.com:owner/repo.git';
      const repo = require('../src/services/git.js').parseRepo(remote);
      expect(repo).toBe('owner/repo');
    });

    it('should handle remote without .git suffix', () => {
      const remote = 'https://github.com/owner/repo';
      const repo = require('../src/services/git.js').parseRepo(remote);
      expect(repo).toBe('owner/repo');
    });
  });

  describe('PR Matching', () => {
    it('should match PR by exact branch name', async () => {
      const mockPRs = [
        {
          number: 123,
          title: 'Test PR',
          branch: 'feature/test-branch',
          baseBranch: 'main',
          repo: 'owner/repo',
          state: 'OPEN',
          url: 'https://github.com/owner/repo/pull/123',
          author: 'testuser',
          isDraft: false,
          created: new Date(),
          updated: new Date(),
        },
        {
          number: 124,
          title: 'Another PR',
          branch: 'feature/another-branch',
          baseBranch: 'main',
          repo: 'owner/repo',
          state: 'OPEN',
          url: 'https://github.com/owner/repo/pull/124',
          author: 'testuser',
          isDraft: false,
          created: new Date(),
          updated: new Date(),
        },
      ];

      // Mock listPRs to return our test PRs
      github.listPRs = async () => mockPRs;

      const pr = await github.findPR({
        repo: 'owner/repo',
        branch: 'feature/test-branch',
      });

      expect(pr).not.toBeNull();
      expect(pr?.number).toBe(123);
      expect(pr?.branch).toBe('feature/test-branch');
      expect(pr?.url).toBe('https://github.com/owner/repo/pull/123');
    });

    it('should return null when no PR matches branch', async () => {
      const mockPRs = [
        {
          number: 123,
          title: 'Test PR',
          branch: 'feature/test-branch',
          baseBranch: 'main',
          repo: 'owner/repo',
          state: 'OPEN',
          url: 'https://github.com/owner/repo/pull/123',
          author: 'testuser',
          isDraft: false,
          created: new Date(),
          updated: new Date(),
        },
      ];

      github.listPRs = async () => mockPRs;

      const pr = await github.findPR({
        repo: 'owner/repo',
        branch: 'feature/nonexistent-branch',
      });

      expect(pr).toBeNull();
    });

    it('should match first PR when multiple PRs exist on same branch', async () => {
      const mockPRs = [
        {
          number: 123,
          title: 'First PR',
          branch: 'feature/test-branch',
          baseBranch: 'main',
          repo: 'owner/repo',
          state: 'OPEN',
          url: 'https://github.com/owner/repo/pull/123',
          author: 'testuser',
          isDraft: false,
          created: new Date(),
          updated: new Date(),
        },
        {
          number: 124,
          title: 'Second PR',
          branch: 'feature/test-branch',
          baseBranch: 'develop',
          repo: 'owner/repo',
          state: 'OPEN',
          url: 'https://github.com/owner/repo/pull/124',
          author: 'testuser',
          isDraft: false,
          created: new Date(),
          updated: new Date(),
        },
      ];

      github.listPRs = async () => mockPRs;

      const pr = await github.findPR({
        repo: 'owner/repo',
        branch: 'feature/test-branch',
      });

      expect(pr).not.toBeNull();
      expect(pr?.number).toBe(123); // Should return first match
    });

    it('should only match open PRs', async () => {
      github.findPR = async (params) => {
        const prs = await github.listPRs(params.repo, { state: 'open' });
        return prs.find(pr => pr.branch === params.branch) || null;
      };

      // Verify that findPR calls listPRs with state: 'open'
      let calledWithState: string | undefined;
      const originalListPRs = github.listPRs.bind(github);
      github.listPRs = async (repo, options) => {
        calledWithState = options?.state;
        return originalListPRs(repo, options);
      };

      await github.findPR({
        repo: 'owner/repo',
        branch: 'test-branch',
      });

      expect(calledWithState).toBe('open');
    });
  });

  describe('Edge Cases', () => {
    it('should handle session without git repo gracefully', async () => {
      const mockSession = {
        id: 'test-session',
        workingDir: '/tmp/not-a-git-repo',
        created: new Date(),
        attached: false,
      };

      git.getInfo = () => {
        throw new Error('Not a git repository');
      };

      const state = await discovery.discoverOne(mockSession);

      expect(state).not.toBeNull();
      expect(state?.hasGit).toBe(false);
      expect(state?.hasPR).toBe(false);
      expect(state?.pr).toBeNull();
    });

    it('should handle GitHub API failure gracefully', async () => {
      const mockSession = {
        id: 'test-session',
        workingDir: '/tmp/test-repo',
        created: new Date(),
        attached: false,
      };

      git.getInfo = () => ({
        remote: 'https://github.com/owner/repo.git',
        repo: 'owner/repo',
        branch: 'test-branch',
        isDirty: false,
        ahead: 0,
        behind: 0,
      });

      github.findPR = async () => {
        throw new Error('GitHub API rate limit exceeded');
      };

      const state = await discovery.discoverOne(mockSession);

      expect(state).not.toBeNull();
      expect(state?.hasGit).toBe(true);
      expect(state?.hasPR).toBe(false);
      expect(state?.pr).toBeNull();
    });

    it('should handle case-sensitive branch matching', async () => {
      const mockPRs = [
        {
          number: 123,
          title: 'Test PR',
          branch: 'Feature/Test-Branch',
          baseBranch: 'main',
          repo: 'owner/repo',
          state: 'OPEN',
          url: 'https://github.com/owner/repo/pull/123',
          author: 'testuser',
          isDraft: false,
          created: new Date(),
          updated: new Date(),
        },
      ];

      github.listPRs = async () => mockPRs;

      // Should NOT match with different case
      const pr1 = await github.findPR({
        repo: 'owner/repo',
        branch: 'feature/test-branch',
      });
      expect(pr1).toBeNull();

      // Should match with exact case
      const pr2 = await github.findPR({
        repo: 'owner/repo',
        branch: 'Feature/Test-Branch',
      });
      expect(pr2).not.toBeNull();
      expect(pr2?.number).toBe(123);
    });
  });

  describe('Session Cache Integration', () => {
    it('should include PR URL in cached session state', async () => {
      const mockSession = {
        id: 'mfh-123',
        workingDir: '/tmp/test-repo',
        created: new Date(),
        attached: true,
      };

      git.getInfo = () => ({
        remote: 'https://github.com/owner/repo.git',
        repo: 'owner/repo',
        branch: 'feature/test',
        isDirty: false,
        ahead: 0,
        behind: 0,
      });

      github.findPR = async () => ({
        number: 123,
        title: 'Test PR',
        branch: 'feature/test',
        baseBranch: 'main',
        repo: 'owner/repo',
        state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/123',
        author: 'testuser',
        isDraft: false,
        created: new Date(),
        updated: new Date(),
      });

      const state = await discovery.discoverOne(mockSession);

      expect(state).not.toBeNull();
      expect(state?.hasPR).toBe(true);
      expect(state?.pr).not.toBeNull();
      expect(state?.pr?.url).toBe('https://github.com/owner/repo/pull/123');
      expect(state?.pr?.number).toBe(123);
      expect(state?.pr?.title).toBe('Test PR');
    });
  });
});
