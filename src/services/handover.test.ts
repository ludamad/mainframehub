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
      expect(command).toMatch(/^unset CLAUDECODE && claude '/);
      expect(command).toContain('PR #42');
      expect(command).toContain('Add login page');
    });

    it('passes --dangerously-skip-permissions when requested', async () => {
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

  describe('resume', () => {
    it('sends claude --resume with specific session ID', async () => {
      await service.resume('pr-42', 'abc-123-def');

      expect(tmux.sendKeys).toHaveBeenCalledWith(
        'pr-42',
        'unset CLAUDECODE && claude --resume abc-123-def',
      );
    });

    it('passes --dangerously-skip-permissions when requested', async () => {
      await service.resume('pr-42', 'abc-123-def', true);

      expect(tmux.sendKeys).toHaveBeenCalledWith(
        'pr-42',
        'unset CLAUDECODE && claude --resume abc-123-def --dangerously-skip-permissions',
      );
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
