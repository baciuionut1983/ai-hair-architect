import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsQueryLimitExceededError, MAX_ANALYTICS_RECORDS_PER_QUERY } from '@/lib/analytics-query-builder';

describe('AnalyticsQueryLimitExceededError', () => {
  it('should be instantiable with a record count', () => {
    const count = 15000;
    const error = new AnalyticsQueryLimitExceededError(count);

    expect(error).toBeInstanceOf(AnalyticsQueryLimitExceededError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AnalyticsQueryLimitExceededError');
  });

  it('should include record count in error message', () => {
    const count = 12500;
    const error = new AnalyticsQueryLimitExceededError(count);

    expect(error.message).toContain('12500');
    expect(error.message).toContain(String(MAX_ANALYTICS_RECORDS_PER_QUERY));
  });

  it('should suggest pagination in error message', () => {
    const error = new AnalyticsQueryLimitExceededError(15000);

    expect(error.message).toContain('pagination');
    expect(error.message).toContain('narrow the date range');
  });

  it('should include limit value in error message', () => {
    const error = new AnalyticsQueryLimitExceededError(MAX_ANALYTICS_RECORDS_PER_QUERY + 1);

    expect(error.message).toContain(String(MAX_ANALYTICS_RECORDS_PER_QUERY));
    expect(error.message).toContain('exceeding limit');
  });

  it('should have consistent error name for HTTP 413 status mapping', () => {
    const error = new AnalyticsQueryLimitExceededError(20000);

    expect(error.name).toBe('AnalyticsQueryLimitExceededError');
    expect(error instanceof Error).toBe(true);
    expect(typeof error.message).toBe('string');
  });
});
