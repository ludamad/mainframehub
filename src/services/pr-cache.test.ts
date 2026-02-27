import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRCacheService } from './pr-cache';
import type { GitHubService } from './github';
import type { PullRequest } from '../interfaces';

const fakePRs: PullRequest[] = [
  {
    number: 1,
    title: 'Test PR',
    branch: 'feat/test',
    baseBranch: 'main',
    repo: 'owner/repo',
    state: 'OPEN',
    url: 'https://github.com/owner/repo/pull/1',
    author: 'alice',
    isDraft: false,
    created: new Date('2025-01-01'),
    updated: new Date('2025-01-02'),
  },
];

describe('PRCacheService', () => {
  let github: { listPRs: ReturnType<typeof vi.fn> };
  let logger: { appendLine: ReturnType<typeof vi.fn> };
  let service: PRCacheService;

  beforeEach(() => {
    vi.useFakeTimers();
    github = { listPRs: vi.fn().mockResolvedValue(fakePRs) };
    logger = { appendLine: vi.fn() };
    service = new PRCacheService(
      github as unknown as GitHubService,
      'owner/repo',
      1,
      logger,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first get blocks and fetches from GitHub', async () => {
    const result = await service.get('alice');

    expect(github.listPRs).toHaveBeenCalledOnce();
    expect(result).toEqual(fakePRs);
  });

  it('second get within TTL returns cached data without calling GitHub again', async () => {
    await service.get('alice');
    github.listPRs.mockClear();

    const result = await service.get('alice');

    expect(github.listPRs).not.toHaveBeenCalled();
    expect(result).toEqual(fakePRs);
  });

  it('after TTL expires returns stale data and triggers background refresh', async () => {
    await service.get('alice');
    github.listPRs.mockClear();

    vi.advanceTimersByTime(60_001);

    const result = await service.get('alice');

    expect(result).toEqual(fakePRs);
    expect(github.listPRs).toHaveBeenCalledOnce();
  });

  it('invalidate clears cache and forces refresh', async () => {
    await service.get('alice');
    github.listPRs.mockClear();

    const updatedPRs = [{ ...fakePRs[0], title: 'Updated' }];
    github.listPRs.mockResolvedValue(updatedPRs);

    const result = await service.invalidate('alice');

    expect(github.listPRs).toHaveBeenCalledOnce();
    expect(result).toEqual(updatedPRs);
  });

  it('refresh deduplicates concurrent calls', async () => {
    const [r1, r2] = await Promise.all([
      service.refresh('alice'),
      service.refresh('alice'),
    ]);

    expect(github.listPRs).toHaveBeenCalledOnce();
    expect(r1).toEqual(fakePRs);
    expect(r2).toEqual(fakePRs);
  });
});
