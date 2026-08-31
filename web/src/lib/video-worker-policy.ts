// Real AI Video Demonstration, Stage 3 -- pure polling-cadence and
// stale/timeout policy. No I/O, no database, no provider SDK import --
// consumed by video-generation-execution-repository.ts (the initial
// nextPollAt set at submit time) and video-generation-execution-service.ts
// (rescheduling after a poll, and the processing-timeout check).

// Bounded backoff (task §6: "not a tight loop"). Veo's own documented
// generation time is "11 seconds to up to 6 minutes at peak" -- this
// schedule starts near that floor and backs off as elapsed time grows,
// capped rather than growing unbounded. A step function on ELAPSED time
// since submission, not a retry counter -- simpler, and gives the same
// answer regardless of how many times a row has actually been polled so
// far (which the sweep doesn't track and doesn't need to).
export function computeVideoDemonstrationNextPollDelayMs(elapsedSinceSubmittedMs: number): number {
  if (elapsedSinceSubmittedMs < 30_000) return 15_000; // first ~30s: poll every 15s
  if (elapsedSinceSubmittedMs < 120_000) return 20_000; // 30s-2min: every 20s
  if (elapsedSinceSubmittedMs < 300_000) return 30_000; // 2-5min: every 30s
  return 60_000; // beyond 5min: every 60s, capped
}

// task §7's "PROCESSING for a very long time" policy: a generous multiple
// of Veo's own documented ceiling (6 minutes at peak), not the ceiling
// itself -- a genuinely slow but still-active generation must never be
// prematurely killed (task §7's own explicit warning), but a job cannot be
// allowed to stay a zombie forever either. This single, elapsed-time-based
// check also naturally bounds "repeated transient poll failures" (task
// §7's other named case): each retryable poll failure only reschedules a
// later poll via the same elapsed-time clock, so a row that keeps failing
// to even be CHECKED eventually crosses this same threshold and is
// resolved, without needing a separate failure counter.
//
// Deliberately NOT env-configurable -- matches
// MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION's own plain-constant
// convention in this codebase. Revisit with real production timing data
// once a real paid call has actually been made (task §19: no real call
// authorized this stage, so this is a considered estimate, not a
// calibrated one).
export const VIDEO_DEMONSTRATION_MAX_PROCESSING_DURATION_MS = 20 * 60 * 1000;

export function isVideoDemonstrationProcessingStale(submittedAt: Date, now: Date): boolean {
  return now.getTime() - submittedAt.getTime() >= VIDEO_DEMONSTRATION_MAX_PROCESSING_DURATION_MS;
}
