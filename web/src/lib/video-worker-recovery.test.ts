import { describe, expect, it, vi } from "vitest";

import { runVideoDemonstrationRecoverySweep } from "@/lib/video-worker-recovery";

// Real AI Video Demonstration, Stage 3 (task §4/§17) -- pure sweep tests,
// mirroring image-asset-retention-automation.test.ts's own conventions.
// No I/O, no database, no provider -- both dependencies are injected fakes.

const NOW = new Date("2026-08-29T10:00:00.000Z");
function fixedNow(): Date {
  return NOW;
}

describe("runVideoDemonstrationRecoverySweep", () => {
  it("does nothing and reports zero counts when nothing is due", async () => {
    const findDueGenerations = vi.fn(async () => []);
    const executeGeneration = vi.fn(async () => ({ outcome: "submitted" }));

    const result = await runVideoDemonstrationRecoverySweep({ now: fixedNow, maxGenerationsPerRun: 10, maxConcurrency: 3, findDueGenerations, executeGeneration });

    expect(result).toEqual({ generationsFound: 0, outcomeCounts: {}, generationsErrored: 0, hasMore: false });
    expect(executeGeneration).not.toHaveBeenCalled();
  });

  it("executes every due generation exactly once and aggregates outcome counts", async () => {
    const due = [
      { id: "gen-a", ownerUserId: "owner-a" },
      { id: "gen-b", ownerUserId: "owner-b" },
      { id: "gen-c", ownerUserId: "owner-c" },
    ];
    const findDueGenerations = vi.fn(async () => due);
    const executeGeneration = vi.fn(async (id: string) => {
      if (id === "gen-a") return { outcome: "submitted" };
      if (id === "gen-b") return { outcome: "completed" };
      return { outcome: "still_processing" };
    });

    const result = await runVideoDemonstrationRecoverySweep({ now: fixedNow, maxGenerationsPerRun: 10, maxConcurrency: 3, findDueGenerations, executeGeneration });

    expect(result).toEqual({ generationsFound: 3, outcomeCounts: { submitted: 1, completed: 1, still_processing: 1 }, generationsErrored: 0, hasMore: false });
    expect(executeGeneration).toHaveBeenCalledTimes(3);
    expect(executeGeneration).toHaveBeenCalledWith("gen-a", "owner-a");
  });

  it("one generation's thrown (unexpected) failure never blocks the rest of the sweep, and is recorded distinctly -- never a false success", async () => {
    const due = [
      { id: "gen-a", ownerUserId: "owner-a" },
      { id: "gen-b", ownerUserId: "owner-b" },
      { id: "gen-c", ownerUserId: "owner-c" },
    ];
    const findDueGenerations = vi.fn(async () => due);
    const executeGeneration = vi.fn(async (id: string) => {
      if (id === "gen-b") throw new Error("simulated unexpected persistence outage");
      return { outcome: "submitted" };
    });

    const result = await runVideoDemonstrationRecoverySweep({ now: fixedNow, maxGenerationsPerRun: 10, maxConcurrency: 3, findDueGenerations, executeGeneration });

    expect(result.generationsFound).toBe(3);
    expect(result.generationsErrored).toBe(1);
    expect(result.outcomeCounts.submitted).toBe(2);
    expect(executeGeneration).toHaveBeenCalledTimes(3);
  });

  it("bounds the batch to maxGenerationsPerRun and reports hasMore when more are due", async () => {
    const findDueGenerations = vi.fn(async (_now: Date, limit: number) =>
      Array.from({ length: limit }, (_, i) => ({ id: `gen-${i}`, ownerUserId: `owner-${i}` })),
    );
    const executeGeneration = vi.fn(async () => ({ outcome: "submitted" }));

    const result = await runVideoDemonstrationRecoverySweep({ now: fixedNow, maxGenerationsPerRun: 5, maxConcurrency: 3, findDueGenerations, executeGeneration });

    expect(findDueGenerations).toHaveBeenCalledWith(NOW, 6); // limit+1, to detect "more"
    expect(result.generationsFound).toBe(5);
    expect(result.hasMore).toBe(true);
    expect(executeGeneration).toHaveBeenCalledTimes(5);
  });

  it("does not report hasMore when exactly maxGenerationsPerRun are due (not more)", async () => {
    const findDueGenerations = vi.fn(async (_now: Date, limit: number) =>
      Array.from({ length: 5 }, (_, i) => ({ id: `gen-${i}`, ownerUserId: `owner-${i}` })).slice(0, Math.min(5, limit)),
    );
    const executeGeneration = vi.fn(async () => ({ outcome: "submitted" }));

    const result = await runVideoDemonstrationRecoverySweep({ now: fixedNow, maxGenerationsPerRun: 5, maxConcurrency: 3, findDueGenerations, executeGeneration });

    expect(result.generationsFound).toBe(5);
    expect(result.hasMore).toBe(false);
  });

  it("respects a concurrency cap smaller than the batch size while still processing every due generation exactly once", async () => {
    const due = Array.from({ length: 8 }, (_, i) => ({ id: `gen-${i}`, ownerUserId: `owner-${i}` }));
    const findDueGenerations = vi.fn(async () => due);
    let concurrentInFlight = 0;
    let maxObservedConcurrency = 0;
    const seenIds = new Set<string>();
    const executeGeneration = vi.fn(async (id: string) => {
      seenIds.add(id);
      concurrentInFlight += 1;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrentInFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrentInFlight -= 1;
      return { outcome: "submitted" };
    });

    const result = await runVideoDemonstrationRecoverySweep({ now: fixedNow, maxGenerationsPerRun: 20, maxConcurrency: 3, findDueGenerations, executeGeneration });

    expect(seenIds.size).toBe(8); // every due generation processed exactly once
    expect(maxObservedConcurrency).toBeLessThanOrEqual(3);
    expect(result.generationsFound).toBe(8);
  });
});
