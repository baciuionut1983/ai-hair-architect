import { describe, expect, it } from "vitest";
import { ELEVATION_OPTIONS, SECTIONING_OPTIONS, GUIDELINE_OPTIONS } from "@/lib/proposal-validators";
import { hydrateStructuredProfessionalFields, type StructuredProfessionalField } from "@/lib/structured-professional-field-claims";
import { deriveProfessionalFieldReviewCandidates as derive, isValidProfessionalFieldNote as noteValid, validateProfessionalFieldDecisionRequest as validate, PROFESSIONAL_FIELD_STALE_REASONS, type ProfessionalFieldReviewCandidate } from "@/lib/professional-field-review-candidates";

const snapshot = (extraction: unknown) => ({ id: "draft-1", sourceEvidenceId: "evidence-1", extractorVersion: "extractor-1", extraction });
const observed = (value: unknown) => ({ value, source: "OBSERVED" });
function candidates(extraction: unknown, fields?: readonly string[]) {
  const result = derive(snapshot(extraction), fields);
  if (!result.ok) throw new Error(result.reason);
  return result.candidates;
}
function one(value: unknown = "45_deg_graduation", field: StructuredProfessionalField = "elevation") { return candidates({ [field]: observed(value) })[0]; }
function request(candidate: ProfessionalFieldReviewCandidate, decision = "CONFIRMED", extra = {}) {
  return { candidateId: candidate.id, field: candidate.field, draftId: candidate.provenance.id, sourceEvidenceId: candidate.provenance.sourceEvidenceId,
    extractorVersion: candidate.provenance.extractorVersion, specificationVersion: candidate.specificationVersion, observationDigest: candidate.observationDigest, decision, ...extra };
}

describe("per-field review candidates", () => {
  it.each([["elevation", ELEVATION_OPTIONS], ["sectioning", SECTIONING_OPTIONS], ["guideType", GUIDELINE_OPTIONS]] as const)("reuses every %s canonical token", (field, values) => {
    for (const value of values) expect(one(value, field)).toMatchObject({ id: `field:${field}`, field, resolution: "CANONICAL", normalizedValue: value });
  });
  it.each(["45°", "approximately 45 degrees", "45° Interior", "cutting line slopes inward", " 45_deg_graduation", "45_DEG_GRADUATION"])("preserves %j without guessing meaning or normalizing", value => {
    expect(one(value)).toMatchObject({ resolution: "UNRESOLVED_TEXT", normalizedValue: null, original: observed(value) });
  });
  it("never moves a skill name or cutting-line value into elevation", () => {
    expect(candidates({ techniqueCandidate: observed("45° Interior"), cuttingLine: observed("45_deg_graduation") })).toEqual([]);
    expect(one("45_deg_graduation", "sectioning")).toMatchObject({ resolution: "UNRESOLVED_TEXT", normalizedValue: null });
  });
  it("uses existing semantic-guard UNKNOWN + rawObservation as UNCLEAR_MEANING", () => {
    for (const rawObservation of ["45°", "approximately 45 degrees", "45° Interior", "45_deg_graduation"]) {
      expect(candidates({ elevation: { value: null, source: "UNKNOWN", rawObservation } })[0]).toMatchObject({ resolution: "UNCLEAR_MEANING", normalizedValue: null, original: { rawObservation } });
    }
  });
  it.each([undefined, "", " \n\t"])("does not manufacture a review from empty UNKNOWN %j", rawObservation => {
    const result = derive(snapshot({ elevation: { value: null, source: "UNKNOWN", rawObservation, note: "No reliable observation" } }), ["elevation"]);
    expect(result).toEqual({ ok: true, candidates: [], outcomes: [{ field: "elevation", status: "EXTRACTION_UNKNOWN" }] });
  });
  it("keeps absent and empty non-UNKNOWN diagnostics distinct", () => {
    expect(derive(snapshot({ elevation: observed(" ") }), ["elevation", "guideType"])).toEqual({ ok: true, candidates: [], outcomes: [{ field: "elevation", status: "NO_OBSERVATION" }, { field: "guideType", status: "ABSENT" }] });
  });
  it("preserves valid neighbors while the a hydrator stays atomic", () => {
    const extraction = { elevation: observed("45_deg_graduation"), sectioning: observed("diagonal partings") };
    expect(candidates(extraction).map(c => c.resolution)).toEqual(["CANONICAL", "UNRESOLVED_TEXT"]);
    expect(hydrateStructuredProfessionalFields(snapshot(extraction))).toEqual({ ok: false, reason: "INVALID_VALUE" });
    const result = derive(snapshot({ ...extraction, guideType: { value: "x", source: "UNKNOWN" } }));
    expect(result.ok && result.candidates).toHaveLength(2);
    expect(result.ok && result.outcomes).toContainEqual({ field: "guideType", status: "INVALID_OBSERVATION" });
  });
  it("sorts by field identity and deduplicates field selection", () => {
    const extraction = { sectioning: observed(SECTIONING_OPTIONS[0]), elevation: observed(ELEVATION_OPTIONS[0]) };
    const first = candidates(extraction, ["sectioning", "elevation", "sectioning"]);
    expect(first).toEqual(candidates(extraction, ["elevation", "sectioning"]));
    expect(first.map(c => c.id)).toEqual(["field:elevation", "field:sectioning"]);
  });
  it("clones and deeply freezes original AI text and temporal/frame provenance", () => {
    const segments = [{ timeStartSeconds: 1, timeEndSeconds: 2, relevance: 0.8, confidence: 0.9, observations: "cadru\nurmător", frameReferences: ["frame-1"] }];
    const extraction = { elevation: { ...observed("45_deg_graduation"), note: "AI\nnote\twith formatting\u200b", rawObservation: "AI\noriginal", segments } };
    const candidate = candidates(extraction)[0];
    expect(candidate.original).toEqual(extraction.elevation);
    expect(candidate.resolution).toBe("CANONICAL");
    expect(Object.isFrozen(candidate.original.segments?.[0].frameReferences)).toBe(true);
    expect(Object.isFrozen(segments)).toBe(false);
    segments[0].frameReferences.push("frame-2");
    extraction.elevation.note = "changed";
    expect(candidate.original.note).toBe("AI\nnote\twith formatting\u200b");
    expect(candidate.original.segments?.[0].frameReferences).toEqual(["frame-1"]);
    expect(JSON.stringify(candidate)).not.toMatch(/applicability|skillId|skillVersion|eligible|binding|reviewDecision/);
  });
  it.each([null, [], 45, { value: "x", source: "PROFESSIONAL_INPUT" }, { ...observed("x"), skillId: "x" }, { ...observed("x"), confidence: Infinity }, { ...observed("x"), value: { arbitrary: "text" } }, { ...observed("x"), segments: [null] }, { ...observed("x"), segments: [{ timeStartSeconds: 2, timeEndSeconds: 1, relevance: 0.5 }] }])("reports malformed/non-AI field %j without losing neighbors", elevation => {
    const result = derive(snapshot({ elevation, sectioning: observed(SECTIONING_OPTIONS[0]) }));
    expect(result.ok && result.candidates).toHaveLength(1);
    expect(result.ok && result.outcomes).toContainEqual({ field: "elevation", status: "INVALID_OBSERVATION" });
  });
  it("rejects unsupported requests and invalid context/envelopes", () => {
    expect(derive(snapshot({}), ["cuttingLine"])).toEqual({ ok: false, reason: "UNSUPPORTED_FIELD" });
    expect(derive(snapshot({}), ["__proto__"])).toEqual({ ok: false, reason: "UNSUPPORTED_FIELD" });
    expect(derive({ ...snapshot({}), id: "" })).toEqual({ ok: false, reason: "INVALID_CONTEXT" });
    expect(derive(snapshot([]))).toEqual({ ok: false, reason: "INVALID_EXTRACTION" });
    expect(derive(snapshot({}), Array<string>(1))).toEqual({ ok: false, reason: "UNSUPPORTED_FIELD" });
  });
  it("rejects sparse provenance arrays instead of hashing ambiguous data", () => {
    for (const segments of [Array(1), [{ timeStartSeconds: 0, timeEndSeconds: 1, relevance: 1, frameReferences: Array(1) }]]) {
      const result = derive(snapshot({ elevation: { ...observed("45_deg_graduation"), segments } }), ["elevation"]);
      expect(result).toEqual({ ok: true, candidates: [], outcomes: [{ field: "elevation", status: "INVALID_OBSERVATION" }] });
    }
  });
});

describe("observation digest", () => {
  it("matches an independently computed SHA-256 fixture", () => {
    // Independent .NET SHA256 vector over the documented sorted JSON payload.
    expect(one().observationDigest).toBe("sha256:4c105ff02c4eef2aac2da9bd7c6f07d49144749a311b2a80c3b978e145d07b74");
  });
  it("is clone/key-order invariant and explicit lowercase SHA-256", () => {
    const a = one();
    expect(candidates({ elevation: { source: "OBSERVED", value: "45_deg_graduation" } })[0].observationDigest).toBe(a.observationDigest);
    expect(candidates({ elevation: structuredClone(a.original) })[0].observationDigest).toBe(a.observationDigest);
    expect(a.observationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it.each(["value", "note", "rawObservation", "source", "confidence", "segments"])("pins observation member %s", key => {
    const changes = { value: "other", note: "note", rawObservation: "raw", source: "INFERRED", confidence: 0.5, segments: [{ timeStartSeconds: 0, timeEndSeconds: 1, relevance: 1, frameReferences: ["f"] }] };
    const a = one();
    expect(candidates({ elevation: { ...a.original, [key]: changes[key as keyof typeof changes] } })[0].observationDigest).not.toBe(a.observationDigest);
  });
  it.each(["id", "sourceEvidenceId", "extractorVersion"])("pins authority context %s", key => {
    const result = derive({ ...snapshot({ elevation: observed("45_deg_graduation") }), [key]: "changed" });
    expect(result.ok && result.candidates[0].observationDigest).not.toBe(one().observationDigest);
  });
  it("pins field identity while ignoring unrelated fields and runtime envelope noise", () => {
    expect(one("text", "elevation").observationDigest).not.toBe(one("text", "sectioning").observationDigest);
    const input = { ...snapshot({ guideType: observed("different"), elevation: observed("45_deg_graduation") }), fetchedAt: Date.now() };
    const result = derive(input, ["elevation"]);
    expect(result.ok && result.candidates[0].observationDigest).toBe(one().observationDigest);
  });
  it("canonicalizes nested key order but retains segment/frame ordering and exact raw strings", () => {
    const base = { timeStartSeconds: 0, timeEndSeconds: 1, relevance: 1, frameReferences: ["a", "b"] };
    const digest = (segment: unknown, note = "é") => candidates({ elevation: { ...observed("45_deg_graduation"), note, segments: [segment] } })[0].observationDigest;
    expect(digest({ frameReferences: ["a", "b"], relevance: 1, timeEndSeconds: 1, timeStartSeconds: 0 })).toBe(digest(base));
    expect(digest({ ...base, frameReferences: ["b", "a"] })).not.toBe(digest(base));
    expect(digest(base, "e\u0301")).not.toBe(digest(base));
  });
});

describe("professional decision matrix", () => {
  const canonical = one();
  const unresolved = one("approximately 45 degrees");
  const unclear = candidates({ elevation: { value: null, source: "UNKNOWN", rawObservation: "45°" } })[0];
  it.each([canonical, unresolved, unclear])("validates all decisions for $resolution", candidate => {
    expect(validate(candidate, request(candidate)).ok).toBe(candidate.resolution === "CANONICAL");
    expect(validate(candidate, request(candidate, "CORRECTED", { correctedValue: "90_deg_uniform_layer" })).ok).toBe(true);
    for (const decision of ["UNKNOWN", "REJECTED"]) {
      const result = validate(candidate, request(candidate, decision));
      expect(result.ok && result.request.decision).toBe(decision);
    }
  });
  it("requires CONFIRMED when canonical value is unchanged", () => {
    expect(validate(canonical, request(canonical, "CORRECTED", { correctedValue: canonical.normalizedValue }))).toEqual({ ok: false, reason: "USE_CONFIRMED" });
  });
  it.each([["elevation", ELEVATION_OPTIONS], ["sectioning", SECTIONING_OPTIONS], ["guideType", GUIDELINE_OPTIONS]] as const)("restricts %s corrections to its own canonical values", (field, values) => {
    const candidate = one("uncanonical observation", field);
    for (const correctedValue of values) expect(validate(candidate, request(candidate, "CORRECTED", { correctedValue })).ok).toBe(true);
    expect(validate(candidate, request(candidate, "CORRECTED", { correctedValue: field === "elevation" ? SECTIONING_OPTIONS[0] : ELEVATION_OPTIONS[0] })).ok).toBe(false);
  });
  it.each(["45°", "approximately 45 degrees", "45_deg_graduation ", 45, null, undefined, "arbitrary"])("rejects invalid correction %j", correctedValue => {
    expect(validate(unresolved, request(unresolved, "CORRECTED", { correctedValue })).ok).toBe(false);
  });
  it.each(["field", "candidateId", "draftId", "sourceEvidenceId", "extractorVersion", "specificationVersion", "observationDigest"])("rejects altered reference %s", key => {
    expect(validate(canonical, { ...request(canonical), [key]: "changed" })).toEqual({ ok: false, reason: "CANDIDATE_REFERENCE_MISMATCH" });
  });
  it("rejects reassignment, arbitrary decisions, extra authority and corrected values on other decisions", () => {
    for (const extra of [{ field: "cuttingLine" }, { field: "invented" }, { targetField: "cuttingAngle" }, { skillId: "x" }, { applicability: {} }, { decision: "APPROVED" }, { correctedValue: undefined }]) expect(validate(canonical, request(canonical, "CONFIRMED", extra)).ok).toBe(false);
  });
  it("notes are annotation only and do not reassign fields", () => {
    const req = request(unclear, "REJECTED", { note: "Actually cuttingLine\nnu elevation\t🎥" });
    const result = validate(unclear, req);
    expect(result.ok && result.request).toEqual(req);
    expect(result.ok && Object.isFrozen(result.request)).toBe(true);
    expect(validate(unclear, { ...req, note: "bad\u200b" })).toEqual({ ok: false, reason: "INVALID_NOTE" });
  });
  it("rejects inconsistent candidates, including resolution and digest forgery", () => {
    for (const candidate of [{ ...canonical, normalizedValue: "90_deg_uniform_layer" }, { ...canonical, observationDigest: "sha256:fake" }, { ...unresolved, resolution: "CANONICAL" }]) expect(validate(candidate as ProfessionalFieldReviewCandidate, request(canonical)).ok).toBe(false);
  });
  it("keeps stale reasons closed and separate from storage evaluation", () => {
    expect(PROFESSIONAL_FIELD_STALE_REASONS).toEqual(["OBSERVATION_DIGEST_MISMATCH", "SPEC_VERSION_CHANGED", "VALUE_NOT_IN_CURRENT_SPEC", "DRAFT_NOT_APPROVED", "DRAFT_SUPERSEDED", "EVIDENCE_NOT_ACTIVE", "EVIDENCE_SOURCE_DELETED"]);
  });
});

describe("professional notes", () => {
  it.each(["Română: ăâîșț ĂÂÎȘȚ", "🎥 ✂️", "1️⃣", "line\nline", "a\tb", "x".repeat(1000), "🎥".repeat(500)])("accepts annotation %j unchanged", note => expect(noteValid(note)).toBe(true));
  it.each(["\u0000", "\u0008", "\u000b", "\r", "\u001f", "\u007f", "\u0085", "\u009f", "\u200b", "\u200d", "\u2060", "\ufeff", "\u202e", "\u2067", "\ud800", "\udfff", "\u034f", "\u3164", "\ufe0f", "\ufe00"])("rejects unsafe %j", control => expect(noteValid(`a${control}b`)).toBe(false));
  it.each([null, 1, {}, "x".repeat(1001), "🎥".repeat(501)])("rejects invalid/oversize note", note => expect(noteValid(note)).toBe(false));
  it.each(["", "   ", "\t\n", "\u00a0", "a\u2028b", "a\u2029b"])("rejects empty/whitespace/separator annotation %j", note => expect(noteValid(note)).toBe(false));
  it.each(["\ue000", "\ufdd0", "\uffff", "\u0378", "\u{f0000}", "\u{10ffff}"])("does not broaden policy for deferred Unicode %j", note => expect(noteValid(note)).toBe(true));
  it("preserves absence and exact present text without trimming", () => {
    const candidate = one();
    const absent = validate(candidate, request(candidate));
    expect(absent.ok && Object.hasOwn(absent.request, "note")).toBe(false);
    const explicit = validate(candidate, request(candidate, "CONFIRMED", { note: undefined }));
    expect(explicit.ok && explicit.request.note).toBeUndefined();
    const text = " \tȘuviță 🎥\n ";
    const result = validate(candidate, request(candidate, "CONFIRMED", { note: text }));
    expect(result.ok && result.request.note).toBe(text);
    for (const note of ["", " \n\t", "x\u2028y", "x\u2029y"]) expect(validate(candidate, request(candidate, "CONFIRMED", { note }))).toEqual({ ok: false, reason: "INVALID_NOTE" });
  });
});
