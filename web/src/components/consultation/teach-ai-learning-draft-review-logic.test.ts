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
    expect(provenanceLabel("UNKNOWN")).toBe("Necunoscut");
    expect(draftStatusLabel("APPROVED")).toContain("profesionist");
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
      { field: "overdirection", value: "—", source: "Necunoscut" },
    ]);
  });
});
