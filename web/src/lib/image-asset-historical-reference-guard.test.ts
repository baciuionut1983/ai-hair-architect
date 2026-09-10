import { describe, expect, it } from "vitest";

import {
  findHistoricallyReferencedImageAssetIds,
  HISTORICAL_IMAGE_REFERENCE_SOURCES,
  type HistoricalImageReferenceDatabase,
} from "@/lib/image-asset-historical-reference-guard";

// RETENTION SAFETY GATE -- pure merge/fail-closed logic. No I/O; every
// source is a hand-built fake, mirroring this repo's own established
// "no mocking library, fake matching the real shape" convention.

function fakeDb(overrides: Partial<HistoricalImageReferenceDatabase> = {}): HistoricalImageReferenceDatabase {
  const empty = async () => [] as readonly string[];
  return {
    analysisByImageAssetId: empty,
    imageAnalysisByAssetId: empty,
    analysisProposalBySourceImageAssetId: empty,
    technicalVisualMapBySourceImageAssetId: empty,
    technicalVisualMapSpatialBindingBySourceImageAssetId: empty,
    hairStateSnapshotBySourceImageAssetId: empty,
    hairStateSnapshotEvidenceByImageAssetId: empty,
    captureSetImageByImageAssetId: empty,
    photoPreviewGenerationBySourceImageAssetId: empty,
    photoPreviewGenerationByGeneratedImageAssetId: empty,
    videoDemonstrationGenerationBySourceGeneratedImageAssetId: empty,
    technicalExecutionGenerationRequestByImageAssetId: empty,
    ...overrides,
  };
}

describe("findHistoricallyReferencedImageAssetIds", () => {
  it("declares exactly 12 real reference sources", () => {
    expect(HISTORICAL_IMAGE_REFERENCE_SOURCES).toHaveLength(12);
  });

  it("returns an empty set for an empty candidate list without calling any source", async () => {
    let called = false;
    const db = fakeDb({ analysisByImageAssetId: async () => { called = true; return []; } });
    const result = await findHistoricallyReferencedImageAssetIds(db, []);
    expect(result.size).toBe(0);
    expect(called).toBe(false);
  });

  it("returns an empty set when no source reports any reference", async () => {
    const result = await findHistoricallyReferencedImageAssetIds(fakeDb(), ["img-1", "img-2"]);
    expect(result.size).toBe(0);
  });

  it("a reference from Analysis alone protects the id", async () => {
    const db = fakeDb({ analysisByImageAssetId: async (ids) => ids.filter((id) => id === "img-1") });
    const result = await findHistoricallyReferencedImageAssetIds(db, ["img-1", "img-2"]);
    expect([...result]).toEqual(["img-1"]);
  });

  it("a reference from ImageAnalysis alone protects the id (the cascade-risk edge)", async () => {
    const db = fakeDb({ imageAnalysisByAssetId: async (ids) => ids.filter((id) => id === "img-2") });
    const result = await findHistoricallyReferencedImageAssetIds(db, ["img-1", "img-2"]);
    expect([...result]).toEqual(["img-2"]);
  });

  it("a reference from CaptureSetImage alone protects the id (no second multi-view authority needed)", async () => {
    const db = fakeDb({ captureSetImageByImageAssetId: async (ids) => ids.filter((id) => id === "img-3") });
    const result = await findHistoricallyReferencedImageAssetIds(db, ["img-3"]);
    expect([...result]).toEqual(["img-3"]);
  });

  it("a reference from HairStateSnapshotEvidence alone protects the id, regardless of evidenceRole", async () => {
    const db = fakeDb({ hairStateSnapshotEvidenceByImageAssetId: async (ids) => [...ids] });
    const result = await findHistoricallyReferencedImageAssetIds(db, ["target-ref-img", "result-observed-img"]);
    expect(result.has("target-ref-img")).toBe(true);
    expect(result.has("result-observed-img")).toBe(true);
  });

  it("PhotoPreviewGeneration's generatedImageAssetId protects a generated preview image distinctly from sourceImageAssetId", async () => {
    const db = fakeDb({
      photoPreviewGenerationBySourceImageAssetId: async (ids) => ids.filter((id) => id === "source-img"),
      photoPreviewGenerationByGeneratedImageAssetId: async (ids) => ids.filter((id) => id === "generated-img"),
    });
    const result = await findHistoricallyReferencedImageAssetIds(db, ["source-img", "generated-img", "unrelated-img"]);
    expect([...result].sort()).toEqual(["generated-img", "source-img"]);
  });

  it("unions references across multiple sources for the same id without duplication", async () => {
    const db = fakeDb({
      analysisByImageAssetId: async (ids) => ids.filter((id) => id === "img-shared"),
      hairStateSnapshotEvidenceByImageAssetId: async (ids) => ids.filter((id) => id === "img-shared"),
    });
    const result = await findHistoricallyReferencedImageAssetIds(db, ["img-shared"]);
    expect([...result]).toEqual(["img-shared"]);
  });

  it("fails closed: if any one source throws, the whole lookup throws -- never resolves to an optimistic empty set", async () => {
    const db = fakeDb({
      technicalVisualMapBySourceImageAssetId: async () => {
        throw new Error("transient DB error");
      },
    });
    await expect(findHistoricallyReferencedImageAssetIds(db, ["img-1"])).rejects.toThrow("transient DB error");
  });
});
