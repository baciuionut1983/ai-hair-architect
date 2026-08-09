// M37: orchestrates a scheduler-triggered sweep across every owner who has
// at least one image asset past its retention deadline. Deliberately does
// NOT reimplement any purge logic -- each owner's actual purge (real
// storage delete, then the DB row, real advisory lock, real idempotency)
// is the exact, unmodified M36 engine (executeImageAssetRetentionPurge via
// its runtime wrapper), called once per eligible owner. This file only
// answers "which owners, how many at once, and what if one of them
// fails" -- it never touches Postgres or S3 directly (both are injected),
// so it stays unit-testable without either.
//
// Concurrency note: M36's per-owner advisory lock + idempotency-key
// replay already make a single owner's purge safe against double
// execution. This sweep deliberately does NOT add its own top-level lock
// spanning the whole multi-owner, S3-touching pass: holding a Postgres
// transaction open across real external I/O for however long a full
// sweep takes would repeat the exact anti-pattern M33/M36 both avoid. A
// second, overlapping sweep is at worst redundant work (extra queries,
// extra S3 head-checks that come back "already gone") -- never a
// correctness or data-loss risk, because the real safety property lives
// at the per-owner level, unchanged from M36.

export interface RetentionAutomationSweepInput {
  readonly now: () => Date;
  // Hard cap on how many owners a single invocation processes, bounding
  // worst-case execution time for a typical HTTP request/serverless
  // function timeout. If more owners are eligible than this, hasMore is
  // reported true so the caller (the scheduler) can invoke again.
  readonly maxOwnersPerRun: number;
  // How many owners' purges run concurrently. Safe to parallelize since
  // each owner's advisory lock is independent (no cross-owner
  // contention) -- capped only to bound simultaneous DB connections/S3
  // requests, not for correctness.
  readonly maxConcurrency: number;
  readonly findEligibleOwnerIds: (limit: number) => Promise<string[]>;
  // A single owner's failure (thrown) must never abort the sweep for
  // every other owner -- the caller (runtime wiring) is responsible for
  // ensuring this only rejects for a genuine per-owner failure, not for
  // "nothing was eligible" (which resolves normally with zero counts).
  readonly purgeForOwner: (
    ownerUserId: string,
    idempotencyKey: string,
  ) => Promise<{ eligibleCount: number; purgedCount: number; failedCount: number }>;
}

export interface RetentionAutomationSweepResult {
  readonly ownersProcessed: number;
  readonly ownersFailed: number;
  readonly totalEligible: number;
  readonly totalPurged: number;
  readonly totalFailed: number;
  readonly hasMore: boolean;
}

export async function runImageAssetRetentionAutomationSweep(
  input: RetentionAutomationSweepInput,
): Promise<RetentionAutomationSweepResult> {
  const candidateOwnerIds = await input.findEligibleOwnerIds(input.maxOwnersPerRun + 1);
  const hasMore = candidateOwnerIds.length > input.maxOwnersPerRun;
  const ownerIds = hasMore ? candidateOwnerIds.slice(0, input.maxOwnersPerRun) : candidateOwnerIds;

  // A deterministic, per-day, per-owner idempotency key: if the same
  // sweep is accidentally triggered twice on the same calendar day (a
  // double-firing scheduler, a manual retry), each owner's second call
  // safely replays M36's cached result instead of re-attempting real
  // deletion. A new day naturally mints a fresh key, correctly allowing
  // that day's newly-eligible rows to be purged.
  const dateStamp = input.now().toISOString().slice(0, 10);

  let ownersProcessed = 0;
  let ownersFailed = 0;
  let totalEligible = 0;
  let totalPurged = 0;
  let totalFailed = 0;

  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= ownerIds.length) return;

      const ownerUserId = ownerIds[index];
      const idempotencyKey = `automation-${dateStamp}-${ownerUserId}`;
      try {
        const result = await input.purgeForOwner(ownerUserId, idempotencyKey);
        ownersProcessed += 1;
        totalEligible += result.eligibleCount;
        totalPurged += result.purgedCount;
        totalFailed += result.failedCount;
      } catch {
        // A single owner's failure (e.g. a lock conflict with a
        // concurrent interactive purge, or an unexpected error) is
        // recorded and the sweep continues with the remaining owners --
        // never silently turned into that owner's success, and never
        // allowed to abort everyone else's legitimate purge.
        ownersFailed += 1;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(input.maxConcurrency, ownerIds.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { ownersProcessed, ownersFailed, totalEligible, totalPurged, totalFailed, hasMore };
}
