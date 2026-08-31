import { describe, expect, it } from "vitest";

import {
  computeVideoDemonstrationNextPollDelayMs,
  isVideoDemonstrationProcessingStale,
  VIDEO_DEMONSTRATION_MAX_PROCESSING_DURATION_MS,
} from "@/lib/video-worker-policy";

// Real AI Video Demonstration, Stage 3 (task §6/§7) -- pure polling-cadence
// and stale/timeout policy tests. No I/O, no database.

describe("computeVideoDemonstrationNextPollDelayMs", () => {
  it("starts near Veo's own documented 11-second floor, never immediate/zero", () => {
    const delay = computeVideoDemonstrationNextPollDelayMs(0);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeGreaterThanOrEqual(10_000);
  });

  it("backs off (never decreases) as elapsed time grows -- a bounded step function, never a tight loop", () => {
    const early = computeVideoDemonstrationNextPollDelayMs(0);
    const mid = computeVideoDemonstrationNextPollDelayMs(60_000);
    const late = computeVideoDemonstrationNextPollDelayMs(200_000);
    const veryLate = computeVideoDemonstrationNextPollDelayMs(10 * 60_000);
    expect(mid).toBeGreaterThanOrEqual(early);
    expect(late).toBeGreaterThanOrEqual(mid);
    expect(veryLate).toBeGreaterThanOrEqual(late);
  });

  it("is capped -- never grows unbounded even for a very long-running job", () => {
    const delay = computeVideoDemonstrationNextPollDelayMs(60 * 60_000); // 1 hour elapsed
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  it("is deterministic for the same elapsed input", () => {
    expect(computeVideoDemonstrationNextPollDelayMs(45_000)).toBe(computeVideoDemonstrationNextPollDelayMs(45_000));
  });
});

describe("isVideoDemonstrationProcessingStale / VIDEO_DEMONSTRATION_MAX_PROCESSING_DURATION_MS", () => {
  it("is generously above Veo's own documented peak generation time (6 minutes) -- never prematurely kills a genuinely slow but active job", () => {
    expect(VIDEO_DEMONSTRATION_MAX_PROCESSING_DURATION_MS).toBeGreaterThan(6 * 60_000);
  });

  it("is not stale just after submission, or comfortably within the documented peak window", () => {
    const now = new Date("2026-08-29T10:10:00.000Z");
    expect(isVideoDemonstrationProcessingStale(new Date("2026-08-29T10:09:59.000Z"), now)).toBe(false);
    expect(isVideoDemonstrationProcessingStale(new Date("2026-08-29T10:04:00.000Z"), now)).toBe(false); // 6 min elapsed
  });

  it("is stale once elapsed time reaches/exceeds the configured maximum", () => {
    const submittedAt = new Date("2026-08-29T10:00:00.000Z");
    const now = new Date(submittedAt.getTime() + VIDEO_DEMONSTRATION_MAX_PROCESSING_DURATION_MS);
    expect(isVideoDemonstrationProcessingStale(submittedAt, now)).toBe(true);
    const wellPast = new Date(submittedAt.getTime() + VIDEO_DEMONSTRATION_MAX_PROCESSING_DURATION_MS + 60_000);
    expect(isVideoDemonstrationProcessingStale(submittedAt, wellPast)).toBe(true);
  });
});
