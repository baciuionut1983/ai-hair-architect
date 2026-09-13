import { describe, expect, it } from "vitest";

import { applyElevationSemanticGuard, isElevationClaimSemanticallyGrounded } from "./professional-learning-elevation-semantic-guard";
import type { ProfessionalLearningExtraction } from "./professional-learning-draft-validators";

describe("professional-learning-elevation-semantic-guard (Stage 8.5L4.R2.1)", () => {
  describe("isElevationClaimSemanticallyGrounded", () => {
    it("Part 16/replay: the EXACT real L4.R2 elevation claim is NOT semantically grounded (generic diagram/projection geometry, no hair/strand relationship)", () => {
      const value = "Perpendicular radial projection for round layers; orthogonal/planar projection for square and triangular layers";
      const note = "Represented visually by directional projection arrows extending from head contours.";
      expect(isElevationClaimSemanticallyGrounded(value, note)).toBe(false);
    });

    it("Part 19 positive control: an explicit strand-to-head lift relationship IS semantically grounded", () => {
      expect(isElevationClaimSemanticallyGrounded("90 degrees", "The diagram explicitly labels the strand lifted 90 degrees from the head.")).toBe(true);
      expect(isElevationClaimSemanticallyGrounded("A hair section is held at an angle away from the scalp.")).toBe(true);
    });

    it("Part 20 negative control: generic angled/radial lines with no strand/head relationship are NOT grounded", () => {
      expect(isElevationClaimSemanticallyGrounded("Angled lines suggest an elevated projection pattern.")).toBe(false);
      expect(isElevationClaimSemanticallyGrounded("A radial guide line diagram.")).toBe(false);
    });

    it("Part 14: an unbound numeric/angle label alone does not establish elevation", () => {
      expect(isElevationClaimSemanticallyGrounded("90°", "A 90 degree angle mark is visible somewhere in the diagram.")).toBe(false);
    });

    it("requires BOTH a hair-relationship term and a lift-relationship term -- either alone is insufficient", () => {
      expect(isElevationClaimSemanticallyGrounded("The hair is visible in the image.")).toBe(false); // hair, no lift term
      expect(isElevationClaimSemanticallyGrounded("The line is angled upward.")).toBe(false); // lift term, no hair term
    });
  });

  describe("applyElevationSemanticGuard", () => {
    function extraction(overrides: ProfessionalLearningExtraction = {}): ProfessionalLearningExtraction {
      return { sectioning: { value: "horizontal partings", source: "OBSERVED" }, ...overrides };
    }

    it("Part 16 replay: downgrades the exact real R2 elevation claim to UNKNOWN for image evidence, leaving other fields untouched", () => {
      const input = extraction({
        elevation: {
          value: "Perpendicular radial projection for round layers; orthogonal/planar projection for square and triangular layers",
          source: "OBSERVED",
          confidence: 0.9,
          note: "Represented visually by directional projection arrows extending from head contours.",
        },
      });

      const result = applyElevationSemanticGuard(input, true);

      expect(result.elevation).toEqual({ value: null, source: "UNKNOWN" });
      expect(result.sectioning).toEqual({ value: "horizontal partings", source: "OBSERVED" });
    });

    it("never runs for TEXT/VOICE_TRANSCRIPT evidence -- Part 32: One-Length's real, explicit 'no elevation' must survive untouched", () => {
      const oneLengthRealElevation = extraction({ elevation: { value: "0 degrees (natural fall)", source: "OBSERVED" } });
      const result = applyElevationSemanticGuard(oneLengthRealElevation, false);
      expect(result).toBe(oneLengthRealElevation); // same reference -- not even a new object was constructed
      expect(result.elevation).toEqual({ value: "0 degrees (natural fall)", source: "OBSERVED" });
    });

    it("Part 9: PROFESSIONAL_INPUT elevation claims are exempt -- a real professional statement is never second-guessed by this heuristic", () => {
      const input = extraction({ elevation: { value: "90 degrees", source: "PROFESSIONAL_INPUT", confidence: 1 } });
      const result = applyElevationSemanticGuard(input, true);
      expect(result.elevation).toEqual({ value: "90 degrees", source: "PROFESSIONAL_INPUT", confidence: 1 });
    });

    it("UNKNOWN elevation entries pass through unchanged", () => {
      const input = extraction({ elevation: { value: null, source: "UNKNOWN" } });
      const result = applyElevationSemanticGuard(input, true);
      expect(result.elevation).toEqual({ value: null, source: "UNKNOWN" });
    });

    it("an extraction with no elevation field at all is unaffected", () => {
      const input = extraction();
      const result = applyElevationSemanticGuard(input, true);
      expect(result).toEqual(input);
      expect(result.elevation).toBeUndefined();
    });

    it("Part 19 positive control: a genuinely well-grounded visual elevation claim survives", () => {
      const input = extraction({
        elevation: { value: "90 degrees", source: "OBSERVED", note: "The diagram explicitly labels the hair strand lifted 90 degrees away from the head." },
      });
      const result = applyElevationSemanticGuard(input, true);
      expect(result.elevation).toEqual({ value: "90 degrees", source: "OBSERVED", note: "The diagram explicitly labels the hair strand lifted 90 degrees away from the head." });
    });

    it("Part 21/22/23/24: distribution, overdirection, sectioning, and guide fields are never touched by the elevation guard", () => {
      const input: ProfessionalLearningExtraction = {
        distribution: { value: "natural fall", source: "OBSERVED" },
        overdirection: { value: "directed forward", source: "OBSERVED" },
        sectioning: { value: "horizontal partings", source: "OBSERVED" },
        guideType: { value: "stationary guide", source: "OBSERVED" },
        elevation: { value: "generic angled lines", source: "OBSERVED", note: "A diagram shows angled projection lines." },
      };
      const result = applyElevationSemanticGuard(input, true);
      expect(result.distribution).toEqual(input.distribution);
      expect(result.overdirection).toEqual(input.overdirection);
      expect(result.sectioning).toEqual(input.sectioning);
      expect(result.guideType).toEqual(input.guideType);
      expect(result.elevation).toEqual({ value: null, source: "UNKNOWN" });
    });

    it("also guards an INFERRED elevation claim, not only OBSERVED", () => {
      const input = extraction({ elevation: { value: "angled projection", source: "INFERRED", note: "Lines appear angled in the diagram." } });
      const result = applyElevationSemanticGuard(input, true);
      expect(result.elevation).toEqual({ value: null, source: "UNKNOWN" });
    });
  });
});
