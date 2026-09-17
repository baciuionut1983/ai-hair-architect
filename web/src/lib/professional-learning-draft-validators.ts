// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- PROFESSIONAL
// LEARNING DISCERNMENT + STRUCTURED KNOWLEDGE EXTRACTION DRAFT, pure
// domain validators. No I/O, no database, no provider call -- mirrors
// this repo's own established "validators file, separate from repository
// file" convention (professional-learning-evidence-validators.ts /
// -repository.ts).
//
// SOURCE != TRUTH (this stage's absolute rule): every extracted field
// below carries its OWN provenance tag. There is deliberately no single
// scalar "how sure are we" column on the draft as a whole -- that would
// silently collapse "the technique name is OBSERVED but the elevation is
// UNKNOWN" into one meaningless average. UNKNOWN MUST REMAIN UNKNOWN: a
// missing field is always an explicit `{ value: null, source: "UNKNOWN" }`
// entry, never an omitted key and never a guessed value.

// ---------------------------------------------------------------------------
// Draft lifecycle (Part 4). This is the DRAFT's own review lifecycle --
// entirely independent of ProfessionalLearningEvidence.status (which is
// the source material's own availability lifecycle). APPROVED records
// PROFESSIONAL REVIEW APPROVED only -- it never creates, updates, or
// activates a ProfessionalSkillDefinition row (Part 28); registry
// promotion is an explicitly later, separately-authorized stage.
// ---------------------------------------------------------------------------

// Stage 8.5T1.2.R1 -- REANALYZING is a transient, in-flight marker (Part
// "explicit reanalysis"): claimed atomically right before the extractor
// is invoked, and always resolved back to DRAFT before any response is
// ever returned to a caller (either with the new result on success, or
// unchanged on a caught failure -- see professional-learning-draft-
// repository.ts's claimDraftForReanalysis/completeReanalysis/
// revertFailedReanalysis). No caller-facing code path should normally
// observe this value; it exists so a concurrent second request can be
// told "already in progress" instead of triggering a second provider
// call.
export const PROFESSIONAL_LEARNING_DRAFT_STATUSES = ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED", "REANALYZING"] as const;
export type ProfessionalLearningDraftStatus = (typeof PROFESSIONAL_LEARNING_DRAFT_STATUSES)[number];

export function isProfessionalLearningDraftStatus(value: unknown): value is ProfessionalLearningDraftStatus {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_DRAFT_STATUSES as readonly string[]).includes(value);
}

// Fail-closed transition table -- a status change is legal only if it is
// explicitly listed here. Terminal states (APPROVED, REJECTED, SUPERSEDED)
// have no outgoing edges of their own; the ONLY way out of APPROVED/
// REJECTED is a professional correction creating a brand-new draft that
// separately marks the OLD row SUPERSEDED (see
// professional-learning-draft-repository.ts) -- never an in-place
// resurrection. REANALYZING is reachable only from DRAFT/READY_FOR_REVIEW
// (never from an already-decided APPROVED/REJECTED row -- professional
// authority, once crossed, is never silently rewritten by a reanalysis
// action) and always resolves back to DRAFT.
const LEGAL_DRAFT_STATUS_TRANSITIONS: Readonly<Record<ProfessionalLearningDraftStatus, readonly ProfessionalLearningDraftStatus[]>> = {
  DRAFT: ["READY_FOR_REVIEW", "SUPERSEDED", "REANALYZING"],
  READY_FOR_REVIEW: ["APPROVED", "REJECTED", "SUPERSEDED", "REANALYZING"],
  APPROVED: ["SUPERSEDED"],
  REJECTED: ["SUPERSEDED"],
  SUPERSEDED: [],
  REANALYZING: ["DRAFT"],
};

export function isLegalDraftStatusTransition(from: ProfessionalLearningDraftStatus, to: ProfessionalLearningDraftStatus): boolean {
  return LEGAL_DRAFT_STATUS_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Discernment (Part 8) -- what the evidence appears to contain, decided
// BEFORE structured extraction is attempted. The system must be able to
// say plainly "this material does not contain reusable professional
// knowledge" (IRRELEVANT / INSUFFICIENT_EVIDENCE) -- not every upload is
// forced to teach something.
// ---------------------------------------------------------------------------

export const PROFESSIONAL_LEARNING_DISCERNMENT_CATEGORIES = [
  "PROFESSIONAL_TECHNIQUE",
  "PROFESSIONAL_VARIATION",
  "PROFESSIONAL_CORRECTION",
  "PROFESSIONAL_RULE",
  "PROFESSIONAL_RATIONALE",
  "PROFESSIONAL_EXAMPLE",
  "TOOL_INFORMATION",
  "PRODUCT_INFORMATION",
  "BRAND_INFORMATION",
  "RESULT_REFERENCE",
  "TREND_INFORMATION",
  "IRRELEVANT",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type ProfessionalLearningDiscernmentCategory = (typeof PROFESSIONAL_LEARNING_DISCERNMENT_CATEGORIES)[number];

export function isProfessionalLearningDiscernmentCategory(value: unknown): value is ProfessionalLearningDiscernmentCategory {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_DISCERNMENT_CATEGORIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Compare-before-create (Part 10). Never create a new skill merely
// because wording differs -- mirrors Stage 4's own "capability-declared,
// never keyword-guessed" discipline: a new skill is justified only when
// nothing in the registry already covers the described transformation.
// ---------------------------------------------------------------------------

export const PROFESSIONAL_LEARNING_COMPARISON_OUTCOMES = [
  "MATCH_EXISTING",
  "EVIDENCE_FOR_EXISTING",
  "VARIATION_OF_EXISTING",
  "POSSIBLE_CORRECTION",
  "POSSIBLE_CONFLICT",
  "POSSIBLE_NEW_SKILL",
  "INSUFFICIENT_INFORMATION",
] as const;
export type ProfessionalLearningComparisonOutcome = (typeof PROFESSIONAL_LEARNING_COMPARISON_OUTCOMES)[number];

export function isProfessionalLearningComparisonOutcome(value: unknown): value is ProfessionalLearningComparisonOutcome {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_COMPARISON_OUTCOMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Field-level provenance (Part 5/22). OBSERVED / INFERRED /
// PROFESSIONAL_INPUT / UNKNOWN are the four REQUIRED-to-preserve classes
// this stage's task names explicitly. EXTERNAL_RESEARCH / MANUFACTURER_CLAIM
// / TREND_SIGNAL are future-capable only -- same "declared now, unused
// until the matching evidence type/feature exists" discipline as
// ProfessionalLearningEvidence's own FUTURE_CAPABLE_ONLY_EVIDENCE_TYPES.
// Confidence (a separate, optional numeric field on each extracted fact)
// is NEVER a substitute for one of these classes: a field can be
// INFERRED with high confidence and still remain INFERRED (Part 22) --
// professional authority and model confidence are different dimensions,
// never merged into one axis.
// ---------------------------------------------------------------------------

export const PROFESSIONAL_LEARNING_PROVENANCE_SOURCES = [
  "OBSERVED",
  "INFERRED",
  "PROFESSIONAL_INPUT",
  "UNKNOWN",
  "EXTERNAL_RESEARCH",
  "MANUFACTURER_CLAIM",
  "TREND_SIGNAL",
] as const;
export type ProfessionalLearningProvenanceSource = (typeof PROFESSIONAL_LEARNING_PROVENANCE_SOURCES)[number];

export const FUTURE_CAPABLE_ONLY_PROVENANCE_SOURCES = ["EXTERNAL_RESEARCH", "MANUFACTURER_CLAIM", "TREND_SIGNAL"] as const;

export function isProfessionalLearningProvenanceSource(value: unknown): value is ProfessionalLearningProvenanceSource {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_PROVENANCE_SOURCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Structured extraction schema (Part 7). Domain-general, NOT haircut-
// name/template-centric -- these are reusable professional-procedure
// concepts (Part 16: hair/cutting is only the proof domain; the field
// vocabulary itself names no cutting-specific value). Every field is
// OPTIONAL at the object level (Part 7: "Do NOT require every field") --
// a field that IS present must always carry a `source`; a field with no
// evidence at all is simply omitted or explicitly `{ value: null, source:
// "UNKNOWN" }` (both are treated identically by isValidExtraction below).
// ---------------------------------------------------------------------------

export const PROFESSIONAL_LEARNING_EXTRACTION_FIELD_NAMES = [
  "domain",
  "discipline",
  "techniqueCandidate",
  "professionalObjective",
  "startingState",
  "targetEffect",
  "applicableZones",
  "sectioning",
  "subsectioning",
  "subsectionThickness",
  "guideType",
  "guideSource",
  "elevation",
  "distribution",
  "overdirection",
  "fingerPosition",
  "fingerAngle",
  "tool",
  "toolOrientation",
  "cuttingAngle",
  "cuttingLine",
  "progression",
  "iteration",
  "completionCondition",
  "crossCheck",
  "verificationCriteria",
  "positioning",
  "observationViewpoint",
  "stylingRelationship",
  "prerequisites",
  "incompatibilities",
  "safety",
  "professionalRationale",
] as const;
export type ProfessionalLearningExtractionFieldName = (typeof PROFESSIONAL_LEARNING_EXTRACTION_FIELD_NAMES)[number];

export function isProfessionalLearningExtractionFieldName(value: unknown): value is ProfessionalLearningExtractionFieldName {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_EXTRACTION_FIELD_NAMES as readonly string[]).includes(value);
}

// A future long-video segment reference (Part 19/L5 compatibility only --
// nothing in this stage ever populates this array with a real value; the
// shape exists so a later segmented-video extractor can attach it without
// a schema change).
export interface ProfessionalLearningExtractionSegmentReference {
  readonly timeStartSeconds: number;
  readonly timeEndSeconds: number;
  readonly relevance: number;
  readonly observations?: string;
  readonly confidence?: number;
  readonly frameReferences?: readonly string[];
}

export interface ProfessionalLearningExtractedField {
  readonly value: unknown;
  readonly source: ProfessionalLearningProvenanceSource;
  // Model confidence -- see file header: never a replacement for `source`.
  readonly confidence?: number;
  readonly note?: string;
  // Present only for a field derived from long-video evidence (Part 19).
  readonly segments?: readonly ProfessionalLearningExtractionSegmentReference[];
  // Stage 8.5L4.R2.2 (Part 13: "Observation First") -- when a general
  // semantic-binding guard (professional-learning-semantic-binding-guard.ts)
  // downgrades a claim because the FIELD NAME assignment itself is not
  // safely established (even though something real was seen), the
  // original observation text is preserved here rather than discarded --
  // `value`/`source` become the honest {null, "UNKNOWN"}, but a reviewer
  // can still see what was actually observed. Never set by an extractor
  // directly; only ever written by the server-side guard.
  readonly rawObservation?: string;
}

export type ProfessionalLearningExtraction = Readonly<Partial<Record<ProfessionalLearningExtractionFieldName, ProfessionalLearningExtractedField>>>;

function isValidExtractedField(value: unknown): value is ProfessionalLearningExtractedField {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  if (!isProfessionalLearningProvenanceSource(record.source)) return false;
  // UNKNOWN MUST REMAIN UNKNOWN (this stage's absolute rule): a field
  // whose source is UNKNOWN must never carry a concrete value -- that
  // would be exactly the "fill missing information to look complete"
  // failure this stage forbids.
  if (record.source === "UNKNOWN" && record.value !== null && record.value !== undefined) return false;

  if (record.confidence !== undefined) {
    if (typeof record.confidence !== "number" || Number.isNaN(record.confidence) || record.confidence < 0 || record.confidence > 1) return false;
  }
  if (record.note !== undefined && typeof record.note !== "string") return false;
  if (record.segments !== undefined && !Array.isArray(record.segments)) return false;
  if (record.rawObservation !== undefined && typeof record.rawObservation !== "string") return false;

  return true;
}

// Strict, fail-closed structural validation of an untrusted extraction
// payload (Part 21) -- rejects an unknown field name (an invented enum
// value), a malformed field entry, or an UNKNOWN field smuggling a
// concrete value. Does NOT validate cross-references (evidence/skill
// IDs) -- that is the extraction-level validator's job
// (professional-learning-draft-extraction-validator.ts), since it needs
// database/registry context this pure function deliberately does not
// have.
export function isValidExtraction(value: unknown): value is ProfessionalLearningExtraction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!isProfessionalLearningExtractionFieldName(key)) return false;
    if (!isValidExtractedField(record[key])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Discernment-before-extraction outcome (Part 8/9) -- the relevance gate
// and the mock extractor both produce this shape before any structured
// extraction is persisted.
// ---------------------------------------------------------------------------

export interface ProfessionalLearningDiscernmentResult {
  readonly category: ProfessionalLearningDiscernmentCategory;
  readonly reason: string;
}
