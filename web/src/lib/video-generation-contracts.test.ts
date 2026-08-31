import { describe, expect, it } from "vitest";

import {
  buildSealedVideoDemonstrationRequest,
  buildVideoDemonstrationPreserveInvariants,
  computeVideoDemonstrationRequestFingerprint,
  isSealedVideoDemonstrationRequest,
  isSealedVideoDemonstrationSourceImage,
  isSealedVideoDemonstrationTargetSummary,
  isVideoDemonstrationPreserveInvariant,
  VIDEO_DEMONSTRATION_PRESERVE_INVARIANTS,
  VIDEO_DEMONSTRATION_SCHEMA_VERSION,
} from "@/lib/video-generation-contracts";

// Real AI Video Demonstration, Stage 1 -- pure contract tests, no I/O, no
// database. Mirrors photo-preview-contracts.test.ts's own scope: shape
// validators + deterministic fingerprinting only.

const sourceImage = { assetId: "asset-1", mimeType: "image/png", contentSha256: "a".repeat(64) };
const targetSummary = { structuralTechnique: "graduation" };

function buildRequest() {
  return buildSealedVideoDemonstrationRequest({ sourceImage, viewLabel: "front", targetSummary });
}

describe("video-generation-contracts", () => {
  describe("isSealedVideoDemonstrationSourceImage", () => {
    it("accepts a well-formed source image, with contentSha256 either a string or null", () => {
      expect(isSealedVideoDemonstrationSourceImage(sourceImage)).toBe(true);
      expect(isSealedVideoDemonstrationSourceImage({ ...sourceImage, contentSha256: null })).toBe(true);
    });

    it("rejects a missing/empty assetId or mimeType, and a non-string/non-null contentSha256", () => {
      expect(isSealedVideoDemonstrationSourceImage({ ...sourceImage, assetId: "" })).toBe(false);
      expect(isSealedVideoDemonstrationSourceImage({ ...sourceImage, mimeType: "" })).toBe(false);
      expect(isSealedVideoDemonstrationSourceImage({ ...sourceImage, contentSha256: 123 })).toBe(false);
      expect(isSealedVideoDemonstrationSourceImage(null)).toBe(false);
      expect(isSealedVideoDemonstrationSourceImage("not an object")).toBe(false);
    });
  });

  describe("isSealedVideoDemonstrationTargetSummary", () => {
    it("accepts a non-empty structuralTechnique string, rejects an empty/missing one", () => {
      expect(isSealedVideoDemonstrationTargetSummary(targetSummary)).toBe(true);
      expect(isSealedVideoDemonstrationTargetSummary({ structuralTechnique: "" })).toBe(false);
      expect(isSealedVideoDemonstrationTargetSummary({})).toBe(false);
    });
  });

  describe("preserve invariants", () => {
    it("buildVideoDemonstrationPreserveInvariants returns every invariant in the fixed list, and every one passes the type guard", () => {
      const built = buildVideoDemonstrationPreserveInvariants();
      expect(built).toEqual([...VIDEO_DEMONSTRATION_PRESERVE_INVARIANTS]);
      for (const invariant of built) {
        expect(isVideoDemonstrationPreserveInvariant(invariant)).toBe(true);
      }
    });

    it("never includes modify_hair_only -- Video V1 never modifies anything", () => {
      expect((VIDEO_DEMONSTRATION_PRESERVE_INVARIANTS as readonly string[]).includes("modify_hair_only")).toBe(false);
    });

    it("rejects an unknown invariant string", () => {
      expect(isVideoDemonstrationPreserveInvariant("preserve_something_invented")).toBe(false);
    });
  });

  describe("buildSealedVideoDemonstrationRequest / isSealedVideoDemonstrationRequest", () => {
    it("assembles a request that is schema-version-stamped and passes its own validator", () => {
      const request = buildRequest();
      expect(request.schemaVersion).toBe(VIDEO_DEMONSTRATION_SCHEMA_VERSION);
      expect(request.sourceImage).toEqual(sourceImage);
      expect(request.viewLabel).toBe("front");
      expect(request.targetSummary).toEqual(targetSummary);
      expect(request.preserveContract.invariants).toEqual([...VIDEO_DEMONSTRATION_PRESERVE_INVARIANTS]);
      expect(isSealedVideoDemonstrationRequest(request)).toBe(true);
    });

    it("rejects a request with a bad viewLabel, a malformed sourceImage, or a non-array invariants list", () => {
      const request = buildRequest();
      expect(isSealedVideoDemonstrationRequest({ ...request, viewLabel: "not-a-real-view" })).toBe(false);
      expect(isSealedVideoDemonstrationRequest({ ...request, sourceImage: { assetId: "" } })).toBe(false);
      expect(isSealedVideoDemonstrationRequest({ ...request, preserveContract: { invariants: "not-an-array" } })).toBe(false);
      expect(isSealedVideoDemonstrationRequest({ ...request, preserveContract: { invariants: ["preserve_identity", "made_up"] } })).toBe(false);
      expect(isSealedVideoDemonstrationRequest(null)).toBe(false);
    });
  });

  describe("computeVideoDemonstrationRequestFingerprint", () => {
    const base = { ownerUserId: "owner-1", clientId: "client-1", photoPreviewGenerationId: "pp-1", provider: "google", model: "veo-3.1-lite-generate-preview", variationIndex: 0 };

    it("is deterministic for identical input", () => {
      expect(computeVideoDemonstrationRequestFingerprint(base)).toBe(computeVideoDemonstrationRequestFingerprint({ ...base }));
    });

    it("changes when any single field changes (owner, client, photoPreviewGenerationId, provider, model, variationIndex)", () => {
      const reference = computeVideoDemonstrationRequestFingerprint(base);
      expect(computeVideoDemonstrationRequestFingerprint({ ...base, ownerUserId: "owner-2" })).not.toBe(reference);
      expect(computeVideoDemonstrationRequestFingerprint({ ...base, clientId: "client-2" })).not.toBe(reference);
      expect(computeVideoDemonstrationRequestFingerprint({ ...base, photoPreviewGenerationId: "pp-2" })).not.toBe(reference);
      expect(computeVideoDemonstrationRequestFingerprint({ ...base, provider: "other" })).not.toBe(reference);
      expect(computeVideoDemonstrationRequestFingerprint({ ...base, model: "veo-3.1-generate-preview" })).not.toBe(reference);
      expect(computeVideoDemonstrationRequestFingerprint({ ...base, variationIndex: 1 })).not.toBe(reference);
    });

    it("is a 64-character hex sha256 digest", () => {
      const fingerprint = computeVideoDemonstrationRequestFingerprint(base);
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
