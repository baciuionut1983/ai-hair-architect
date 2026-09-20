import { describe, expect, it } from "vitest";
import { ELEVATION_OPTIONS, SECTIONING_OPTIONS, GUIDELINE_OPTIONS } from "@/lib/proposal-validators";
import { hydrateStructuredProfessionalFields as hydrate, isSafeProfessionalText, validateProfessionalFieldValue as validate, STRUCTURED_FIELD_SPECIFICATIONS as specs, type ProfessionalClaimClassification } from "@/lib/structured-professional-field-claims";

const snapshot = <T>(extraction: T) => ({ id: "draft-synthetic", sourceEvidenceId: "evidence-synthetic", extractorVersion: "synthetic-v1", extraction });
const observed = (value: unknown) => ({ value, source: "OBSERVED" as const });
describe("structured professional field claims", () => {
  it("hydrates deterministically with scoped namespaced identity and independent original", () => {
    const input = snapshot({ elevation: observed("45_deg_graduation") });
    const first = hydrate(input);
    expect(first).toEqual(hydrate(input));
    if (!first.ok) throw new Error("hydration failed");
    expect(first.claims[0]).toMatchObject({ id: "field:elevation", field: "elevation", classification: "DECISION_RELEVANT_STRUCTURED_FIELD", normalized: { state: "KNOWN", value: "45_deg_graduation" }, original: input.extraction.elevation, provenance: { id: input.id, sourceEvidenceId: input.sourceEvidenceId, extractorVersion: input.extractorVersion, sourceExtractionField: "elevation" } });
    expect(first.claims[0].original).not.toBe(input.extraction.elevation);
    expect(Object.isFrozen(first.claims[0].original)).toBe(true);
    expect(Object.isFrozen(input.extraction.elevation)).toBe(false);
    input.extraction.elevation.value = "90_deg_uniform_layer";
    expect(first.claims[0].original.value).toBe("45_deg_graduation");
  });
  it.each([
    ["elevation", ELEVATION_OPTIONS], ["sectioning", SECTIONING_OPTIONS], ["guideType", GUIDELINE_OPTIONS],
  ] as const)("reuses every canonical %s value for extraction and future correction", (field, values) => {
    expect(specs[field].allowedValues).toEqual(values);
    expect(specs[field]).not.toHaveProperty("potentiallySkillBindable");
    for (const value of values) {
      expect(validate(field, value)).toBe(true);
      expect(hydrate(snapshot({ [field]: observed(value) })).ok).toBe(true);
    }
  });
  it.each(["45°", "45° Interior", "45 degrees", "45_deg_graduation ", " 45_deg_graduation", "45_DEG_GRADUATION", "diagonal_back", "invalid", 45, null])("rejects ambiguous/foreign elevation %s without fuzzy normalization", value => {
    expect(validate("elevation", value)).toBe(false);
    expect(hydrate(snapshot({ elevation: observed(value) }))).toEqual({ ok: false, reason: "INVALID_VALUE" });
  });
  it.each(["cuttingLine", "cuttingAngle"])("preserves %s as unsupported geometry, never elevation", field => {
    const input = snapshot({ [field]: observed("45° Interior") });
    expect(hydrate(input)).toEqual({ ok: true, claims: [] });
    expect(hydrate(input, [field])).toEqual({ ok: false, reason: "UNSUPPORTED_FIELD" });
    expect(validate(field, "45_deg_graduation")).toBe(false);
    expect(input.extraction[field].value).toBe("45° Interior");
  });
  it("does not infer from skill name or frequency observations", () => {
    const classification: ProfessionalClaimClassification = "OBSERVATIONAL";
    expect(classification).toBe("OBSERVATIONAL");
    expect(hydrate(snapshot({ techniqueCandidate: observed("45° Interior") }))).toEqual({ ok: true, claims: [] });
    expect(hydrate(snapshot({ elevation: observed("45° appears 3 times") })).ok).toBe(false);
    expect(hydrate(snapshot({ claimId: "frequency:45", frequency: 3, classification })).ok).toBe(false);
    // Actual T1.5 frequency value shape, not a new decision vocabulary.
    expect(hydrate(snapshot({ elevation: observed({ kind: "COMBING", occurrenceCount: 2 }) })).ok).toBe(false);
    expect(hydrate(snapshot({ COMBING: { claimId: "COMBING", claimType: "PROCEDURAL_PATTERN", originalValue: { kind: "COMBING", occurrenceCount: 2 }, originalProvenance: "INFERRED" } })).ok).toBe(false);
  });
  it("represents extraction UNKNOWN without a review decision", () => {
    const result = hydrate(snapshot({ elevation: { value: null, source: "UNKNOWN" } }));
    expect(result).toMatchObject({ ok: true, claims: [{ normalized: { state: "UNKNOWN", value: null } }] });
    expect(JSON.stringify(result)).not.toMatch(/reviewDecision|CONFIRMED|CORRECTED|REJECTED/);
    expect(hydrate(snapshot({ elevation: { value: "45_deg_graduation", source: "UNKNOWN" } })).ok).toBe(false);
    expect(hydrate(snapshot({ elevation: { value: "45_deg_graduation", source: "PROFESSIONAL_INPUT" } })).ok).toBe(false);
  });
  it.each(["\u0000", "\t", "\n", "\u007f", "\u0085", "\u009f", "\u200b", "\u200d", "\u2060", "\ufeff", "\u202e", "\u2067", "\ud800", "\udfff", "\u034f", "\ufe0f"])("rejects unsafe code units %j in values and provenance", control => {
    expect(isSafeProfessionalText(`a${control}b`)).toBe(false);
    expect(validate("elevation", `45_deg_graduation${control}`)).toBe(false);
    expect(hydrate(snapshot({ elevation: { ...observed("45_deg_graduation"), note: `a${control}b` } })).ok).toBe(false);
  });
  it("bounds strings and accepts intact supplementary Unicode without sanitation", () => {
    expect(isSafeProfessionalText("x".repeat(2000))).toBe(true);
    expect(isSafeProfessionalText("x".repeat(2001))).toBe(false);
    expect(isSafeProfessionalText("observation 🎥")).toBe(true);
    expect(validate("elevation", "x".repeat(2001))).toBe(false);
  });
  it("keeps temporal/frame anchors only in original provenance, not applicability or binding", () => {
    const segments = [{ timeStartSeconds: 1, timeEndSeconds: 2, relevance: 0.8, confidence: 0.9, observations: "synthetic", frameReferences: ["frame-1"] }];
    const result = hydrate(snapshot({ elevation: { ...observed("45_deg_graduation"), segments } }));
    if (!result.ok) throw new Error("hydration failed");
    expect(result.claims[0].original.segments).toEqual(segments);
    expect(result.claims[0].original.segments).not.toBe(segments);
    expect(JSON.stringify(result)).not.toMatch(/applicability|skillId|binding|eligible|reviewDecision/);
  });
  it.each([
    null, { timeStartSeconds: -1, timeEndSeconds: 2, relevance: 1 },
    { timeStartSeconds: 2, timeEndSeconds: 1, relevance: 1 },
    { timeStartSeconds: 1, timeEndSeconds: Infinity, relevance: 1 },
    { timeStartSeconds: 1, timeEndSeconds: 2, relevance: NaN },
    { timeStartSeconds: 1, timeEndSeconds: 2, relevance: 1, frameReferences: ["\u202e"] },
  ])("rejects malformed temporal provenance %j", segment => {
    expect(hydrate(snapshot({ elevation: { ...observed("45_deg_graduation"), segments: [segment] } })).ok).toBe(false);
  });
  it("canonicalizes ordering and duplicate selection without merging observations", () => {
    const input = snapshot({ sectioning: observed(SECTIONING_OPTIONS[0]), elevation: observed(ELEVATION_OPTIONS[0]) });
    const a = hydrate(input, ["sectioning", "elevation", "sectioning"]);
    expect(a).toEqual(hydrate(input, ["elevation", "sectioning"]));
    if (!a.ok) throw new Error("hydration failed");
    expect(a.claims.map(c => c.id)).toEqual(["field:elevation", "field:sectioning"]);
  });
  it("rejects unsupported keys, malformed input and unknown field requests", () => {
    expect(hydrate(snapshot({ arbitrary: observed("x") })).ok).toBe(false);
    expect(hydrate(snapshot({}), ["__proto__"]).ok).toBe(false);
    expect(hydrate(snapshot([])).ok).toBe(false);
    expect(hydrate(snapshot({ elevation: { ...observed("45_deg_graduation"), skillId: "invented" } })).ok).toBe(false);
    expect(hydrate({ ...snapshot({}), id: "" }).ok).toBe(false);
  });
});
