import { describe, expect, it } from "vitest";

import { toSafeVideoDemonstrationFailureMessage, toVideoDemonstrationStatusView, type VideoDemonstrationStatusView } from "@/lib/video-demonstration-status-view";
import type { VideoDemonstrationGenerationRecord } from "@/lib/video-generation-repository";

// Real AI Video Demonstration, Stage 3 (task §8/§10) -- pure tests for the
// ONE stable, frontend-safe contract. No I/O, no database.

function baseRecord(overrides: Partial<VideoDemonstrationGenerationRecord> = {}): VideoDemonstrationGenerationRecord {
  return {
    id: "gen-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    photoPreviewGenerationId: "pp-1",
    analysisProposalId: "proposal-1",
    analysisProposalConfirmedAt: "2026-08-01T00:00:00.000Z",
    technicalVisualMapId: "map-1",
    mapVersion: 1,
    spatialBindingId: "binding-1",
    spatialVersion: 1,
    sourceGeneratedImageAssetId: "asset-source-1",
    frozenSourceContentSha256: "a".repeat(64),
    provider: "google",
    model: "veo-3.1-lite-generate-preview",
    generationSchemaVersion: "1.0.0",
    sealedRequest: {
      schemaVersion: "1.0.0",
      sourceImage: { assetId: "asset-source-1", mimeType: "image/png", contentSha256: null },
      viewLabel: "front",
      targetSummary: { structuralTechnique: "graduation" },
      preserveContract: { invariants: ["preserve_identity"] },
    },
    requestFingerprint: "f".repeat(64),
    variationIndex: 0,
    status: "REQUESTED",
    attemptCount: 0,
    providerOperationId: null,
    generatedVideoAssetId: null,
    errorCode: null,
    errorMetadata: null,
    requestedAt: "2026-08-29T10:00:00.000Z",
    submittedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
    ...overrides,
  };
}

describe("toVideoDemonstrationStatusView", () => {
  it("maps a REQUESTED record to the minimal safe view", () => {
    const view = toVideoDemonstrationStatusView(baseRecord());
    expect(view).toEqual({
      id: "gen-1",
      photoPreviewGenerationId: "pp-1",
      clientId: "client-1",
      status: "REQUESTED",
      variationIndex: 0,
      createdAt: "2026-08-29T10:00:00.000Z",
      processingStartedAt: null,
      completedAt: null,
      failedAt: null,
      failureMessage: null,
      resultAsset: null,
      retryEligible: false,
    });
  });

  it("a PROCESSING record exposes processingStartedAt but no result/failure fields", () => {
    const view = toVideoDemonstrationStatusView(baseRecord({ status: "PROCESSING", startedAt: "2026-08-29T10:00:05.000Z" }));
    expect(view.status).toBe("PROCESSING");
    expect(view.processingStartedAt).toBe("2026-08-29T10:00:05.000Z");
    expect(view.resultAsset).toBeNull();
    expect(view.failureMessage).toBeNull();
    expect(view.retryEligible).toBe(false);
  });

  it("a COMPLETED record exposes ONLY the assetId as resultAsset -- no storage internals", () => {
    const view = toVideoDemonstrationStatusView(baseRecord({ status: "COMPLETED", completedAt: "2026-08-29T10:02:00.000Z", generatedVideoAssetId: "video-asset-1" }));
    expect(view.resultAsset).toEqual({ assetId: "video-asset-1" });
    expect(Object.keys(view.resultAsset as object)).toEqual(["assetId"]);
    expect(view.completedAt).toBe("2026-08-29T10:02:00.000Z");
    expect(view.failureMessage).toBeNull();
  });

  it("a FAILED record is retry-eligible and carries a safe failure message, never the raw internal errorCode", () => {
    const view = toVideoDemonstrationStatusView(baseRecord({ status: "FAILED", failedAt: "2026-08-29T10:02:00.000Z", errorCode: "VIDEO_DEMONSTRATION_PROVIDER_REFUSED" }));
    expect(view.retryEligible).toBe(true);
    expect(view.failureMessage).toBe("This video could not be generated from the source image. Try a different photo preview.");
    expect(JSON.stringify(view)).not.toContain("VIDEO_DEMONSTRATION_PROVIDER_REFUSED");
  });

  it("never includes providerOperationId, sealedRequest, ownerUserId, attemptCount, or raw errorMetadata under any status", () => {
    for (const status of ["REQUESTED", "PROCESSING", "COMPLETED", "FAILED"] as const) {
      const view = toVideoDemonstrationStatusView(
        baseRecord({ status, providerOperationId: "op-should-never-leak", errorMetadata: { rawProviderPayload: "secret-shaped-internal-detail" } }),
      );
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain("op-should-never-leak");
      expect(serialized).not.toContain("secret-shaped-internal-detail");
      expect(serialized).not.toContain("sealedRequest");
      expect(serialized).not.toContain("ownerUserId");
      expect(serialized).not.toContain("attemptCount");
      const keys = Object.keys(view) as (keyof VideoDemonstrationStatusView)[];
      expect(keys).not.toContain("providerOperationId" as never);
    }
  });
});

describe("toSafeVideoDemonstrationFailureMessage", () => {
  it("returns null for a null errorCode (not FAILED, or FAILED with no code recorded)", () => {
    expect(toSafeVideoDemonstrationFailureMessage(null)).toBeNull();
  });

  it("every real internal error code this codebase can persist has an explicit, non-generic safe message", () => {
    const codes = [
      "VIDEO_DEMONSTRATION_PROVIDER_REFUSED",
      "VIDEO_DEMONSTRATION_STORAGE_FAILED",
      "VIDEO_DEMONSTRATION_SOURCE_UNAVAILABLE",
      "VIDEO_DEMONSTRATION_CONFIGURATION_ERROR",
      "VIDEO_DEMONSTRATION_OPERATION_NOT_FOUND",
      "VIDEO_DEMONSTRATION_PROVIDER_RATE_LIMITED",
      "VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT",
      "VIDEO_DEMONSTRATION_PROVIDER_INVALID_RESPONSE",
      "VIDEO_DEMONSTRATION_PROVIDER_ERROR",
      "VIDEO_DEMONSTRATION_PROCESSING_TIMEOUT",
    ];
    for (const code of codes) {
      const message = toSafeVideoDemonstrationFailureMessage(code);
      expect(typeof message).toBe("string");
      expect((message as string).length).toBeGreaterThan(0);
      expect(message).not.toContain(code);
    }
  });

  it("an unrecognized/future error code falls through to the generic safe default -- never leaks the raw code", () => {
    const message = toSafeVideoDemonstrationFailureMessage("SOME_FUTURE_INTERNAL_CODE_NOT_YET_MAPPED");
    expect(message).toBe("This video could not be generated. Please try again.");
  });
});
