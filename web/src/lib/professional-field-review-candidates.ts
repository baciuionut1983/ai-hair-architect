import { createHash } from "node:crypto";
import { isValidExtraction, type ProfessionalLearningExtractedField } from "@/lib/professional-learning-draft-validators";
import { isSafeProfessionalText, isStructuredProfessionalField, STRUCTURED_FIELD_SPECIFICATIONS, validateProfessionalFieldValue, type FrozenExtractionReference, type FrozenFieldExtraction, type StructuredProfessionalField, type StructuredProfessionalFieldClaim } from "@/lib/structured-professional-field-claims";

export const OBSERVATION_DIGEST_VERSION = "professional-field-observation-v1" as const;
export type ObservationDigest = `sha256:${string}`;
export type CandidateResolution = "CANONICAL" | "UNRESOLVED_TEXT" | "UNCLEAR_MEANING";
export type ProfessionalFieldReviewCandidate = { [F in StructuredProfessionalField]: {
  readonly id: `field:${F}`;
  readonly field: F;
  readonly specificationVersion: typeof STRUCTURED_FIELD_SPECIFICATIONS[F]["version"];
  readonly original: ProfessionalLearningExtractedField;
  readonly provenance: FrozenExtractionReference & { readonly sourceExtractionField: F };
  readonly observationDigest: ObservationDigest;
} & (
  | { readonly resolution: "CANONICAL"; readonly normalizedValue: Extract<Extract<StructuredProfessionalFieldClaim, { field: F }>["normalized"], { state: "KNOWN" }>["value"] }
  | { readonly resolution: "UNRESOLVED_TEXT" | "UNCLEAR_MEANING"; readonly normalizedValue: null }
) }[StructuredProfessionalField];

export type FieldDerivationOutcome =
  | { readonly field: StructuredProfessionalField; readonly status: "CANDIDATE"; readonly candidate: ProfessionalFieldReviewCandidate }
  | { readonly field: StructuredProfessionalField; readonly status: "ABSENT" | "EXTRACTION_UNKNOWN" | "NO_OBSERVATION" | "INVALID_OBSERVATION" };
export type CandidateDerivationResult =
  | { readonly ok: true; readonly candidates: readonly ProfessionalFieldReviewCandidate[]; readonly outcomes: readonly FieldDerivationOutcome[] }
  | { readonly ok: false; readonly reason: "INVALID_CONTEXT" | "INVALID_EXTRACTION" | "UNSUPPORTED_FIELD" };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function keysOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function meaningful(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function unit(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }

// Provenance is structurally checked, never sanitized or validated as professional authority.
function validOriginal(field: StructuredProfessionalField, value: unknown): value is ProfessionalLearningExtractedField {
  if (!record(value) || !keysOnly(value, ["value", "source", "confidence", "note", "rawObservation", "segments"])
    || !isValidExtraction({ [field]: value }) || !["OBSERVED", "INFERRED", "UNKNOWN"].includes(value.source as string)
    || (value.value != null && typeof value.value !== "string")) return false;
  if (value.segments === undefined) return true;
  if (!Array.isArray(value.segments) || value.segments.length > 100) return false;
  return Array.from(value.segments).every(segment => {
    if (!record(segment) || !keysOnly(segment, ["timeStartSeconds", "timeEndSeconds", "relevance", "confidence", "observations", "frameReferences"])) return false;
    return typeof segment.timeStartSeconds === "number" && Number.isFinite(segment.timeStartSeconds) && segment.timeStartSeconds >= 0
      && typeof segment.timeEndSeconds === "number" && Number.isFinite(segment.timeEndSeconds) && segment.timeEndSeconds >= segment.timeStartSeconds
      && unit(segment.relevance) && (segment.confidence === undefined || unit(segment.confidence))
      && (segment.observations === undefined || typeof segment.observations === "string")
      && (segment.frameReferences === undefined || (Array.isArray(segment.frameReferences) && segment.frameReferences.length <= 100 && Array.from(segment.frameReferences).every(frame => typeof frame === "string")));
  });
}

// Only validated JSON-shaped candidate data enters this encoder. Optional undefined
// members are absent; arrays retain order; strings retain exact UTF-16 contents.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Caller supplies the authoritative frozen snapshot. This pure layer cannot prove
// ownership, evidence activity, or authenticity. No semantic text classifier here.
export function deriveProfessionalFieldReviewCandidates(snapshot: FrozenFieldExtraction, fields: readonly string[] = Object.keys(STRUCTURED_FIELD_SPECIFICATIONS)): CandidateDerivationResult {
  if (!snapshot || !isSafeProfessionalText(snapshot.id) || !isSafeProfessionalText(snapshot.sourceEvidenceId) || !isSafeProfessionalText(snapshot.extractorVersion)) return { ok: false, reason: "INVALID_CONTEXT" };
  if (!record(snapshot.extraction)) return { ok: false, reason: "INVALID_EXTRACTION" };
  if (!Array.isArray(fields) || Array.from(fields).some(field => !isStructuredProfessionalField(field))) return { ok: false, reason: "UNSUPPORTED_FIELD" };
  const candidates: ProfessionalFieldReviewCandidate[] = [];
  const outcomes: FieldDerivationOutcome[] = [];
  for (const field of [...new Set(fields)].sort() as StructuredProfessionalField[]) {
    if (!Object.hasOwn(snapshot.extraction, field)) { outcomes.push({ field, status: "ABSENT" }); continue; }
    const original = snapshot.extraction[field];
    if (!validOriginal(field, original)) { outcomes.push({ field, status: "INVALID_OBSERVATION" }); continue; }
    // The existing semantic guard uses UNKNOWN + rawObservation for uncertain
    // FIELD assignment. Empty UNKNOWN is diagnostic only, never reviewable.
    if (original.source === "UNKNOWN" && !meaningful(original.rawObservation)) { outcomes.push({ field, status: "EXTRACTION_UNKNOWN" }); continue; }
    if (!meaningful(original.value) && !meaningful(original.rawObservation)) { outcomes.push({ field, status: "NO_OBSERVATION" }); continue; }
    const canonical = original.source !== "UNKNOWN" && validateProfessionalFieldValue(field, original.value);
    const data = {
      id: `field:${field}` as const, field,
      specificationVersion: STRUCTURED_FIELD_SPECIFICATIONS[field].version,
      original: structuredClone(original),
      provenance: { id: snapshot.id, sourceEvidenceId: snapshot.sourceEvidenceId, extractorVersion: snapshot.extractorVersion, sourceExtractionField: field },
      resolution: original.source === "UNKNOWN" ? "UNCLEAR_MEANING" : canonical ? "CANONICAL" : "UNRESOLVED_TEXT",
      normalizedValue: canonical ? original.value : null,
    };
    const observationDigest: ObservationDigest = `sha256:${createHash("sha256").update(canonicalJson({ digestVersion: OBSERVATION_DIGEST_VERSION, ...data }), "utf8").digest("hex")}`;
    const candidate = freeze({ ...data, observationDigest }) as ProfessionalFieldReviewCandidate;
    candidates.push(candidate);
    outcomes.push({ field, status: "CANDIDATE", candidate });
  }
  return freeze({ ok: true, candidates, outcomes });
}

export const PROFESSIONAL_FIELD_DECISIONS = ["CONFIRMED", "CORRECTED", "UNKNOWN", "REJECTED"] as const;
export type ProfessionalFieldDecision = (typeof PROFESSIONAL_FIELD_DECISIONS)[number];
export type ProfessionalFieldDecisionRequest = { [F in StructuredProfessionalField]: {
  readonly candidateId: `field:${F}`;
  readonly field: F;
  readonly draftId: string;
  readonly sourceEvidenceId: string;
  readonly extractorVersion: string;
  readonly specificationVersion: string;
  readonly observationDigest: ObservationDigest;
  readonly note?: string;
} & (
  | { readonly decision: "CONFIRMED" | "UNKNOWN" | "REJECTED"; readonly correctedValue?: never }
  | { readonly decision: "CORRECTED"; readonly correctedValue: Extract<Extract<StructuredProfessionalFieldClaim, { field: F }>["normalized"], { state: "KNOWN" }>["value"] }
) }[StructuredProfessionalField];

export const PROFESSIONAL_NOTE_MAX_LENGTH = 1000;
export function isValidProfessionalFieldNote(value: unknown): value is string {
  if (typeof value !== "string" || value.length > PROFESSIONAL_NOTE_MAX_LENGTH || value.trim().length === 0) return false;
  // Permit presentation selectors only inside intact emoji sequences. This
  // temporary safety scan never replaces the original annotation returned.
  const safetyText = value.replace(/(?:\p{Extended_Pictographic}[\ufe0e\ufe0f]|[0-9#*]\ufe0f\u20e3)/gu, "");
  return !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}\p{Cs}\u2028\u2029\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180f\u2800\u3164\ufe00-\ufe0f\uffa0\u{e0100}-\u{e01ef}]/u.test(safetyText);
}

export type DecisionValidationResult =
  | { readonly ok: true; readonly request: ProfessionalFieldDecisionRequest }
  | { readonly ok: false; readonly reason: "INVALID_CANDIDATE" | "INVALID_REQUEST" | "CANDIDATE_REFERENCE_MISMATCH" | "INVALID_NOTE" | "CONFIRM_REQUIRES_CANONICAL" | "INVALID_CORRECTION" | "USE_CONFIRMED" };

export function validateProfessionalFieldDecisionRequest(candidate: ProfessionalFieldReviewCandidate, request: unknown): DecisionValidationResult {
  // Re-derive to reject inconsistent/forged candidate data; this is NOT an
  // authenticity check. b.1 must load the authoritative snapshot itself.
  if (!candidate || !candidate.provenance || !isStructuredProfessionalField(candidate.field)) return { ok: false, reason: "INVALID_CANDIDATE" };
  const derived = deriveProfessionalFieldReviewCandidates({ ...candidate.provenance, extraction: { [candidate.field]: candidate.original } }, [candidate.field]);
  if (!derived.ok || !derived.candidates[0] || canonicalJson(derived.candidates[0]) !== canonicalJson(candidate)) return { ok: false, reason: "INVALID_CANDIDATE" };
  if (!record(request) || !keysOnly(request, ["candidateId", "field", "draftId", "sourceEvidenceId", "extractorVersion", "specificationVersion", "observationDigest", "decision", "correctedValue", "note"])
    || !PROFESSIONAL_FIELD_DECISIONS.includes(request.decision as ProfessionalFieldDecision)) return { ok: false, reason: "INVALID_REQUEST" };
  if (request.candidateId !== candidate.id || request.field !== candidate.field || request.draftId !== candidate.provenance.id
    || request.sourceEvidenceId !== candidate.provenance.sourceEvidenceId || request.extractorVersion !== candidate.provenance.extractorVersion
    || request.specificationVersion !== candidate.specificationVersion || request.observationDigest !== candidate.observationDigest) return { ok: false, reason: "CANDIDATE_REFERENCE_MISMATCH" };
  if (request.note !== undefined && !isValidProfessionalFieldNote(request.note)) return { ok: false, reason: "INVALID_NOTE" };
  if (request.decision !== "CORRECTED" && Object.hasOwn(request, "correctedValue")) return { ok: false, reason: "INVALID_REQUEST" };
  if (request.decision === "CONFIRMED" && candidate.resolution !== "CANONICAL") return { ok: false, reason: "CONFIRM_REQUIRES_CANONICAL" };
  if (request.decision === "CORRECTED") {
    if (!validateProfessionalFieldValue(candidate.field, request.correctedValue)) return { ok: false, reason: "INVALID_CORRECTION" };
    if (candidate.resolution === "CANONICAL" && request.correctedValue === candidate.normalizedValue) return { ok: false, reason: "USE_CONFIRMED" };
  }
  return { ok: true, request: freeze(structuredClone(request)) as ProfessionalFieldDecisionRequest };
}

export const PROFESSIONAL_FIELD_STALE_REASONS = [
  "OBSERVATION_DIGEST_MISMATCH", "SPEC_VERSION_CHANGED", "VALUE_NOT_IN_CURRENT_SPEC",
  "DRAFT_NOT_APPROVED", "DRAFT_SUPERSEDED", "EVIDENCE_NOT_ACTIVE", "EVIDENCE_SOURCE_DELETED",
] as const;
export type ProfessionalFieldStaleReason = (typeof PROFESSIONAL_FIELD_STALE_REASONS)[number];
