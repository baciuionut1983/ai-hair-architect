import { describe, expect, it } from "vitest";

import {
  evaluateVideoAssetPurgeEligibility,
  findHistoricallyReferencedVideoAssetIds,
  HISTORICAL_VIDEO_REFERENCE_SOURCES,
  type HistoricalVideoReferenceDatabase,
} from "@/lib/video-asset-historical-reference-guard";

// VIDEO RETENTION SAFETY GATE -- pure merge/fail-closed logic. No I/O;
// every source is a hand-built fake, mirroring
// image-asset-historical-reference-guard.test.ts's own established
// convention exactly.

function fakeDb(overrides: Partial<HistoricalVideoReferenceDatabase> = {}): HistoricalVideoReferenceDatabase {
  const empty = async () => [] as readonly string[];
  return {
    videoDemonstrationGenerationByGeneratedVideoAssetId: empty,
    technicalExecutionVideoGenerationByGeneratedVideoAssetId: empty,
    professionalLearningEvidenceByVideoAssetId: empty,
    ...overrides,
  };
}

describe("findHistoricallyReferencedVideoAssetIds", () => {
  it("declares exactly 3 real reference sources", () => {
    expect(HISTORICAL_VIDEO_REFERENCE_SOURCES).toHaveLength(3);
  });

  it("returns an empty set for an empty candidate list without calling any source", async () => {
    let called = false;
    const db = fakeDb({ videoDemonstrationGenerationByGeneratedVideoAssetId: async () => { called = true; return []; } });
    const result = await findHistoricallyReferencedVideoAssetIds(db, []);
    expect(result.size).toBe(0);
    expect(called).toBe(false);
  });

  it("returns an empty set when no source reports any reference", async () => {
    const result = await findHistoricallyReferencedVideoAssetIds(fakeDb(), ["vid-1", "vid-2"]);
    expect(result.size).toBe(0);
  });

  it("a reference from VideoDemonstrationGeneration (Result Video history) alone protects the id", async () => {
    const db = fakeDb({ videoDemonstrationGenerationByGeneratedVideoAssetId: async (ids) => ids.filter((id) => id === "vid-1") });
    const result = await findHistoricallyReferencedVideoAssetIds(db, ["vid-1", "vid-2"]);
    expect([...result]).toEqual(["vid-1"]);
  });

  it("a reference from TechnicalExecutionVideoGeneration alone protects the id", async () => {
    const db = fakeDb({ technicalExecutionVideoGenerationByGeneratedVideoAssetId: async (ids) => ids.filter((id) => id === "vid-2") });
    const result = await findHistoricallyReferencedVideoAssetIds(db, ["vid-1", "vid-2"]);
    expect([...result]).toEqual(["vid-2"]);
  });

  it("a reference from ProfessionalLearningEvidence (a private teaching video) alone protects the id", async () => {
    const db = fakeDb({ professionalLearningEvidenceByVideoAssetId: async (ids) => ids.filter((id) => id === "vid-3") });
    const result = await findHistoricallyReferencedVideoAssetIds(db, ["vid-1", "vid-3"]);
    expect([...result]).toEqual(["vid-3"]);
  });

  it("merges references from multiple sources without duplication", async () => {
    const db = fakeDb({
      videoDemonstrationGenerationByGeneratedVideoAssetId: async (ids) => ids.filter((id) => id === "vid-1"),
      professionalLearningEvidenceByVideoAssetId: async (ids) => ids.filter((id) => id === "vid-1"),
    });
    const result = await findHistoricallyReferencedVideoAssetIds(db, ["vid-1"]);
    expect([...result]).toEqual(["vid-1"]);
  });

  it("fails closed: a throwing source propagates rather than being swallowed", async () => {
    const db = fakeDb({
      technicalExecutionVideoGenerationByGeneratedVideoAssetId: async () => {
        throw new Error("DB_UNAVAILABLE");
      },
    });
    await expect(findHistoricallyReferencedVideoAssetIds(db, ["vid-1"])).rejects.toThrow("DB_UNAVAILABLE");
  });
});

describe("evaluateVideoAssetPurgeEligibility (structured reason, Stage 8.5L2 Part 9)", () => {
  it("reports NOT_REFERENCED + eligible for an unreferenced video", async () => {
    const result = await evaluateVideoAssetPurgeEligibility(fakeDb(), ["vid-1"]);
    expect(result).toEqual([{ videoAssetId: "vid-1", eligible: true, reason: "NOT_REFERENCED" }]);
  });

  it("a governed VideoAsset cannot be purged while referenced -- reports REFERENCED_BY_HISTORICAL_RECORD + not eligible", async () => {
    const db = fakeDb({ professionalLearningEvidenceByVideoAssetId: async (ids) => [...ids] });
    const result = await evaluateVideoAssetPurgeEligibility(db, ["vid-1"]);
    expect(result).toEqual([{ videoAssetId: "vid-1", eligible: false, reason: "REFERENCED_BY_HISTORICAL_RECORD" }]);
  });

  it("evaluates a mixed batch independently, one reason per row", async () => {
    const db = fakeDb({ videoDemonstrationGenerationByGeneratedVideoAssetId: async (ids) => ids.filter((id) => id === "vid-referenced") });
    const result = await evaluateVideoAssetPurgeEligibility(db, ["vid-referenced", "vid-free"]);
    expect(result).toEqual([
      { videoAssetId: "vid-referenced", eligible: false, reason: "REFERENCED_BY_HISTORICAL_RECORD" },
      { videoAssetId: "vid-free", eligible: true, reason: "NOT_REFERENCED" },
    ]);
  });
});
