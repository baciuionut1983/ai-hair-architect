import { describe, expect, it } from "vitest";

import {
  APPROVED_NOTE_TEXT,
  comparisonLabel,
  discernmentLabel,
  draftStatusLabel,
  formatExtractionForDisplay,
  LEARNING_DRAFT_HEADING_TEXT,
  provenanceLabel,
} from "./teach-ai-learning-draft-review-logic";

describe("teach-ai-learning-draft-review-logic", () => {
  it("never claims the AI 'learned successfully' in its heading text", () => {
    expect(LEARNING_DRAFT_HEADING_TEXT.toLowerCase()).not.toContain("a învățat");
    expect(LEARNING_DRAFT_HEADING_TEXT).toContain("necesită verificare profesională");
  });

  it("the APPROVED note never claims registry activation", () => {
    expect(APPROVED_NOTE_TEXT).toContain("nu activează automat");
  });

  it("labels every known discernment category, comparison outcome, provenance source, and draft status in Romanian", () => {
    expect(discernmentLabel("PROFESSIONAL_TECHNIQUE")).toBe("Tehnică profesională");
    expect(discernmentLabel("RESULT_REFERENCE")).toContain("nu o tehnică");
    expect(comparisonLabel("POSSIBLE_CONFLICT")).toContain("conflict");
    expect(comparisonLabel("EVIDENCE_FOR_EXISTING")).toContain("Susține");
    expect(provenanceLabel("OBSERVED")).toBe("Observat");
    expect(provenanceLabel("UNKNOWN")).toBe("Nedeterminat din material");
    expect(draftStatusLabel("APPROVED")).toContain("profesionist");
  });

  it("Stage 8.5L4.R1.1: UNKNOWN's label never implies AI failure or that the information does not exist", () => {
    const label = provenanceLabel("UNKNOWN").toLowerCase();
    expect(label).not.toContain("eșec");
    expect(label).not.toContain("eroare");
    expect(label).toContain("material");
  });

  it("falls back to the raw value for an unrecognized code rather than throwing", () => {
    expect(discernmentLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("formats an extraction object into a flat display list, skipping undefined entries", () => {
    const display = formatExtractionForDisplay({
      elevation: { value: "0 degrees", source: "OBSERVED" },
      overdirection: { value: null, source: "UNKNOWN" },
      fingerAngle: undefined,
    });

    expect(display).toEqual([
      { field: "elevation", value: "0 degrees", source: "Observat" },
      { field: "overdirection", value: "—", source: "Nedeterminat din material" },
    ]);
  });

  it("Stage 8.5L4.R2.2, Part 17: an UNKNOWN field with a preserved rawObservation shows the observation instead of a bare dash", () => {
    const display = formatExtractionForDisplay({
      elevation: {
        value: null,
        source: "UNKNOWN",
        rawObservation: "Represented visually by directional projection arrows extending from head contours.",
      },
    });

    expect(display).toEqual([
      {
        field: "elevation",
        value: "Observat, sens neclar: Represented visually by directional projection arrows extending from head contours.",
        source: "Nedeterminat din material",
      },
    ]);
  });

  it("an UNKNOWN field with no rawObservation still falls back to a bare dash", () => {
    const display = formatExtractionForDisplay({ overdirection: { value: null, source: "UNKNOWN" } });
    expect(display).toEqual([{ field: "overdirection", value: "—", source: "Nedeterminat din material" }]);
  });
});
