import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionCacheService } from './session-cache';
import type { DiscoveryService } from './discovery';
import type { SessionState } from '../interfaces';

const fakeSessions: SessionState[] = [
  {
    session: {
      id: 'pr-1',
      workingDir: '/tmp/pr-1',
      created: new Date('2025-01-01'),
      attached: false,
    },
    gitInfo: null,
    pr: null,
    hasGit: false,
    hasPR: false,
    isActive: false,
  },
];

describe('SessionCacheService', () => {
  let discovery: { discover: ReturnType<typeof vi.fn> };
  let logger: { appendLine: ReturnType<typeof vi.fn> };
  let service: SessionCacheService;

  beforeEach(() => {
    vi.useFakeTimers();
    discovery = { discover: vi.fn().mockResolvedValue(fakeSessions) };
    logger = { appendLine: vi.fn() };
    service = new SessionCacheService(
      discovery as unknown as DiscoveryService,
      30,
      logger,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first get blocks and fetches from discovery', async () => {
    const result = await service.get();

    expect(discovery.discover).toHaveBeenCalledOnce();
    expect(result).toEqual(fakeSessions);
  });

  it('second get within TTL returns cached data without calling discovery again', async () => {
    await service.get();
    discovery.discover.mockClear();

    const result = await service.get();

    expect(discovery.discover).not.toHaveBeenCalled();
    expect(result).toEqual(fakeSessions);
  });

  it('after TTL expires returns stale data and triggers background refresh', async () => {
    await service.get();
    discovery.discover.mockClear();

    vi.advanceTimersByTime(30_001);

    const result = await service.get();

    expect(result).toEqual(fakeSessions);
    expect(discovery.discover).toHaveBeenCalledOnce();
  });

  it('invalidate clears cache and forces refresh', async () => {
    await service.get();
    discovery.discover.mockClear();

    const updated = [{ ...fakeSessions[0], isActive: true }];
    discovery.discover.mockResolvedValue(updated);

    const result = await service.invalidate();

    expect(discovery.discover).toHaveBeenCalledOnce();
    expect(result).toEqual(updated);
  });

  it('refresh deduplicates concurrent calls', async () => {
    const [r1, r2] = await Promise.all([
      service.refresh(),
      service.refresh(),
    ]);

    expect(discovery.discover).toHaveBeenCalledOnce();
    expect(r1).toEqual(fakeSessions);
    expect(r2).toEqual(fakeSessions);
  });
});
