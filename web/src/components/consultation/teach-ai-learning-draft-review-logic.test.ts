import { describe, expect, it } from "vitest";

import {
  APPROVED_NOTE_TEXT,
  classifyDraftAnalysisResponse,
  comparisonLabel,
  discernmentLabel,
  draftActionButtonLabel,
  draftStatusLabel,
  extractionErrorLabel,
  formatExtractionForDisplay,
  formatTemporalEvidenceForDisplay,
  LEARNING_DRAFT_HEADING_TEXT,
  provenanceLabel,
  TEMPORAL_EVIDENCE_HEADING_TEXT,
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

  // T1.1 Issue #1, Fix 1 -- fail-honest extraction errors.
  describe("extractionErrorLabel", () => {
    it("labels every known error code distinctly, in Romanian, without ever including the code itself", () => {
      const codes = [
        "REAL_EXTRACTION_MISCONFIGURED",
        "NOT_CONFIGURED",
        "TIMEOUT",
        "RATE_LIMITED",
        "INVALID_RESPONSE",
        "PROVIDER_ERROR",
        "EVIDENCE_NOT_FOUND",
        "VIDEO_MEDIA_UNAVAILABLE",
        "IMAGE_MEDIA_UNAVAILABLE",
      ];
      const seen = new Set<string>();
      for (const code of codes) {
        const label = extractionErrorLabel(code);
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toContain(code);
        seen.add(label);
      }
      // Distinct enough that a professional can tell a timeout apart from
      // a misconfiguration -- not everything collapsed into one string.
      expect(seen.size).toBeGreaterThan(1);
    });

    it("never claims success/insufficient-evidence language for a genuine provider error", () => {
      for (const code of ["TIMEOUT", "RATE_LIMITED", "PROVIDER_ERROR", "INVALID_RESPONSE"]) {
        const label = extractionErrorLabel(code).toLowerCase();
        expect(label).not.toContain("informație insuficientă");
        expect(label).not.toContain("draft de învățare");
      }
    });

    it("falls back to a generic, safe message for an unrecognized or missing code, never throwing", () => {
      expect(extractionErrorLabel("SOME_FUTURE_CODE_NOT_YET_KNOWN")).toBe(extractionErrorLabel(undefined));
      expect(extractionErrorLabel(null)).toBe(extractionErrorLabel(undefined));
      expect(() => extractionErrorLabel(undefined)).not.toThrow();
    });

    it("never exposes anything secret-shaped even for an unrecognized code", () => {
      const label = extractionErrorLabel("AIzaFakeSecretShapedTestValueNeverReal12345");
      expect(label).not.toContain("AIzaFakeSecretShapedTestValueNeverReal12345");
    });
  });

  // T1.1 Issue #1, Fix 1 -- a failed attempt must never look like a
  // successful reanalysis.
  describe("draftActionButtonLabel", () => {
    it("labels the very first attempt as the initial action, never 'reanalyze'", () => {
      expect(draftActionButtonLabel(false, false)).toBe("Analizează material (draft)");
    });

    it("labels a retry after a genuine prior success as 'Reanalizează'", () => {
      expect(draftActionButtonLabel(true, false)).toBe("Reanalizează");
    });

    it("labels a retry after a failure as a distinct 'try again,' never 'Reanalizează'", () => {
      const label = draftActionButtonLabel(true, true);
      expect(label).not.toBe("Reanalizează");
      expect(label).toBe("Încearcă din nou");
    });

    it("a failure before any prior success still never claims a reanalysis happened", () => {
      expect(draftActionButtonLabel(false, true)).not.toBe("Reanalizează");
    });
  });

  // T1.1 Issue #1, Fix 1 -- the exact success/failure classification of a
  // POST /drafts response. This is the fix's core regression coverage.
  describe("classifyDraftAnalysisResponse", () => {
    it("classifies a genuine successful draft-created response correctly (regression: the existing success path must keep working)", () => {
      const draft = { id: "draft-1", status: "DRAFT" };
      expect(classifyDraftAnalysisResponse(true, { status: "created", draft })).toEqual({ kind: "draft", draft });
    });

    it("classifies a genuine already-processed response the same as a fresh success", () => {
      const draft = { id: "draft-1", status: "READY_FOR_REVIEW" };
      expect(classifyDraftAnalysisResponse(true, { status: "already_processed", draft })).toEqual({ kind: "draft", draft });
    });

    it("classifies a genuine skipped response correctly", () => {
      expect(classifyDraftAnalysisResponse(true, { status: "skipped", reason: "EMPTY_TRANSCRIPT" })).toEqual({ kind: "skipped", reason: "EMPTY_TRANSCRIPT" });
    });

    it("classifies a non-2xx response as an error, never as skipped or draft, regardless of its body", () => {
      expect(classifyDraftAnalysisResponse(false, { error: "PROVIDER_ERROR", message: "Gemini service unavailable." })).toEqual({
        kind: "error",
        message: extractionErrorLabel("PROVIDER_ERROR"),
      });
    });

    it("a non-2xx response is ALWAYS an error even if its body happens to also carry a draft-shaped or skipped-shaped field -- ok=false wins", () => {
      const outcome = classifyDraftAnalysisResponse(false, { status: "skipped", reason: "x", draft: { id: "should-not-be-used" }, error: "TIMEOUT" });
      expect(outcome.kind).toBe("error");
    });

    it("classifies an unparseable body (null) as an error, both on success and failure status codes", () => {
      expect(classifyDraftAnalysisResponse(false, null).kind).toBe("error");
      expect(classifyDraftAnalysisResponse(true, null).kind).toBe("error");
    });

    it("classifies a 2xx response matching neither known success shape as an error -- never silently 'nothing to show'", () => {
      const outcome = classifyDraftAnalysisResponse(true, {});
      expect(outcome).toEqual({ kind: "error", message: extractionErrorLabel(undefined) });
    });

    it("never produces a fake 'insufficient evidence' skip out of a genuine error response", () => {
      const outcome = classifyDraftAnalysisResponse(false, { error: "NOT_CONFIGURED", message: "Gemini authentication failed." });
      expect(outcome.kind).not.toBe("skipped");
      if (outcome.kind === "error") {
        expect(outcome.message.toLowerCase()).not.toContain("informație insuficientă");
      }
    });
  });

  // T1.2 -- TEMPORAL OBSERVATION PRESERVATION.
  describe("formatTemporalEvidenceForDisplay", () => {
    it("the heading never claims professional truth/approved knowledge", () => {
      expect(TEMPORAL_EVIDENCE_HEADING_TEXT.toLowerCase()).not.toContain("aprobat");
      expect(TEMPORAL_EVIDENCE_HEADING_TEXT.toLowerCase()).not.toContain("cunoștințe");
    });

    it("renders normally (empty list) for a draft with no temporal evidence", () => {
      expect(formatTemporalEvidenceForDisplay(null)).toEqual([]);
      expect(formatTemporalEvidenceForDisplay(undefined)).toEqual([]);
      expect(formatTemporalEvidenceForDisplay({ observations: [], actions: [], editGaps: [] })).toEqual([]);
    });

    it("renders timestamps/ranges safely and provenance labels correctly", () => {
      const display = formatTemporalEvidenceForDisplay({
        observations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "comb passes through a section", source: "OBSERVED" }],
        actions: [{ timeStartSeconds: 5, timeEndSeconds: 9, kind: "CUTTING_ACTION", source: "INFERRED" }],
        editGaps: [{ beforeTimeSeconds: 9, afterTimeSeconds: 40, source: "OBSERVED" }],
      });
      expect(display).toEqual([
        { rangeLabel: "0s–5s", text: "comb passes through a section", source: "Observat" },
        { rangeLabel: "5s–9s", text: "CUTTING_ACTION", source: "Dedus" },
        { rangeLabel: "9s–40s", text: "Posibilă tăietură/editare video", source: "Observat" },
      ]);
    });

    it("multiple observations render in deterministic temporal order across observations/actions/editGaps combined", () => {
      const display = formatTemporalEvidenceForDisplay({
        observations: [{ timeStartSeconds: 20, timeEndSeconds: 22, observation: "later observation", source: "OBSERVED" }],
        actions: [{ timeStartSeconds: 0, timeEndSeconds: 2, kind: "EARLY_ACTION", source: "INFERRED" }],
        editGaps: [{ beforeTimeSeconds: 10, afterTimeSeconds: 12, source: "OBSERVED" }],
      });
      expect(display.map((e) => e.text)).toEqual(["EARLY_ACTION", "Posibilă tăietură/editare video", "later observation"]);
    });

    it("never labels temporal evidence as PROFESSIONAL_INPUT or as approved knowledge", () => {
      const display = formatTemporalEvidenceForDisplay({
        observations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "x", source: "OBSERVED" }],
        actions: [{ timeStartSeconds: 0, timeEndSeconds: 5, kind: "y", source: "INFERRED" }],
      });
      for (const entry of display) {
        expect(entry.source).not.toBe("Introdus de profesionist");
      }
    });
  });
});
