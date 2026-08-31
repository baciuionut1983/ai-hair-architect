// Real AI Video Demonstration, Stage 3 -- orchestrates a scheduler-
// triggered sweep across every Video Demonstration generation that is due
// for work right now (task §4: "find due/recoverable video jobs -> claim
// -> execute appropriate next step"). Mirrors
// image-asset-retention-automation.ts's own exact pattern: this file never
// touches Postgres or the provider directly (both are injected), so it
// stays unit-testable without either, and it deliberately does NOT
// reimplement any claim/execution logic -- each generation's actual next
// step (claim-and-submit, or poll, or recognize a processing timeout) is
// the exact, unmodified executeVideoDemonstrationGeneration orchestrator,
// called once per due generation via its own injected dependency.
//
// Concurrency note (mirrors the same file's own reasoning): each
// generation's real safety (exactly-one-submit, exactly-one-completion) is
// already fully guaranteed at the PER-ROW level by
// video-generation-execution-repository.ts's own atomic claims -- this
// sweep does not add a second, sweep-level lock. Two overlapping sweeps
// (or a sweep overlapping a direct user /execute call) are at worst
// redundant work on any individual row (a lost claim race, reported as
// CLAIM_CONFLICT or "still_processing" -- never a correctness risk),
// exactly like Stage 2's own proven concurrent-execution tests already
// demonstrate for a single row.

export interface VideoDemonstrationRecoverySweepInput {
  readonly now: () => Date;
  // Hard cap on how many generations a single invocation processes,
  // bounding worst-case execution time for a typical HTTP
  // request/serverless function timeout. If more are due than this,
  // hasMore is reported true so the caller (the scheduler) can invoke
  // again.
  readonly maxGenerationsPerRun: number;
  // How many generations' next-step executions run concurrently. Safe to
  // parallelize since each row's own atomic claim is independent (no
  // cross-row contention) -- capped only to bound simultaneous DB
  // connections/provider requests, not for correctness.
  readonly maxConcurrency: number;
  readonly findDueGenerations: (now: Date, limit: number) => Promise<ReadonlyArray<{ id: string; ownerUserId: string }>>;
  // A single generation's failure (thrown) must never abort the sweep for
  // every other generation -- the caller (runtime wiring) is responsible
  // for ensuring this only rejects for a genuine unexpected error, not for
  // an ordinary "still_processing"/"requeued_for_retry"/"failed" outcome
  // (all of which resolve normally -- see VideoDemonstrationRecoveryOutcome).
  readonly executeGeneration: (generationId: string, ownerUserId: string) => Promise<{ outcome: string }>;
}

export interface VideoDemonstrationRecoverySweepResult {
  readonly generationsFound: number;
  readonly outcomeCounts: Record<string, number>;
  readonly generationsErrored: number;
  readonly hasMore: boolean;
}

export async function runVideoDemonstrationRecoverySweep(
  input: VideoDemonstrationRecoverySweepInput,
): Promise<VideoDemonstrationRecoverySweepResult> {
  const now = input.now();
  const candidates = await input.findDueGenerations(now, input.maxGenerationsPerRun + 1);
  const hasMore = candidates.length > input.maxGenerationsPerRun;
  const due = hasMore ? candidates.slice(0, input.maxGenerationsPerRun) : candidates;

  const outcomeCounts: Record<string, number> = {};
  let generationsErrored = 0;

  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= due.length) return;

      const generation = due[index];
      try {
        const result = await input.executeGeneration(generation.id, generation.ownerUserId);
        outcomeCounts[result.outcome] = (outcomeCounts[result.outcome] ?? 0) + 1;
      } catch {
        // A single generation's unexpected failure (e.g. a real
        // persistence outage) must never abort the sweep for every other
        // due generation.
        generationsErrored += 1;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(input.maxConcurrency, due.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { generationsFound: due.length, outcomeCounts, generationsErrored, hasMore };
}
