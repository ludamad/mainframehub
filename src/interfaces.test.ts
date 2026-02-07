import { describe, it, expect } from 'vitest';
import { parseRepo, parsePRNumber } from './interfaces';

describe('parseRepo', () => {
  it('parses HTTPS URL with .git suffix', () => {
    expect(parseRepo('https://github.com/owner/repo.git')).toBe('owner/repo');
  });

  it('parses SSH URL', () => {
    expect(parseRepo('git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  it('parses HTTPS URL without .git suffix', () => {
    expect(parseRepo('https://github.com/owner/repo')).toBe('owner/repo');
  });

  it('throws on non-GitHub URL', () => {
    expect(() => parseRepo('https://gitlab.com/owner/repo')).toThrow(
      'Invalid GitHub remote: https://gitlab.com/owner/repo',
    );
  });

  it('throws on empty string', () => {
    expect(() => parseRepo('')).toThrow('Invalid GitHub remote: ');
  });
});

describe('parsePRNumber', () => {
  it('parses number from matching prefix', () => {
    expect(parsePRNumber('pr-123', 'pr-')).toBe(123);
  });

  it('parses number with different prefix', () => {
    expect(parsePRNumber('mfh-456', 'mfh-')).toBe(456);
  });

  it('returns null when prefix does not match', () => {
    expect(parsePRNumber('session-123', 'pr-')).toBeNull();
  });

  it('returns null for non-numeric suffix', () => {
    expect(parsePRNumber('pr-abc', 'pr-')).toBeNull();
  });

  it('returns null for empty suffix', () => {
    expect(parsePRNumber('pr-', 'pr-')).toBeNull();
  });
});
