import { describe, expect, it } from "vitest";

import {
  QUALIFICATION_EVIDENCE_SOURCES,
  QUALIFICATION_STATUSES,
  TECHNICAL_EXECUTION_GENERATION_PURPOSES,
  evaluateTechnicalExecutionGenerationReadiness,
  isQualificationEvidenceSource,
  isQualificationStatus,
  isTechnicalExecutionGenerationPurpose,
  type TechnicalExecutionGenerationReadinessCaptureSet,
  type TechnicalExecutionGenerationReadinessCaptureSetImage,
  type TechnicalExecutionGenerationReadinessRequest,
} from "@/lib/technical-execution-generation-validators";

// SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY. This suite
// tests the pure readiness evaluator only; the real, Prisma-backed
// end-to-end proof lives in technical-execution-generation-repository.test.ts.

function baseRequest(overrides: Partial<TechnicalExecutionGenerationReadinessRequest> = {}): TechnicalExecutionGenerationReadinessRequest {
  return {
    ownerUserId: "owner-1",
    clientId: "client-1",
    purpose: "TECHNICAL_EXECUTION_VIDEO",
    captureSetId: "capture-set-1",
    captureSetImageId: "capture-set-image-1",
    imageAssetId: "image-asset-1",
    consentGrantedAt: "2026-09-08T00:00:00.000Z",
    qualificationStatus: "QUALIFIED",
    sealedAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

function baseCaptureSet(overrides: Partial<TechnicalExecutionGenerationReadinessCaptureSet> = {}): TechnicalExecutionGenerationReadinessCaptureSet {
  return { id: "capture-set-1", ownerUserId: "owner-1", clientId: "client-1", ...overrides };
}

function baseCaptureSetImage(overrides: Partial<TechnicalExecutionGenerationReadinessCaptureSetImage> = {}): TechnicalExecutionGenerationReadinessCaptureSetImage {
  return {
    id: "capture-set-image-1",
    captureSetId: "capture-set-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    imageAssetId: "image-asset-1",
    viewLabel: "FRONT",
    ...overrides,
  };
}

describe("technical-execution-generation-validators (pure readiness evaluator)", () => {
  it("recognizes exactly one real purpose today", () => {
    expect(TECHNICAL_EXECUTION_GENERATION_PURPOSES).toEqual(["TECHNICAL_EXECUTION_VIDEO"]);
    expect(isTechnicalExecutionGenerationPurpose("TECHNICAL_EXECUTION_VIDEO")).toBe(true);
    expect(isTechnicalExecutionGenerationPurpose("PHOTO_PREVIEW")).toBe(false);
    expect(isTechnicalExecutionGenerationPurpose("RESULT_VIDEO")).toBe(false);
    expect(isTechnicalExecutionGenerationPurpose("HAIR_ANALYSIS")).toBe(false);
  });

  it("recognizes exactly the three qualification statuses and five evidence sources", () => {
    expect(QUALIFICATION_STATUSES).toEqual(["NOT_EVALUATED", "QUALIFIED", "REJECTED"]);
    expect(QUALIFICATION_EVIDENCE_SOURCES).toEqual(["MANUAL_USER_CONFIRMATION", "PROFESSIONAL_CONFIRMATION", "AUTOMATED_CHECK", "SYSTEM_METADATA", "HYBRID"]);
    for (const status of QUALIFICATION_STATUSES) expect(isQualificationStatus(status)).toBe(true);
    for (const source of QUALIFICATION_EVIDENCE_SOURCES) expect(isQualificationEvidenceSource(source)).toBe(true);
    expect(isQualificationStatus("MAYBE")).toBe(false);
    expect(isQualificationEvidenceSource("AI_VISION")).toBe(false);
  });

  it("a fully valid, sealed, consented, qualified request is READY", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest(), baseCaptureSet(), baseCaptureSetImage());
    expect(result).toEqual({ status: "READY" });
  });

  it("blocks on unrecognized purpose", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest({ purpose: "PHOTO_PREVIEW" }), baseCaptureSet(), baseCaptureSetImage());
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks when the Capture Set is missing", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest(), null, baseCaptureSetImage());
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks when the Capture Set belongs to a different client", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest(), baseCaptureSet({ clientId: "client-2" }), baseCaptureSetImage());
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks when the Capture Set image is missing", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest(), baseCaptureSet(), null);
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks when the image does not belong to the selected Capture Set", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest(), baseCaptureSet(), baseCaptureSetImage({ captureSetId: "capture-set-other" }));
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks on an unrecognized view label", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest(), baseCaptureSet(), baseCaptureSetImage({ viewLabel: "TOP" }));
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks when the frozen imageAssetId diverges from the live Capture Set image", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest(), baseCaptureSet(), baseCaptureSetImage({ imageAssetId: "image-asset-different" }));
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks without consent", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest({ consentGrantedAt: null }), baseCaptureSet(), baseCaptureSetImage());
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks unless qualification is exactly QUALIFIED", () => {
    expect(evaluateTechnicalExecutionGenerationReadiness(baseRequest({ qualificationStatus: "NOT_EVALUATED" }), baseCaptureSet(), baseCaptureSetImage()).status).toBe(
      "BLOCKED",
    );
    expect(evaluateTechnicalExecutionGenerationReadiness(baseRequest({ qualificationStatus: "REJECTED" }), baseCaptureSet(), baseCaptureSetImage()).status).toBe("BLOCKED");
  });

  it("blocks unless sealed", () => {
    const result = evaluateTechnicalExecutionGenerationReadiness(baseRequest({ sealedAt: null }), baseCaptureSet(), baseCaptureSetImage());
    expect(result.status).toBe("BLOCKED");
  });

  it("the module exports no consent-granting, quality-deciding, or provider-calling function", async () => {
    const validatorsModule = await import("@/lib/technical-execution-generation-validators");
    const exported = Object.keys(validatorsModule).join(" ").toLowerCase();
    for (const forbidden of ["grantconsent", "detectquality", "veo", "gemini", "callprovider"]) {
      expect(exported.includes(forbidden)).toBe(false);
    }
  });
});
