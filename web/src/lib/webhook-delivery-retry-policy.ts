import type { WebhookRetryClassification } from "@/lib/contracts";

export const WEBHOOK_LEASE_DURATION_MS = 90_000;
export const WEBHOOK_STANDARD_BASE_DELAY_MS = 30_000;
export const WEBHOOK_STANDARD_MAX_DELAY_MS = 15 * 60_000;
export const WEBHOOK_CONNECTIVITY_BASE_DELAY_MS = 15_000;
export const WEBHOOK_CONNECTIVITY_MAX_DELAY_MS = 60_000;
export const WEBHOOK_STANDARD_JITTER_RATIO = 0.2;
export const WEBHOOK_CONNECTIVITY_JITTER_RATIO = 0.1;

export function applyDownwardJitter(
  delayMs: number,
  jitterRatio: number,
  random: () => number = Math.random,
): number {
  const clampedRatio = Math.min(Math.max(jitterRatio, 0), 1);
  const clampedRandom = Math.min(Math.max(random(), 0), 1);
  return Math.max(0, Math.floor(delayMs * (1 - clampedRatio * clampedRandom)));
}

export function calculateExponentialBackoffMs(
  attemptNumber: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const normalizedAttempt = Math.max(1, Math.floor(attemptNumber));
  const rawDelay = baseDelayMs * 2 ** (normalizedAttempt - 1);
  return Math.min(rawDelay, maxDelayMs);
}

export function calculateWebhookRetryDelayMs(input: {
  attemptNumber: number;
  classification: Pick<WebhookRetryClassification, "usesConnectivityCap">;
  connectivityMaxAttempts: number;
  random?: () => number;
}): number {
  const random = input.random ?? Math.random;
  const normalizedAttempt = Math.max(1, Math.floor(input.attemptNumber));
  const normalizedConnectivityMaxAttempts = Math.max(0, Math.floor(input.connectivityMaxAttempts));

  const useConnectivityCurve =
    input.classification.usesConnectivityCap && normalizedAttempt <= normalizedConnectivityMaxAttempts;

  const baseDelayMs = useConnectivityCurve
    ? WEBHOOK_CONNECTIVITY_BASE_DELAY_MS
    : WEBHOOK_STANDARD_BASE_DELAY_MS;

  const maxDelayMs = useConnectivityCurve
    ? WEBHOOK_CONNECTIVITY_MAX_DELAY_MS
    : WEBHOOK_STANDARD_MAX_DELAY_MS;

  const jitterRatio = useConnectivityCurve
    ? WEBHOOK_CONNECTIVITY_JITTER_RATIO
    : WEBHOOK_STANDARD_JITTER_RATIO;

  return applyDownwardJitter(
    calculateExponentialBackoffMs(normalizedAttempt, baseDelayMs, maxDelayMs),
    jitterRatio,
    random,
  );
}

export function computeWebhookLeaseExpiresAt(now: Date, leaseDurationMs = WEBHOOK_LEASE_DURATION_MS): Date {
  return new Date(now.getTime() + Math.max(0, leaseDurationMs));
}