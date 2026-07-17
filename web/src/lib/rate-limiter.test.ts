import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, getRateLimitStatus, cleanupExpiredLimiters } from './rate-limiter';

describe('Rate Limiting', () => {
  beforeEach(() => {
    cleanupExpiredLimiters();
  });

  it('allows requests under limit', () => {
    const userId = 'user-1';
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit(userId, 'UPLOAD');
      expect(result.allowed).toBe(true);
      expect(result.retryAfter).toBe(0);
    }
  });

  it('rejects request at limit', () => {
    const userId = 'user-2';
    for (let i = 0; i < 10; i++) {
      checkRateLimit(userId, 'UPLOAD');
    }
    const result = checkRateLimit(userId, 'UPLOAD');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('tracks remaining requests', () => {
    const userId = 'user-3';
    checkRateLimit(userId, 'UPLOAD');
    checkRateLimit(userId, 'UPLOAD');

    const status = getRateLimitStatus(userId, 'UPLOAD');
    expect(status?.remaining).toBe(8);
    expect(status?.limit).toBe(10);
  });

  it('separates limits by action', () => {
    const userId = 'user-4';
    for (let i = 0; i < 10; i++) {
      checkRateLimit(userId, 'UPLOAD');
    }

    const uploadResult = checkRateLimit(userId, 'UPLOAD');
    expect(uploadResult.allowed).toBe(false);

    const analyzeResult = checkRateLimit(userId, 'ANALYZE');
    expect(analyzeResult.allowed).toBe(true);
  });
});
