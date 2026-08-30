import { describe, expect, it } from "vitest";

import {
  buildPhotoPreviewPreserveInvariants,
  buildSealedPhotoPreviewRequest,
  computePhotoPreviewRequestFingerprint,
  isPhotoPreviewPreserveInvariant,
  isSealedPhotoPreviewPreserveContract,
  isSealedPhotoPreviewRequest,
  isSealedPhotoPreviewSourceImage,
  isSealedPhotoPreviewTarget,
  PHOTO_PREVIEW_GENERATION_SCHEMA_VERSION,
  PHOTO_PREVIEW_PRESERVE_INVARIANTS,
  type BuildSealedPhotoPreviewRequestInput,
} from "@/lib/photo-preview-contracts";
import type { TechnicalVisualMapSpatialPayload } from "@/lib/technical-visual-map-spatial-validators";

function validGlobalIntent() {
  return {
    structuralTechnique: "graduation" as const,
    cuttingTechnique: "slice_cutting" as const,
    sectioning: "diagonal_back" as const,
    elevation: "45_deg_graduation" as const,
    distribution: "overdirected_back" as const,
    guideline: "stationary" as const,
  };
}

function validZones() {
  return (["crown", "occipital", "nape", "top", "sides", "fringe"] as const).map((zone) => ({
    zone,
    lengthIntent: "preserve" as const,
    lengthIntentSource: "deterministic_evidence" as const,
    weightIntent: "preserve" as const,
    weightIntentSource: "deterministic_evidence" as const,
    densitySensitive: false,
    densitySensitiveSource: "deterministic_evidence" as const,
    preserve: false,
    preserveSource: "deterministic_evidence" as const,
  }));
}

function validSpatialPayload(): TechnicalVisualMapSpatialPayload {
  return {
    zones: (["crown", "occipital", "nape", "top", "sides", "fringe"] as const).map((zone) => ({ zone, state: "not_placed" as const })),
    perimeter: { state: "not_placed" },
  };
}

function validInput(): BuildSealedPhotoPreviewRequestInput {
  return {
    sourceImage: { assetId: "asset-1", width: 1080, height: 1440, orientation: 0, contentSha256: null, storageVersionId: null },
    viewLabel: "front",
    target: { globalIntent: validGlobalIntent(), zones: validZones(), relationships: [] },
    spatial: validSpatialPayload(),
    mapPreserveConstraints: [],
    contraindications: [],
  };
}

describe("PHOTO_PREVIEW_PRESERVE_INVARIANTS", () => {
  it("modify_hair_only and preserve_face_identity are both present in the fixed, non-configurable list", () => {
    expect(PHOTO_PREVIEW_PRESERVE_INVARIANTS).toContain("modify_hair_only");
    expect(PHOTO_PREVIEW_PRESERVE_INVARIANTS).toContain("preserve_face_identity");
  });

  it("buildPhotoPreviewPreserveInvariants returns a fresh array each call -- mutating the result never affects the canonical list", () => {
    const a = buildPhotoPreviewPreserveInvariants();
    a.push("modify_hair_only");
    const b = buildPhotoPreviewPreserveInvariants();
    expect(b.length).toBe(PHOTO_PREVIEW_PRESERVE_INVARIANTS.length);
  });

  it("isPhotoPreviewPreserveInvariant rejects an unknown string", () => {
    expect(isPhotoPreviewPreserveInvariant("preserve_everything")).toBe(false);
    expect(isPhotoPreviewPreserveInvariant("modify_hair_only")).toBe(true);
  });
});

describe("isSealedPhotoPreviewSourceImage", () => {
  it("accepts a valid source image, rejects zero/negative dimensions", () => {
    expect(isSealedPhotoPreviewSourceImage({ assetId: "a", width: 100, height: 100, orientation: 0, contentSha256: null, storageVersionId: null })).toBe(
      true,
    );
    expect(isSealedPhotoPreviewSourceImage({ assetId: "a", width: 0, height: 100, orientation: 0, contentSha256: null, storageVersionId: null })).toBe(
      false,
    );
  });
});

describe("isSealedPhotoPreviewTarget / isSealedPhotoPreviewPreserveContract", () => {
  it("accepts a valid target built from real TVM zone/relationship shapes", () => {
    expect(isSealedPhotoPreviewTarget({ globalIntent: validGlobalIntent(), zones: validZones(), relationships: [] })).toBe(true);
  });

  it("rejects a target missing a zone or with an invalid globalIntent", () => {
    expect(isSealedPhotoPreviewTarget({ globalIntent: {}, zones: validZones(), relationships: [] })).toBe(false);
    expect(isSealedPhotoPreviewTarget({ globalIntent: validGlobalIntent(), zones: validZones().slice(0, 5), relationships: [] })).toBe(false);
  });

  it("accepts a valid preserve contract, rejects one carrying an invalid invariant", () => {
    expect(isSealedPhotoPreviewPreserveContract({ invariants: ["modify_hair_only"], mapPreserveConstraints: [], contraindications: [] })).toBe(
      true,
    );
    expect(isSealedPhotoPreviewPreserveContract({ invariants: ["not_a_real_invariant"], mapPreserveConstraints: [], contraindications: [] })).toBe(
      false,
    );
  });
});

describe("buildSealedPhotoPreviewRequest / isSealedPhotoPreviewRequest", () => {
  it("assembles a request that round-trips through the runtime validator", () => {
    const request = buildSealedPhotoPreviewRequest(validInput());
    expect(isSealedPhotoPreviewRequest(request)).toBe(true);
    expect(request.schemaVersion).toBe(PHOTO_PREVIEW_GENERATION_SCHEMA_VERSION);
    // Every fixed invariant is present -- never a caller-narrowable subset.
    expect(request.preserveContract.invariants).toEqual(buildPhotoPreviewPreserveInvariants());
  });

  it("freezes the spatial payload VERBATIM -- no regeneration, no inference", () => {
    const input = validInput();
    input.spatial = {
      zones: input.spatial.zones.map((z) => (z.zone === "crown" ? { zone: "crown" as const, state: "placed" as const, x: 0.5, y: 0.1, source: "professional" as const } : z)),
      perimeter: { state: "not_placed" },
    };
    const request = buildSealedPhotoPreviewRequest(input);
    expect(request.spatial).toEqual(input.spatial);
  });

  it("never contains a raw free-text field beyond the closed, structured shape (no 'prompt' or 'instruction' key anywhere)", () => {
    const request = buildSealedPhotoPreviewRequest(validInput());
    const serialized = JSON.stringify(request);
    expect(serialized).not.toMatch(/"prompt"|"instruction"/i);
  });

  it("rejects a malformed persisted value (e.g. a missing preserveContract) as not a valid sealed request", () => {
    const request = buildSealedPhotoPreviewRequest(validInput()) as unknown as Record<string, unknown>;
    delete request.preserveContract;
    expect(isSealedPhotoPreviewRequest(request)).toBe(false);
  });
});

describe("computePhotoPreviewRequestFingerprint", () => {
  const base = {
    ownerUserId: "owner-1",
    clientId: "client-1",
    spatialBindingId: "binding-1",
    spatialVersion: 1,
    provider: "gemini",
    model: "gemini-3.1-flash-image",
    variationIndex: 0,
  };

  it("is deterministic -- identical input always produces the identical fingerprint", () => {
    expect(computePhotoPreviewRequestFingerprint(base)).toBe(computePhotoPreviewRequestFingerprint({ ...base }));
  });

  it("changes when any single field of the scope changes", () => {
    const original = computePhotoPreviewRequestFingerprint(base);
    expect(computePhotoPreviewRequestFingerprint({ ...base, spatialVersion: 2 })).not.toBe(original);
    expect(computePhotoPreviewRequestFingerprint({ ...base, provider: "other" })).not.toBe(original);
    expect(computePhotoPreviewRequestFingerprint({ ...base, model: "gemini-3-pro-image" })).not.toBe(original);
    expect(computePhotoPreviewRequestFingerprint({ ...base, variationIndex: 1 })).not.toBe(original);
    expect(computePhotoPreviewRequestFingerprint({ ...base, spatialBindingId: "binding-2" })).not.toBe(original);
  });

  it("the ordinary default (variationIndex 0) and an explicit variation (index 1) never collide", () => {
    expect(computePhotoPreviewRequestFingerprint(base)).not.toBe(computePhotoPreviewRequestFingerprint({ ...base, variationIndex: 1 }));
  });
});
