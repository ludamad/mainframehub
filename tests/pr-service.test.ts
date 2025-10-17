/**
 * Comprehensive tests for PR service
 *
 * These tests use REAL operations:
 * - Real tmux sessions
 * - Real git clones
 * - Real file system
 *
 * Only GitHub writes are mocked
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TmuxService } from '../src/services/tmux.js';
import { GitService } from '../src/services/git.js';
import { GitHubService } from '../src/services/github.js';
import { ClaudeService } from '../src/services/claude.js';
import { ClaudeHandoverService } from '../src/services/handover.js';
import { PRService } from '../src/services/pr-service.js';
import { DiscoveryService } from '../src/services/discovery.js';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

describe('PR Service (Real Operations + Mock Writes)', () => {
  const testDir = '/tmp/mfh-test';
  const clonesDir = join(testDir, 'clones');

  let tmux: TmuxService;
  let git: GitService;
  let github: GitHubService;
  let claude: ClaudeService;
  let handover: ClaudeHandoverService;
  let prService: PRService;
  let discovery: DiscoveryService;

  const config = {
    repo: 'https://github.com/test/repo',
    repoName: 'test/repo',
    clonesDir,
    baseBranch: 'main',
    sessionPrefix: 'mfh-test-',
    guidelines: {
      branchFormat: 'ad/TYPE/description',
      commitFormat: 'type: description',
    },
  };

  // Track created sessions for cleanup
  const createdSessions: string[] = [];

  beforeEach(() => {
    // Initialize services
    tmux = new TmuxService();
    git = new GitService();
    github = new GitHubService({ mockWrites: true }); // Mock GitHub writes
    claude = new ClaudeService();
    handover = new ClaudeHandoverService(tmux);
    prService = new PRService(tmux, git, github, claude, handover, config);
    discovery = new DiscoveryService(tmux, git, github, config.sessionPrefix);

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // Clear mock PRs
    github.clearMockPRs();
  });

  afterEach(async () => {
    // Cleanup: kill all test sessions
    for (const sessionId of createdSessions) {
      try {
        await tmux.kill(sessionId);
      } catch {
        // Session may already be dead
      }
    }
    createdSessions.length = 0;

    // Cleanup: remove test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createNew()', () => {
    it('should create PR with full flow using real operations', async () => {
      // This test does REAL:
      // - tmux session creation
      // - git clone
      // - git branch creation
      // - file system operations
      //
      // Only mocked:
      // - GitHub PR creation

      const result = await prService.createNew({
        prompt: 'Add dark mode',
        baseBranch: 'main',
      });

      createdSessions.push(result.session.id);

      // Verify PR was created (mocked)
      expect(result.pr.number).toBeGreaterThanOrEqual(10000);
      expect(result.pr.title).toContain('dark mode');
      expect(result.pr.state).toBe('OPEN');

      // Verify real tmux session was created
      const sessionExists = await tmux.exists(result.session.id);
      expect(sessionExists).toBe(true);

      // Verify real clone was created
      expect(existsSync(result.clonePath)).toBe(true);

      // Verify git repo is valid
      const gitInfo = git.getInfo(result.clonePath);
      expect(gitInfo.branch).toBe(result.pr.branch);

      // Verify mock PR is in GitHub service
      const mockPRs = github.getMockPRs(config.repoName);
      expect(mockPRs).toHaveLength(1);
      expect(mockPRs[0].number).toBe(result.pr.number);
    }, 60000); // 60s timeout for real operations

    it('should create multiple PRs without conflicts', async () => {
      const result1 = await prService.createNew({
        prompt: 'Feature 1',
      });
      createdSessions.push(result1.session.id);

      const result2 = await prService.createNew({
        prompt: 'Feature 2',
      });
      createdSessions.push(result2.session.id);

      // Different PR numbers
      expect(result1.pr.number).not.toBe(result2.pr.number);

      // Different sessions
      expect(result1.session.id).not.toBe(result2.session.id);

      // Different clone directories
      expect(result1.clonePath).not.toBe(result2.clonePath);

      // Both exist
      expect(await tmux.exists(result1.session.id)).toBe(true);
      expect(await tmux.exists(result2.session.id)).toBe(true);
      expect(existsSync(result1.clonePath)).toBe(true);
      expect(existsSync(result2.clonePath)).toBe(true);
    }, 120000);
  });

  describe('setupExisting()', () => {
    it('should setup existing PR', async () => {
      // First create a mock PR
      const mockPR = await github.createPR({
        repo: config.repoName,
        branch: 'existing-branch',
        baseBranch: 'main',
        title: 'Existing PR',
        body: 'Test',
        draft: false,
      });

      // Now setup the PR (this creates real clone and session)
      const result = await prService.setupExisting(mockPR.number);
      createdSessions.push(result.session.id);

      // Verify
      expect(result.pr.number).toBe(mockPR.number);
      expect(await tmux.exists(result.session.id)).toBe(true);
      expect(existsSync(result.clonePath)).toBe(true);

      // Verify git branch matches
      const gitInfo = git.getInfo(result.clonePath);
      expect(gitInfo.branch).toBe(mockPR.branch);
    }, 60000);

    it('should throw if PR does not exist', async () => {
      await expect(prService.setupExisting(99999)).rejects.toThrow('not found');
    });

    it('should throw if clone already exists', async () => {
      const mockPR = await github.createPR({
        repo: config.repoName,
        branch: 'test-branch',
        baseBranch: 'main',
        title: 'Test PR',
        body: 'Test',
      });

      const result1 = await prService.setupExisting(mockPR.number);
      createdSessions.push(result1.session.id);

      // Try to setup again
      await expect(prService.setupExisting(mockPR.number)).rejects.toThrow('already exists');
    }, 60000);
  });

  describe('close()', () => {
    it('should close PR and cleanup everything', async () => {
      // Create a PR
      const result = await prService.createNew({
        prompt: 'Test feature',
      });
      createdSessions.push(result.session.id);

      const { pr, session, clonePath } = result;

      // Verify it exists
      expect(await tmux.exists(session.id)).toBe(true);
      expect(existsSync(clonePath)).toBe(true);

      // Close it
      await prService.close(pr.number);

      // Verify cleanup
      expect(await tmux.exists(session.id)).toBe(false);
      expect(existsSync(clonePath)).toBe(false);

      // Verify PR is closed in mock
      const closedPR = await github.getPR(config.repoName, pr.number);
      expect(closedPR?.state).toBe('CLOSED');
    }, 60000);
  });

  describe('Discovery (tmux-centric)', () => {
    it('should discover session and derive PR from git', async () => {
      // Create a PR (real session, real clone, mock GitHub)
      const result = await prService.createNew({
        prompt: 'Discoverable feature',
      });
      createdSessions.push(result.session.id);

      // Now discover all sessions
      const states = await discovery.discover();

      // Should find our session
      expect(states.length).toBeGreaterThanOrEqual(1);

      const ourState = states.find(s => s.session.id === result.session.id);
      expect(ourState).toBeDefined();
      expect(ourState?.hasGit).toBe(true);
      expect(ourState?.hasPR).toBe(true);
      expect(ourState?.pr?.number).toBe(result.pr.number);

      // Git info should be derived from real git repo
      expect(ourState?.gitInfo?.branch).toBe(result.pr.branch);
      expect(ourState?.gitInfo?.repo).toBe(config.repoName);
    }, 60000);

    it('should discover multiple sessions', async () => {
      const result1 = await prService.createNew({ prompt: 'Feature 1' });
      const result2 = await prService.createNew({ prompt: 'Feature 2' });
      createdSessions.push(result1.session.id, result2.session.id);

      const states = await discovery.discover();

      const state1 = states.find(s => s.pr?.number === result1.pr.number);
      const state2 = states.find(s => s.pr?.number === result2.pr.number);

      expect(state1).toBeDefined();
      expect(state2).toBeDefined();
      expect(state1?.session.id).toBe(result1.session.id);
      expect(state2?.session.id).toBe(result2.session.id);
    }, 120000);

    it('should handle session without git', async () => {
      // Create a bare session (not through PR service)
      const bareSession = await tmux.create({
        id: 'mfh-test-bare',
        workingDir: '/tmp',
      });
      createdSessions.push(bareSession.id);

      const states = await discovery.discover();

      const bareState = states.find(s => s.session.id === bareSession.id);
      expect(bareState).toBeDefined();
      expect(bareState?.hasGit).toBe(false);
      expect(bareState?.hasPR).toBe(false);
    }, 30000);
  });

  describe('Hybrid Mode (Real Reads)', () => {
    it('should read real PRs from GitHub', async () => {
      // This test requires GITHUB_TOKEN env var
      if (!process.env.GITHUB_TOKEN) {
        console.log('Skipping hybrid test - no GITHUB_TOKEN');
        return;
      }

      // Create a real GitHub service (no mock writes)
      const realGitHub = new GitHubService({ mockWrites: false });

      // List real PRs
      const realPRs = await realGitHub.listPRs('AztecProtocol/aztec-packages', {
        author: 'ludamad',
        state: 'open',
      });

      // Should get real PRs
      expect(realPRs.length).toBeGreaterThan(0);
      realPRs.forEach(pr => {
        expect(pr.number).toBeLessThan(10000); // Real PRs have normal numbers
        expect(pr.repo).toBe('AztecProtocol/aztec-packages');
      });
    }, 30000);
  });
});
