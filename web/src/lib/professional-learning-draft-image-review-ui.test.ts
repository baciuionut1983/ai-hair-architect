import { describe, expect, it } from "vitest";

import { discernmentLabel, formatExtractionForDisplay, provenanceLabel } from "@/components/consultation/teach-ai-learning-draft-review-logic";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2, Part 32 --
// the existing Teach-the-AI review UI logic is evidence-type-agnostic by
// construction (it only ever consumes {field, value, source} entries),
// so an image-derived draft renders through the EXACT SAME, unmodified
// component -- no redesign, per this stage's own explicit instruction.
describe("Teach-the-AI review UI renders an image-derived draft correctly (Stage 8.5L4.R2 Part 32)", () => {
  it("distinguishes OBSERVED, INFERRED, and UNKNOWN for a realistic image-derived extraction", () => {
    const imageDerivedExtraction = {
      sectioning: { value: "horizontal partings visible", source: "OBSERVED" },
      guideType: { value: "possibly a stationary guide", source: "INFERRED" },
      elevation: { value: null, source: "UNKNOWN" },
      fingerAngle: { value: null, source: "UNKNOWN" },
    };

    const display = formatExtractionForDisplay(imageDerivedExtraction);
    const bySource = new Set(display.map((e) => e.source));

    expect(bySource.has(provenanceLabel("OBSERVED"))).toBe(true);
    expect(bySource.has(provenanceLabel("INFERRED"))).toBe(true);
    expect(bySource.has(provenanceLabel("UNKNOWN"))).toBe(true);
    expect(discernmentLabel("PROFESSIONAL_TECHNIQUE")).toBeTruthy();
  });
});
