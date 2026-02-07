import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeHandoverService } from './handover';
import type { TmuxService } from './tmux';

describe('ClaudeHandoverService', () => {
  let tmux: { sendKeys: ReturnType<typeof vi.fn> };
  let service: ClaudeHandoverService;

  beforeEach(() => {
    tmux = { sendKeys: vi.fn().mockResolvedValue(undefined) };
    service = new ClaudeHandoverService(tmux as unknown as TmuxService);
  });

  describe('initialize', () => {
    it('sends claude command with PR context', async () => {
      await service.initialize('pr-42', {
        prNumber: 42,
        branch: 'feat/login',
        baseBranch: 'main',
        userPrompt: 'Add login page',
      });

      expect(tmux.sendKeys).toHaveBeenCalledOnce();
      const [sessionId, command] = tmux.sendKeys.mock.calls[0];
      expect(sessionId).toBe('pr-42');
      expect(command).toMatch(/^claude '/);
      expect(command).toContain('PR #42');
      expect(command).toContain('feat/login');
      expect(command).toContain('main');
      expect(command).toContain('Add login page');
    });

    it('includes guidelines in prompt when provided', async () => {
      await service.initialize('pr-10', {
        prNumber: 10,
        branch: 'fix/typo',
        baseBranch: 'main',
        userPrompt: 'Fix typo',
        guidelines: 'Use conventional commits',
      });

      const command: string = tmux.sendKeys.mock.calls[0][1];
      expect(command).toContain('Use conventional commits');
    });

    it('passes --dangerously-skip-permissions when skipPermissions is true', async () => {
      await service.initialize('pr-5', {
        prNumber: 5,
        branch: 'feat/api',
        baseBranch: 'main',
        userPrompt: 'Build API',
        skipPermissions: true,
      });

      const command: string = tmux.sendKeys.mock.calls[0][1];
      expect(command).toContain('--dangerously-skip-permissions');
    });
  });

  describe('initializeWithError', () => {
    it('sends claude command with error context', async () => {
      await service.initializeWithError('pr-99', {
        prNumber: 99,
        branch: 'fix/crash',
        baseBranch: 'main',
        error: 'TypeError: cannot read property x',
      });

      expect(tmux.sendKeys).toHaveBeenCalledOnce();
      const command: string = tmux.sendKeys.mock.calls[0][1];
      expect(command).toContain('fixing an error');
      expect(command).toContain('TypeError: cannot read property x');
      expect(command).toContain('PR #99');
    });
  });

  describe('single quote escaping', () => {
    it('escapes single quotes in user prompt', async () => {
      await service.initialize('pr-1', {
        prNumber: 1,
        branch: 'feat/quote',
        baseBranch: 'main',
        userPrompt: "it's a test",
      });

      const command: string = tmux.sendKeys.mock.calls[0][1];
      expect(command).toContain("it'\\''s a test");
    });
  });
});
