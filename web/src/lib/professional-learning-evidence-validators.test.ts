import { describe, expect, it } from "vitest";

import {
  isProfessionalLearningEvidenceRightsClassification,
  isProfessionalLearningEvidenceStatus,
  isProfessionalLearningEvidenceType,
  isProfessionalLearningEvidenceVisibilityScope,
  isValidCreateProfessionalLearningEvidenceInput,
  isValidEvidenceAssetPointerCombination,
  PROFESSIONAL_LEARNING_EVIDENCE_STATUSES,
  PROFESSIONAL_LEARNING_EVIDENCE_TYPES,
  PROFESSIONAL_LEARNING_EVIDENCE_VISIBILITY_SCOPES,
  requiredAssetPointerKindForEvidenceType,
  type CreateProfessionalLearningEvidenceInput,
} from "@/lib/professional-learning-evidence-validators";

describe("professional-learning-evidence-validators", () => {
  it("declares the 9 evidence types from Stage 8.5L2 Part 2", () => {
    expect([...PROFESSIONAL_LEARNING_EVIDENCE_TYPES].sort()).toEqual(
      ["TEXT", "VOICE_TRANSCRIPT", "IMAGE", "IMAGE_SET", "DIAGRAM", "VIDEO", "EXTERNAL_RESEARCH", "MANUFACTURER_SOURCE", "TREND_SOURCE"].sort(),
    );
  });

  it("visibility scope is exactly one value: PRIVATE_LEARNING_EVIDENCE (default must be PRIVATE)", () => {
    expect(PROFESSIONAL_LEARNING_EVIDENCE_VISIBILITY_SCOPES).toEqual(["PRIVATE_LEARNING_EVIDENCE"]);
    expect(isProfessionalLearningEvidenceVisibilityScope("PRIVATE_LEARNING_EVIDENCE")).toBe(true);
    expect(isProfessionalLearningEvidenceVisibilityScope("PUBLIC")).toBe(false);
    expect(isProfessionalLearningEvidenceVisibilityScope("SHARED_ACADEMY")).toBe(false);
  });

  it("status is a small lifecycle (ACTIVE|REVOKED|DELETED_SOURCE), never a DRAFT/REVIEW/APPROVED knowledge status", () => {
    expect([...PROFESSIONAL_LEARNING_EVIDENCE_STATUSES].sort()).toEqual(["ACTIVE", "DELETED_SOURCE", "REVOKED"]);
    for (const forbidden of ["DRAFT", "REVIEW", "APPROVED", "PENDING"]) {
      expect(isProfessionalLearningEvidenceStatus(forbidden)).toBe(false);
    }
  });

  it("rejects an unknown evidenceType/rightsClassification", () => {
    expect(isProfessionalLearningEvidenceType("PHOTO")).toBe(false);
    expect(isProfessionalLearningEvidenceRightsClassification("PUBLIC_DOMAIN")).toBe(false);
  });

  describe("requiredAssetPointerKindForEvidenceType", () => {
    it("IMAGE and DIAGRAM require imageAssetId", () => {
      expect(requiredAssetPointerKindForEvidenceType("IMAGE")).toBe("imageAssetId");
      expect(requiredAssetPointerKindForEvidenceType("DIAGRAM")).toBe("imageAssetId");
    });
    it("IMAGE_SET requires captureSetId", () => {
      expect(requiredAssetPointerKindForEvidenceType("IMAGE_SET")).toBe("captureSetId");
    });
    it("VIDEO requires videoAssetId", () => {
      expect(requiredAssetPointerKindForEvidenceType("VIDEO")).toBe("videoAssetId");
    });
    it("TEXT/VOICE_TRANSCRIPT/EXTERNAL_RESEARCH/MANUFACTURER_SOURCE/TREND_SOURCE require no pointer", () => {
      for (const type of ["TEXT", "VOICE_TRANSCRIPT", "EXTERNAL_RESEARCH", "MANUFACTURER_SOURCE", "TREND_SOURCE"] as const) {
        expect(requiredAssetPointerKindForEvidenceType(type)).toBeNull();
      }
    });
  });

  describe("isValidEvidenceAssetPointerCombination (mirrors the DB CHECK constraint)", () => {
    it("accepts IMAGE with only imageAssetId set", () => {
      expect(isValidEvidenceAssetPointerCombination("IMAGE", { imageAssetId: "img-1" })).toBe(true);
    });
    it("rejects IMAGE with imageAssetId missing", () => {
      expect(isValidEvidenceAssetPointerCombination("IMAGE", {})).toBe(false);
    });
    it("rejects IMAGE with both imageAssetId and videoAssetId set", () => {
      expect(isValidEvidenceAssetPointerCombination("IMAGE", { imageAssetId: "img-1", videoAssetId: "vid-1" })).toBe(false);
    });
    it("accepts IMAGE_SET with only captureSetId set", () => {
      expect(isValidEvidenceAssetPointerCombination("IMAGE_SET", { captureSetId: "cs-1" })).toBe(true);
    });
    it("accepts VIDEO with only videoAssetId set", () => {
      expect(isValidEvidenceAssetPointerCombination("VIDEO", { videoAssetId: "vid-1" })).toBe(true);
    });
    it("accepts TEXT with zero pointers set", () => {
      expect(isValidEvidenceAssetPointerCombination("TEXT", {})).toBe(true);
    });
    it("rejects TEXT with a pointer set (a future-capable-only type must never carry a real asset yet)", () => {
      expect(isValidEvidenceAssetPointerCombination("TEXT", { imageAssetId: "img-1" })).toBe(false);
    });
    it("rejects EXTERNAL_RESEARCH/MANUFACTURER_SOURCE/TREND_SOURCE with any pointer set", () => {
      for (const type of ["EXTERNAL_RESEARCH", "MANUFACTURER_SOURCE", "TREND_SOURCE"] as const) {
        expect(isValidEvidenceAssetPointerCombination(type, { imageAssetId: "img-1" })).toBe(false);
        expect(isValidEvidenceAssetPointerCombination(type, {})).toBe(true);
      }
    });
  });

  describe("isValidCreateProfessionalLearningEvidenceInput", () => {
    function baseTextInput(overrides: Partial<CreateProfessionalLearningEvidenceInput> = {}): CreateProfessionalLearningEvidenceInput {
      return {
        evidenceType: "TEXT",
        vertical: "hair_cutting",
        originalText: "A professional note about graduation technique.",
        provenance: { channel: "typed" },
        rightsClassification: "USER_OWNED_OR_AUTHORIZED",
        ...overrides,
      };
    }

    it("accepts a valid TEXT evidence input", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput())).toBe(true);
    });

    it("rejects TEXT with empty originalText", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput({ originalText: "" }))).toBe(false);
    });

    it("rejects TEXT with originalText missing entirely", () => {
      const { originalText: _drop, ...rest } = baseTextInput();
      expect(isValidCreateProfessionalLearningEvidenceInput(rest)).toBe(false);
    });

    it("rejects originalText longer than 4000 chars", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput({ originalText: "a".repeat(4001) }))).toBe(false);
    });

    it("rejects an empty vertical (no hardcoded haircut-only domain -- but it must be present)", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput({ vertical: "" }))).toBe(false);
    });

    it("accepts a non-hair vertical -- the validator is domain-agnostic", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput({ vertical: "nails" }))).toBe(true);
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput({ vertical: "makeup" }))).toBe(true);
    });

    it("rejects a missing rightsClassification", () => {
      const { rightsClassification: _drop, ...rest } = baseTextInput();
      expect(isValidCreateProfessionalLearningEvidenceInput(rest)).toBe(false);
    });

    it("rejects a missing provenance", () => {
      const { provenance: _drop, ...rest } = baseTextInput();
      expect(isValidCreateProfessionalLearningEvidenceInput(rest)).toBe(false);
    });

    it("rejects provenance that is an array, not an object", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput({ provenance: [] as unknown as Record<string, unknown> }))).toBe(false);
    });

    it("accepts an IMAGE evidence input with imageAssetId and no originalText", () => {
      const input = baseTextInput({ evidenceType: "IMAGE", originalText: undefined, imageAssetId: "img-1" });
      expect(isValidCreateProfessionalLearningEvidenceInput(input)).toBe(true);
    });

    it("rejects an IMAGE evidence input with no imageAssetId", () => {
      const input = baseTextInput({ evidenceType: "IMAGE", originalText: undefined });
      expect(isValidCreateProfessionalLearningEvidenceInput(input)).toBe(false);
    });

    it("rejects a title longer than 200 chars", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput({ title: "a".repeat(201) }))).toBe(false);
    });

    it("accepts optional sourceMetadata as a plain object", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput({ sourceMetadata: { manufacturer: "Wella" } }))).toBe(true);
    });

    it("rejects sourceMetadata that is an array", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput(baseTextInput({ sourceMetadata: [] as unknown as Record<string, unknown> }))).toBe(false);
    });

    it("rejects a non-object input", () => {
      expect(isValidCreateProfessionalLearningEvidenceInput("not an object")).toBe(false);
      expect(isValidCreateProfessionalLearningEvidenceInput(null)).toBe(false);
    });
  });
});
