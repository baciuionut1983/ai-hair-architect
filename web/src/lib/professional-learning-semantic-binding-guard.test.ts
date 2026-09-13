import { describe, expect, it } from "vitest";

import { applySemanticBindingGuard, isClaimSemanticallyBound, isFieldSubjectToSemanticBindingGuard } from "./professional-learning-semantic-binding-guard";
import type { ProfessionalLearningExtraction } from "./professional-learning-draft-validators";

describe("professional-learning-semantic-binding-guard (Stage 8.5L4.R2.2)", () => {
  describe("field coverage -- not a rule farm (Part 2)", () => {
    it("only guards the small, declared set of GEOMETRY/DIRECTION/STRUCTURE fields, never all 32", () => {
      expect(isFieldSubjectToSemanticBindingGuard("elevation")).toBe(true);
      expect(isFieldSubjectToSemanticBindingGuard("cuttingAngle")).toBe(true);
      expect(isFieldSubjectToSemanticBindingGuard("fingerAngle")).toBe(true);
      expect(isFieldSubjectToSemanticBindingGuard("toolOrientation")).toBe(true);
      expect(isFieldSubjectToSemanticBindingGuard("distribution")).toBe(true);
      expect(isFieldSubjectToSemanticBindingGuard("overdirection")).toBe(true);
      expect(isFieldSubjectToSemanticBindingGuard("sectioning")).toBe(true);
      expect(isFieldSubjectToSemanticBindingGuard("guideType")).toBe(true);
      expect(isFieldSubjectToSemanticBindingGuard("guideSource")).toBe(true);

      // Narrative/descriptive fields are deliberately NOT subject to this
      // guard -- low field-confusion risk, unguarded by design.
      expect(isFieldSubjectToSemanticBindingGuard("techniqueCandidate")).toBe(false);
      expect(isFieldSubjectToSemanticBindingGuard("professionalRationale")).toBe(false);
      expect(isFieldSubjectToSemanticBindingGuard("targetEffect")).toBe(false);
      expect(isFieldSubjectToSemanticBindingGuard("domain")).toBe(false);
      expect(isFieldSubjectToSemanticBindingGuard("cuttingLine")).toBe(false);
    });
  });

  describe("Part 17: exact real R2 Layers replay", () => {
    it("the exact real elevation claim from the L4.R2 acceptance run is rejected (source support real, semantic support absent)", () => {
      const value = "Perpendicular radial projection for round layers; orthogonal/planar projection for square and triangular layers";
      const note = "Represented visually by directional projection arrows extending from head contours.";
      expect(isClaimSemanticallyBound("elevation", value, note)).toBe(false);
    });
  });

  describe("Part 18/19: cross-field misbinding", () => {
    it("Part 18: scalp divisions correctly observed, but mislabeled overdirection -- overdirection claim rejected", () => {
      expect(isClaimSemanticallyBound("overdirection", "Visible scalp divisions with parting lines are shown.")).toBe(false);
    });

    it("Part 19: a strand visibly held away from the head, but mislabeled sectioning -- sectioning claim rejected", () => {
      expect(isClaimSemanticallyBound("sectioning", "A strand is visibly held away from the head at an angle.")).toBe(false);
    });
  });

  describe("Parts 20-24: field distinctions", () => {
    it("Part 20: cuttingAngle requires cutting-action language, not a bare diagonal line", () => {
      expect(isClaimSemanticallyBound("cuttingAngle", "A diagonal line is visible in the diagram.")).toBe(false);
      expect(isClaimSemanticallyBound("cuttingAngle", "The scissors are shown cutting at a specific blade angle relative to the hair.")).toBe(true);
    });

    it("Part 21: fingerAngle requires finger-specific language; the same generic geometry never also satisfies cuttingAngle or elevation", () => {
      const fingerText = "Fingers are visibly positioned at a finger angle to control the strand.";
      expect(isClaimSemanticallyBound("fingerAngle", fingerText)).toBe(true);
      expect(isClaimSemanticallyBound("cuttingAngle", fingerText)).toBe(false);
      expect(isClaimSemanticallyBound("elevation", fingerText)).toBe(false);
    });

    it("Part 22: toolOrientation requires tool-orientation language; visible tool alone never establishes cuttingLine (unguarded field, but must not leak into a guarded one)", () => {
      expect(isClaimSemanticallyBound("toolOrientation", "The scissors are visibly held horizontally near the section.")).toBe(true);
      expect(isClaimSemanticallyBound("toolOrientation", "Scissors are visible in the frame.")).toBe(false);
    });

    it("Part 23: distribution and overdirection remain distinct -- neither satisfies the other's rule", () => {
      const distributionText = "Hair is combed toward the parting, relative to the design line.";
      const overdirectionText = "The section is directed away from its natural base position.";
      expect(isClaimSemanticallyBound("distribution", distributionText)).toBe(true);
      expect(isClaimSemanticallyBound("overdirection", distributionText)).toBe(false);
      expect(isClaimSemanticallyBound("overdirection", overdirectionText)).toBe(true);
      expect(isClaimSemanticallyBound("distribution", overdirectionText)).toBe(false);
    });

    it("Part 24: sectioning and guide remain distinct -- a dividing line alone never establishes a guide relationship", () => {
      expect(isClaimSemanticallyBound("sectioning", "A clear section division is visible across the head.")).toBe(true);
      expect(isClaimSemanticallyBound("guideType", "A clear section division is visible across the head.")).toBe(false);
      expect(isClaimSemanticallyBound("guideType", "A visible guide strand establishes the continuation authority for the next section.")).toBe(true);
    });
  });

  describe("Part 28: explicit annotation binding", () => {
    it("a 90° label explicitly bound to the strand/head relationship is accepted", () => {
      expect(isClaimSemanticallyBound("elevation", "90 degrees", "The diagram explicitly labels the strand at 90 degrees from the head.")).toBe(true);
    });

    it("an unbound 90° label with no established referent is rejected", () => {
      expect(isClaimSemanticallyBound("elevation", "90°", "A 90 degree angle mark is visible somewhere in the diagram.")).toBe(false);
    });
  });

  describe("applySemanticBindingGuard -- full extraction object behavior", () => {
    it("Part 17 replay through the full guard: downgrades elevation, preserves the raw observation, leaves sibling fields untouched", () => {
      const input: ProfessionalLearningExtraction = {
        cuttingLine: { value: "Curved line parallel to head shape for round layers", source: "OBSERVED" },
        elevation: {
          value: "Perpendicular radial projection for round layers; orthogonal/planar projection for square and triangular layers",
          source: "OBSERVED",
          confidence: 0.9,
          note: "Represented visually by directional projection arrows extending from head contours.",
        },
      };

      const result = applySemanticBindingGuard(input, true);

      expect(result.elevation?.source).toBe("UNKNOWN");
      expect(result.elevation?.value).toBeNull();
      expect(result.elevation?.rawObservation).toContain("directional projection arrows");
      expect(result.cuttingLine).toEqual(input.cuttingLine);
    });

    it("Part 32/One-Length regression: never runs for TEXT/VOICE_TRANSCRIPT evidence -- returns the exact same object reference", () => {
      const input: ProfessionalLearningExtraction = { elevation: { value: "0 degrees (natural fall)", source: "OBSERVED" } };
      const result = applySemanticBindingGuard(input, false);
      expect(result).toBe(input);
    });

    it("Part 29: PROFESSIONAL_INPUT claims are exempt regardless of lexical content", () => {
      const input: ProfessionalLearningExtraction = { elevation: { value: "90 degrees", source: "PROFESSIONAL_INPUT", confidence: 1 } };
      const result = applySemanticBindingGuard(input, true);
      expect(result.elevation).toEqual(input.elevation);
    });

    it("Part 30: an explicit professional 'no elevation' statement (PROFESSIONAL_INPUT) is never overridden", () => {
      const input: ProfessionalLearningExtraction = { elevation: { value: "No elevation, natural fall.", source: "PROFESSIONAL_INPUT", confidence: 1 } };
      const result = applySemanticBindingGuard(input, true);
      expect(result.elevation).toEqual(input.elevation);
    });

    it("UNKNOWN entries pass through unchanged", () => {
      const input: ProfessionalLearningExtraction = { elevation: { value: null, source: "UNKNOWN" } };
      const result = applySemanticBindingGuard(input, true);
      expect(result.elevation).toEqual({ value: null, source: "UNKNOWN" });
    });

    it("Part 19 positive control: a genuinely grounded visual elevation claim survives as KNOWN", () => {
      const input: ProfessionalLearningExtraction = { elevation: { value: "90 degrees", source: "OBSERVED", note: "The diagram explicitly labels a hair strand lifted 90 degrees away from the head." } };
      const result = applySemanticBindingGuard(input, true);
      expect(result.elevation).toEqual(input.elevation);
    });

    it("multiple guarded fields in one extraction are evaluated independently", () => {
      const input: ProfessionalLearningExtraction = {
        distribution: { value: "Hair combed toward the parting, relative to the design line.", source: "OBSERVED" },
        overdirection: { value: "generic diagonal lines", source: "OBSERVED", note: "Some angled lines are visible." },
        sectioning: { value: "Clear section divisions across the head.", source: "OBSERVED" },
        guideType: { value: "generic line", source: "OBSERVED", note: "A line divides the head." },
      };

      const result = applySemanticBindingGuard(input, true);

      expect(result.distribution?.source).toBe("OBSERVED");
      expect(result.overdirection?.source).toBe("UNKNOWN");
      expect(result.sectioning?.source).toBe("OBSERVED");
      expect(result.guideType?.source).toBe("UNKNOWN");
    });

    it("also guards an INFERRED claim, not only OBSERVED", () => {
      const input: ProfessionalLearningExtraction = { cuttingAngle: { value: "steep angle", source: "INFERRED", note: "A steep line is visible." } };
      const result = applySemanticBindingGuard(input, true);
      expect(result.cuttingAngle?.source).toBe("UNKNOWN");
    });

    it("returns the exact same object reference when nothing needed to change (no unnecessary allocation/mutation signal)", () => {
      const input: ProfessionalLearningExtraction = { techniqueCandidate: { value: "Graduated Cutting", source: "OBSERVED" } };
      const result = applySemanticBindingGuard(input, true);
      expect(result).toBe(input);
    });
  });
});
