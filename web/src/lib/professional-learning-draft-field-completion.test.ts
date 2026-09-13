import { describe, expect, it } from "vitest";

import { completeApplicableFieldsWithUnknown, isProceduralDiscernmentCategory, PROCEDURAL_DISCERNMENT_CATEGORIES } from "./professional-learning-draft-field-completion";
import { PROFESSIONAL_LEARNING_EXTRACTION_FIELD_NAMES, isValidExtraction } from "./professional-learning-draft-validators";

describe("completeApplicableFieldsWithUnknown (Stage 8.5L4.R1.1)", () => {
  it("treats exactly the procedural discernment categories as applicable", () => {
    expect(PROCEDURAL_DISCERNMENT_CATEGORIES).toEqual(["PROFESSIONAL_TECHNIQUE", "PROFESSIONAL_VARIATION", "PROFESSIONAL_RULE", "PROFESSIONAL_CORRECTION", "PROFESSIONAL_EXAMPLE"]);
    expect(isProceduralDiscernmentCategory("PROFESSIONAL_TECHNIQUE")).toBe(true);
    expect(isProceduralDiscernmentCategory("RESULT_REFERENCE")).toBe(false);
    expect(isProceduralDiscernmentCategory("INSUFFICIENT_EVIDENCE")).toBe(false);
    expect(isProceduralDiscernmentCategory("IRRELEVANT")).toBe(false);
  });

  it("completes every absent field to explicit UNKNOWN for a procedural category, without touching present fields", () => {
    const extraction = { elevation: { value: "0 degrees", source: "OBSERVED" as const } };
    const completed = completeApplicableFieldsWithUnknown(extraction, "PROFESSIONAL_TECHNIQUE");

    expect(completed.elevation).toEqual({ value: "0 degrees", source: "OBSERVED" });
    for (const field of PROFESSIONAL_LEARNING_EXTRACTION_FIELD_NAMES) {
      expect(completed[field]).toBeDefined();
    }
    expect(completed.fingerAngle).toEqual({ value: null, source: "UNKNOWN" });
    expect(completed.cuttingAngle).toEqual({ value: null, source: "UNKNOWN" });
    expect(completed.toolOrientation).toEqual({ value: null, source: "UNKNOWN" });
    expect(isValidExtraction(completed)).toBe(true);
  });

  it("never manufactures UNKNOWN for a non-procedural (genuinely inapplicable) discernment category -- Part 3's UNKNOWN != NOT_APPLICABLE boundary", () => {
    const extraction = { targetEffect: { value: "Butterfly haircut", source: "OBSERVED" as const } };
    for (const category of ["RESULT_REFERENCE", "INSUFFICIENT_EVIDENCE", "IRRELEVANT", "TOOL_INFORMATION", "PRODUCT_INFORMATION", "BRAND_INFORMATION", "TREND_INFORMATION"] as const) {
      const completed = completeApplicableFieldsWithUnknown(extraction, category);
      expect(completed).toEqual(extraction);
      expect(Object.keys(completed)).toHaveLength(1);
    }
  });

  it("leaves an already-empty extraction empty for a non-procedural category (no fake completeness)", () => {
    expect(completeApplicableFieldsWithUnknown({}, "INSUFFICIENT_EVIDENCE")).toEqual({});
  });

  it("is idempotent -- completing an already-completed extraction changes nothing", () => {
    const once = completeApplicableFieldsWithUnknown({}, "PROFESSIONAL_TECHNIQUE");
    const twice = completeApplicableFieldsWithUnknown(once, "PROFESSIONAL_TECHNIQUE");
    expect(twice).toEqual(once);
  });

  it("real-world shape: the actual L4.R1 One-Length extraction (15 real fields) gets exactly the remaining fields completed to UNKNOWN", () => {
    // The real, actual extraction object Gemini produced in the L4.R1
    // acceptance run (replayed here, per this stage's Part 8 -- no
    // Gemini call is made by this test).
    const oneLengthRealExtraction = {
      elevation: { value: "No elevation", source: "PROFESSIONAL_INPUT" as const, confidence: 1 },
      guideType: { value: "Visible continuation guide", source: "OBSERVED" as const, confidence: 0.95 },
      discipline: { value: "haircutting", source: "INFERRED" as const, confidence: 1 },
      sectioning: { value: "Posterior hair divided into two equal sections", source: "OBSERVED" as const, confidence: 1 },
      guideSource: { value: "Previously cut strand / established posterior guide behind ear", source: "OBSERVED" as const, confidence: 1 },
      progression: { value: "Progress strand by strand upward through posterior area to crown", source: "OBSERVED" as const, confidence: 1 },
      distribution: { value: "Natural fall", source: "OBSERVED" as const, confidence: 1 },
      prerequisites: { value: "Hair/strand must be evenly combed and controlled before cutting", source: "OBSERVED" as const, confidence: 1 },
      subsectioning: { value: "Horizontal partings", source: "OBSERVED" as const, confidence: 1 },
      applicableZones: { value: "Posterior area, crown, lateral areas", source: "OBSERVED" as const, confidence: 1 },
      incompatibilities: { value: "Slice-and-Slide cutting technique and elevation", source: "PROFESSIONAL_INPUT" as const, confidence: 1 },
      techniqueCandidate: { value: "One-Length Perimeter", source: "OBSERVED" as const, confidence: 1 },
      subsectionThickness: { value: "Approximately 1 cm", source: "OBSERVED" as const, confidence: 1 },
      verificationCriteria: { value: "Check symmetry, perimeter continuity, dry natural-fall recheck", source: "OBSERVED" as const, confidence: 1 },
      professionalRationale: { value: "The established contour/final length remains the authority for the haircut", source: "OBSERVED" as const, confidence: 1 },
    };

    const completed = completeApplicableFieldsWithUnknown(oneLengthRealExtraction, "PROFESSIONAL_TECHNIQUE");

    // Every real known value preserved EXACTLY (Part 9).
    for (const [field, entry] of Object.entries(oneLengthRealExtraction)) {
      expect(completed[field as keyof typeof completed]).toEqual(entry);
    }

    // The fields the model omitted (fingerAngle, cuttingAngle, toolOrientation,
    // positioning/head angle, observationViewpoint, tool, iteration,
    // completionCondition, crossCheck, startingState, targetEffect,
    // professionalObjective, domain, cuttingLine, safety, fingerPosition,
    // stylingRelationship) are now explicit UNKNOWN.
    const omittedFields = PROFESSIONAL_LEARNING_EXTRACTION_FIELD_NAMES.filter((f) => !(f in oneLengthRealExtraction));
    expect(omittedFields.length).toBeGreaterThan(0);
    for (const field of omittedFields) {
      expect(completed[field]).toEqual({ value: null, source: "UNKNOWN" });
    }

    // Guide distinction still intact -- structural authority
    // (professionalRationale) and continuation guide (guideType/guideSource)
    // remain two distinct, non-UNKNOWN, non-collapsed fields.
    expect(completed.professionalRationale?.source).not.toBe("UNKNOWN");
    expect(completed.guideType?.source).not.toBe("UNKNOWN");
    expect(completed.guideSource?.source).not.toBe("UNKNOWN");

    // No-elevation and the negative Slice-and-Slide rule remain known,
    // never turned into UNKNOWN and never turned into an elevated value.
    expect(completed.elevation).toEqual({ value: "No elevation", source: "PROFESSIONAL_INPUT", confidence: 1 });
    expect(completed.incompatibilities?.source).toBe("PROFESSIONAL_INPUT");

    expect(isValidExtraction(completed)).toBe(true);
  });
});
