// Pure restart/backoff policy for the "executor was interrupted, should
// the Supervisor resume it automatically" decision -- see this round's
// own task spec's "AUTOMATIC CONTINUE" section for the required
// behavior: a bounded number of automatic restarts, a reasonable
// backoff, and an explicit escalation once the bound is exceeded.
//
// MAX_RESTARTS justification (task spec: "Alege valoarea justificat."):
// 3. Chosen to match the exact example the task spec itself gives ("3
// restart-uri consecutive înainte de ESCALATE"), and because it mirrors
// this project's own already-established single-retry-then-escalate
// convention for provider calls (see AI Hair Architect's own STT/Consult
// AI/TTS: at most ONE retry before failing closed) scaled up slightly --
// an INTERRUPTED run is a strictly cheaper failure to retry than a real
// provider timeout (no API cost was wasted, no partial provider work to
// duplicate), so a slightly more generous bound than "1" is justified,
// but an UNBOUNDED bound would let a genuinely broken task (e.g. one
// whose own prompt causes a crash on every attempt) loop forever, wasting
// real API budget with zero chance of a different outcome -- exactly the
// class of risk this whole mechanism exists to prevent.
export const MAX_CONSECUTIVE_RESTARTS = 3;

// Backoff schedule: exponential, small base, capped -- restart 1 waits
// 5s, restart 2 waits 15s, restart 3 waits 45s (3x each step, capped at
// 60s). Deliberately short overall (under 2 minutes total across all 3
// restarts): a transport/API interruption is typically transient and
// resolves within seconds, unlike a real provider outage (where this
// project's own existing STT/Consult AI/TTS timeout policy already
// governs, at a completely different layer) -- this backoff exists only
// to avoid hammering a momentarily-unavailable API immediately, not to
// wait out a prolonged outage.
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MULTIPLIER = 3;
const BACKOFF_CAP_MS = 60_000;

export function computeBackoffMs(restartAttemptNumber: number): number {
  if (restartAttemptNumber < 1) return 0;
  const raw = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, restartAttemptNumber - 1);
  return Math.min(raw, BACKOFF_CAP_MS);
}

export type RestartDecision =
  | { action: "RESTART"; attemptNumber: number; backoffMs: number }
  | { action: "ESCALATE"; reason: string };

// currentRestartCount is the number of restarts ALREADY performed for
// this task (0 the first time an interruption is observed). Returns
// RESTART (with the next attempt number and its own backoff) while under
// the bound, ESCALATE once it would be exceeded -- never silently caps
// at the bound and keeps trying, since that would be indistinguishable
// from the unbounded-loop risk this policy exists to prevent.
export function decideRestart(currentRestartCount: number): RestartDecision {
  if (currentRestartCount >= MAX_CONSECUTIVE_RESTARTS) {
    return {
      action: "ESCALATE",
      reason: `restart count ${currentRestartCount} already reached MAX_CONSECUTIVE_RESTARTS (${MAX_CONSECUTIVE_RESTARTS})`,
    };
  }
  const attemptNumber = currentRestartCount + 1;
  return { action: "RESTART", attemptNumber, backoffMs: computeBackoffMs(attemptNumber) };
}

// RESUME LOOP PREVENTION (task spec item 7, distinct from plain restart
// counting, item 6): a restart count staying under the bound does NOT by
// itself prove progress is being made -- three consecutive restarts that
// each produce the EXACT SAME diff-stat summary (see scope-guard's own
// sibling module technical-review.ts for how that summary is computed)
// is strong evidence the executor is stuck repeating the same failed
// step, not making incremental progress toward completion. This is
// deliberately a SEPARATE signal from decideRestart's own count-based
// bound -- a task could still be within MAX_CONSECUTIVE_RESTARTS while
// already exhibiting a loop, and this catches that case earlier rather
// than waiting for the count alone to escalate.
export function detectNoProgressLoop(recentDiffSummaries: readonly (string | null)[]): boolean {
  if (recentDiffSummaries.length < MAX_CONSECUTIVE_RESTARTS) return false;
  const last = recentDiffSummaries.slice(-MAX_CONSECUTIVE_RESTARTS);
  const first = last[0];
  if (first === null) return false;
  return last.every((summary) => summary === first);
}
