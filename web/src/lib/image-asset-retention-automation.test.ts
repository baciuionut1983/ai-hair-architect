import { describe, expect, it, vi } from "vitest";

import { runImageAssetRetentionAutomationSweep } from "./image-asset-retention-automation";

const NOW = new Date("2026-08-10T00:00:00.000Z");
function fixedNow(): Date {
  return NOW;
}

describe("runImageAssetRetentionAutomationSweep", () => {
  it("1. does nothing and reports zero counts when no owner has an eligible row", async () => {
    const findEligibleOwnerIds = vi.fn(async () => []);
    const purgeForOwner = vi.fn(async () => ({ eligibleCount: 0, purgedCount: 0, failedCount: 0 }));

    const result = await runImageAssetRetentionAutomationSweep({
      now: fixedNow,
      maxOwnersPerRun: 10,
      maxConcurrency: 3,
      findEligibleOwnerIds,
      purgeForOwner,
    });

    expect(result).toEqual({ ownersProcessed: 0, ownersFailed: 0, totalEligible: 0, totalPurged: 0, totalFailed: 0, hasMore: false });
    expect(purgeForOwner).not.toHaveBeenCalled();
  });

  it("2. purges every eligible owner and aggregates their counts", async () => {
    const findEligibleOwnerIds = vi.fn(async () => ["owner-a", "owner-b", "owner-c"]);
    const purgeForOwner = vi.fn(async (ownerUserId: string) => {
      if (ownerUserId === "owner-a") return { eligibleCount: 2, purgedCount: 2, failedCount: 0 };
      if (ownerUserId === "owner-b") return { eligibleCount: 1, purgedCount: 1, failedCount: 0 };
      return { eligibleCount: 3, purgedCount: 2, failedCount: 1 };
    });

    const result = await runImageAssetRetentionAutomationSweep({
      now: fixedNow,
      maxOwnersPerRun: 10,
      maxConcurrency: 3,
      findEligibleOwnerIds,
      purgeForOwner,
    });

    expect(result).toMatchObject({
      ownersProcessed: 3,
      ownersFailed: 0,
      totalEligible: 6,
      totalPurged: 5,
      totalFailed: 1,
      hasMore: false,
    });
  });

  it("3. one owner's thrown failure never blocks the rest of the sweep, and is recorded distinctly (never turned into a false success)", async () => {
    const findEligibleOwnerIds = vi.fn(async () => ["owner-a", "owner-b", "owner-c"]);
    const purgeForOwner = vi.fn(async (ownerUserId: string) => {
      if (ownerUserId === "owner-b") throw new Error("RETENTION_CONFLICT");
      return { eligibleCount: 1, purgedCount: 1, failedCount: 0 };
    });

    const result = await runImageAssetRetentionAutomationSweep({
      now: fixedNow,
      maxOwnersPerRun: 10,
      maxConcurrency: 3,
      findEligibleOwnerIds,
      purgeForOwner,
    });

    expect(result.ownersProcessed).toBe(2);
    expect(result.ownersFailed).toBe(1);
    expect(result.totalPurged).toBe(2);
    expect(purgeForOwner).toHaveBeenCalledTimes(3);
  });

  it("4. caps the number of owners processed per run and reports hasMore when more are eligible", async () => {
    const findEligibleOwnerIds = vi.fn(async (limit: number) =>
      Array.from({ length: limit }, (_, i) => `owner-${i}`),
    );
    const purgeForOwner = vi.fn(async () => ({ eligibleCount: 1, purgedCount: 1, failedCount: 0 }));

    const result = await runImageAssetRetentionAutomationSweep({
      now: fixedNow,
      maxOwnersPerRun: 5,
      maxConcurrency: 2,
      findEligibleOwnerIds,
      purgeForOwner,
    });

    expect(findEligibleOwnerIds).toHaveBeenCalledWith(6);
    expect(result.ownersProcessed).toBe(5);
    expect(result.hasMore).toBe(true);
  });

  it("5. reports hasMore=false when exactly maxOwnersPerRun owners are eligible (no overflow)", async () => {
    const findEligibleOwnerIds = vi.fn(async () => ["owner-a", "owner-b"]);
    const purgeForOwner = vi.fn(async () => ({ eligibleCount: 1, purgedCount: 1, failedCount: 0 }));

    const result = await runImageAssetRetentionAutomationSweep({
      now: fixedNow,
      maxOwnersPerRun: 2,
      maxConcurrency: 2,
      findEligibleOwnerIds,
      purgeForOwner,
    });

    expect(result.hasMore).toBe(false);
    expect(purgeForOwner).toHaveBeenCalledTimes(2);
  });

  it("6. derives a deterministic, per-day, per-owner idempotency key", async () => {
    const findEligibleOwnerIds = vi.fn(async () => ["owner-a"]);
    const purgeForOwner = vi.fn(async () => ({ eligibleCount: 1, purgedCount: 1, failedCount: 0 }));

    await runImageAssetRetentionAutomationSweep({
      now: fixedNow,
      maxOwnersPerRun: 10,
      maxConcurrency: 1,
      findEligibleOwnerIds,
      purgeForOwner,
    });

    expect(purgeForOwner).toHaveBeenCalledWith("owner-a", "automation-2026-08-10-owner-a");
  });

  it("7. never exceeds the configured concurrency (observed via a simple in-flight counter)", async () => {
    const owners = Array.from({ length: 8 }, (_, i) => `owner-${i}`);
    const findEligibleOwnerIds = vi.fn(async () => owners);
    let inFlight = 0;
    let maxObservedInFlight = 0;
    const purgeForOwner = vi.fn(async () => {
      inFlight += 1;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { eligibleCount: 1, purgedCount: 1, failedCount: 0 };
    });

    await runImageAssetRetentionAutomationSweep({
      now: fixedNow,
      maxOwnersPerRun: 10,
      maxConcurrency: 3,
      findEligibleOwnerIds,
      purgeForOwner,
    });

    expect(maxObservedInFlight).toBeLessThanOrEqual(3);
    expect(purgeForOwner).toHaveBeenCalledTimes(8);
  });

  it("8. is strictly owner-scoped per call: never mixes up which owner a given purge call was for", async () => {
    const findEligibleOwnerIds = vi.fn(async () => ["owner-x", "owner-y"]);
    const seenOwners: string[] = [];
    const purgeForOwner = vi.fn(async (ownerUserId: string) => {
      seenOwners.push(ownerUserId);
      return { eligibleCount: 1, purgedCount: 1, failedCount: 0 };
    });

    await runImageAssetRetentionAutomationSweep({
      now: fixedNow,
      maxOwnersPerRun: 10,
      maxConcurrency: 2,
      findEligibleOwnerIds,
      purgeForOwner,
    });

    expect(seenOwners.sort()).toEqual(["owner-x", "owner-y"]);
  });
});
