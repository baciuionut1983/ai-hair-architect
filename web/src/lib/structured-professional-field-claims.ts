import { ELEVATION_OPTIONS, SECTIONING_OPTIONS, GUIDELINE_OPTIONS } from "@/lib/proposal-validators";
import { isValidExtraction, type ProfessionalLearningExtractedField, type ProfessionalLearningExtractionFieldName } from "@/lib/professional-learning-draft-validators";

export const STRUCTURED_FIELD_SPEC_VERSION = "1.0.0-t162a" as const;
export const PROFESSIONAL_VALUE_MAX_LENGTH = 2000;
export type ProfessionalClaimClassification = "OBSERVATIONAL" | "DECISION_RELEVANT_STRUCTURED_FIELD";

// TD's primitive vocabularies, not the override module's derivation dependency.
function specification<F extends ProfessionalLearningExtractionFieldName, V extends string>(field: F, values: readonly V[]) {
  const allowedValues = Object.freeze([...values]);
  return Object.freeze({
    field, sourceExtractionField: field, semanticCategory: field,
    version: STRUCTURED_FIELD_SPEC_VERSION, valueKind: "enum" as const,
    normalization: "EXACT_IDENTITY" as const, unknownRepresentable: true,
    professionalCorrectionAllowed: true,
    allowedValues,
    validate: (value: unknown): value is V => isSafeProfessionalText(value) && allowedValues.includes(value as V),
  });
}
export const STRUCTURED_FIELD_SPECIFICATIONS = Object.freeze({
  elevation: specification("elevation", ELEVATION_OPTIONS),
  sectioning: specification("sectioning", SECTIONING_OPTIONS),
  guideType: specification("guideType", GUIDELINE_OPTIONS),
});
export type StructuredProfessionalField = keyof typeof STRUCTURED_FIELD_SPECIFICATIONS;
type FieldValue<F extends StructuredProfessionalField> = (typeof STRUCTURED_FIELD_SPECIFICATIONS)[F]["allowedValues"][number];
export type StructuredProfessionalFieldClaim = { [F in StructuredProfessionalField]: {
  readonly id: `field:${F}`;
  readonly field: F;
  readonly classification: "DECISION_RELEVANT_STRUCTURED_FIELD";
  readonly specificationVersion: typeof STRUCTURED_FIELD_SPEC_VERSION;
  readonly normalized: { readonly state: "KNOWN"; readonly value: FieldValue<F> } | { readonly state: "UNKNOWN"; readonly value: null };
  readonly original: ProfessionalLearningExtractedField;
  readonly provenance: FrozenExtractionReference & { readonly sourceExtractionField: F };
} }[StructuredProfessionalField];

// Existing draft identity/version references; caller supplies a frozen snapshot.
// This pure boundary cannot authenticate ownership or verify evidence storage.
export interface FrozenExtractionReference {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly extractorVersion: string;
}
export interface FrozenFieldExtraction extends FrozenExtractionReference { readonly extraction: unknown }

export function isSafeProfessionalText(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > PROFESSIONAL_VALUE_MAX_LENGTH) return false;
  // Reject rather than trim, replace, or normalize controls / invisible format characters.
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180f\u2800\u3164\ufe00-\ufe0f\uffa0\u{e0100}-\u{e01ef}]/u.test(value)) return false;
  return value.trim().length > 0;
}
export function isStructuredProfessionalField(value: unknown): value is StructuredProfessionalField {
  return typeof value === "string" && Object.hasOwn(STRUCTURED_FIELD_SPECIFICATIONS, value);
}
export function validateProfessionalFieldValue<F extends StructuredProfessionalField>(field: F, value: unknown): value is FieldValue<F>;
export function validateProfessionalFieldValue(field: unknown, value: unknown): boolean;
export function validateProfessionalFieldValue(field: unknown, value: unknown): boolean {
  return isStructuredProfessionalField(field) && STRUCTURED_FIELD_SPECIFICATIONS[field].validate(value);
}
function safeOriginal(field: ProfessionalLearningExtractedField): boolean {
  if (Object.keys(field).some(key => !["value", "source", "confidence", "note", "segments", "rawObservation"].includes(key))) return false;
  if (field.note !== undefined && !isSafeProfessionalText(field.note)) return false;
  if (field.rawObservation !== undefined && !isSafeProfessionalText(field.rawObservation)) return false;
  if (field.segments === undefined) return true;
  if (field.segments.length > 100) return false;
  return field.segments.every(segment => {
    if (!segment || typeof segment !== "object" || Object.keys(segment).some(key => !["timeStartSeconds", "timeEndSeconds", "relevance", "observations", "confidence", "frameReferences"].includes(key))) return false;
    return Number.isFinite(segment.timeStartSeconds) && segment.timeStartSeconds >= 0
      && Number.isFinite(segment.timeEndSeconds) && segment.timeEndSeconds >= segment.timeStartSeconds
      && Number.isFinite(segment.relevance) && segment.relevance >= 0 && segment.relevance <= 1
      && (segment.confidence === undefined || (Number.isFinite(segment.confidence) && segment.confidence >= 0 && segment.confidence <= 1))
      && (segment.observations === undefined || isSafeProfessionalText(segment.observations))
      && (segment.frameReferences === undefined || (Array.isArray(segment.frameReferences) && segment.frameReferences.length <= 100 && segment.frameReferences.every(isSafeProfessionalText)));
  });
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export type FieldHydrationResult =
  | { readonly ok: true; readonly claims: readonly StructuredProfessionalFieldClaim[] }
  | { readonly ok: false; readonly reason: "INVALID_EXTRACTION" | "UNSUPPORTED_FIELD" | "INVALID_VALUE" };

// IDs are unique within the frozen extraction, scoped globally by provenance.id.
// Explicit field selection rejects unsupported requests; duplicate selections collapse.
export function hydrateStructuredProfessionalFields(snapshot: FrozenFieldExtraction, fields: readonly string[] = Object.keys(STRUCTURED_FIELD_SPECIFICATIONS)): FieldHydrationResult {
  if (!snapshot || !isSafeProfessionalText(snapshot.id) || !isSafeProfessionalText(snapshot.sourceEvidenceId)
    || !isSafeProfessionalText(snapshot.extractorVersion) || !isValidExtraction(snapshot.extraction)) return { ok: false, reason: "INVALID_EXTRACTION" };
  if (!Array.isArray(fields) || fields.some(field => !isStructuredProfessionalField(field))) return { ok: false, reason: "UNSUPPORTED_FIELD" };
  const claims: StructuredProfessionalFieldClaim[] = [];
  for (const field of [...new Set(fields)].sort() as StructuredProfessionalField[]) {
    const original = snapshot.extraction[field];
    if (!original) continue;
    if (!safeOriginal(original) || !["OBSERVED", "INFERRED", "UNKNOWN"].includes(original.source)) return { ok: false, reason: "INVALID_VALUE" };
    const unknown = original.source === "UNKNOWN" && original.value === null;
    if (!unknown && !validateProfessionalFieldValue(field, original.value)) return { ok: false, reason: "INVALID_VALUE" };
    claims.push({
      id: `field:${field}`, field, classification: "DECISION_RELEVANT_STRUCTURED_FIELD", specificationVersion: STRUCTURED_FIELD_SPEC_VERSION,
      normalized: unknown ? { state: "UNKNOWN", value: null } : { state: "KNOWN", value: original.value },
      original: structuredClone(original),
      provenance: { id: snapshot.id, sourceEvidenceId: snapshot.sourceEvidenceId, extractorVersion: snapshot.extractorVersion, sourceExtractionField: field },
    } as StructuredProfessionalFieldClaim);
  }
  return freeze({ ok: true, claims });
}
