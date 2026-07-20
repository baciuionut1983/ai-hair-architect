import { describe, expect, it } from "vitest";

import {
  applyDownwardJitter,
  calculateExponentialBackoffMs,
  calculateWebhookRetryDelayMs,
  computeWebhookLeaseExpiresAt,
  WEBHOOK_CONNECTIVITY_BASE_DELAY_MS,
  WEBHOOK_CONNECTIVITY_MAX_DELAY_MS,
  WEBHOOK_LEASE_DURATION_MS,
  WEBHOOK_STANDARD_BASE_DELAY_MS,
  WEBHOOK_STANDARD_MAX_DELAY_MS,
} from "@/lib/webhook-delivery-retry-policy";

describe("webhook delivery retry policy", () => {
  it("calculates exponential backoff with max cap", () => {
    expect(calculateExponentialBackoffMs(1, WEBHOOK_STANDARD_BASE_DELAY_MS, WEBHOOK_STANDARD_MAX_DELAY_MS)).toBe(30_000);
    expect(calculateExponentialBackoffMs(2, WEBHOOK_STANDARD_BASE_DELAY_MS, WEBHOOK_STANDARD_MAX_DELAY_MS)).toBe(60_000);
    expect(calculateExponentialBackoffMs(6, WEBHOOK_STANDARD_BASE_DELAY_MS, WEBHOOK_STANDARD_MAX_DELAY_MS)).toBe(900_000);
  });

  it("applies downward jitter deterministically", () => {
    expect(applyDownwardJitter(1000, 0.2, () => 0)).toBe(1000);
    expect(applyDownwardJitter(1000, 0.2, () => 1)).toBe(800);
  });

  it("uses the connectivity curve for early connectivity retries", () => {
    expect(
      calculateWebhookRetryDelayMs({
        attemptNumber: 1,
        classification: { usesConnectivityCap: true },
        connectivityMaxAttempts: 3,
        random: () => 0,
      }),
    ).toBe(WEBHOOK_CONNECTIVITY_BASE_DELAY_MS);

    expect(
      calculateWebhookRetryDelayMs({
        attemptNumber: 2,
        classification: { usesConnectivityCap: true },
        connectivityMaxAttempts: 3,
        random: () => 0,
      }),
    ).toBe(30_000);
  });

  it("falls back to the standard curve after connectivity retries are exhausted", () => {
    expect(
      calculateWebhookRetryDelayMs({
        attemptNumber: 4,
        classification: { usesConnectivityCap: true },
        connectivityMaxAttempts: 3,
        random: () => 0,
      }),
    ).toBe(240_000);
  });

  it("uses the standard curve for non-connectivity failures", () => {
    expect(
      calculateWebhookRetryDelayMs({
        attemptNumber: 3,
        classification: { usesConnectivityCap: false },
        connectivityMaxAttempts: 3,
        random: () => 0,
      }),
    ).toBe(120_000);
  });

  it("computes lease expiry from the current time", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(computeWebhookLeaseExpiresAt(now).toISOString()).toBe("2026-07-20T12:01:30.000Z");
    expect(WEBHOOK_LEASE_DURATION_MS).toBe(90_000);
    expect(WEBHOOK_CONNECTIVITY_MAX_DELAY_MS).toBe(60_000);
    expect(WEBHOOK_STANDARD_MAX_DELAY_MS).toBe(900_000);
  });
});