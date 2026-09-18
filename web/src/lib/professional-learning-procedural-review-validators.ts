// AI Hair Architect, Professional Skill Engine Stage 8.5T1.4.b.1 --
// PROFESSIONAL PROCEDURAL REVIEW, pure domain types/validators. No I/O,
// no database, no provider call -- mirrors this repo's own established
// "validators file, separate from repository file" convention
// (professional-learning-draft-validators.ts / -repository.ts).
//
// THREE-LAYER AUTHORITY SEPARATION (the T1.4.b architecture audit's own
// central finding): LAYER 1 is professional-learning-video-temporal-
// evidence.ts's ProfessionalLearningTemporalEvidence (immutable,
// AI-observed). LAYER 2 is professional-learning-video-temporal-to-
// procedural-adapter.ts's ProceduralCandidate (derived fresh on every
// read, never persisted at all -- T1.4.a). LAYER 3 is THIS file's
// ProceduralReviewState -- the professional's own decision about a
// LAYER 2 claim, persisted separately, NEVER mutating LAYER 1 or LAYER
// 2. A correction's `correctedValue` sits ALONGSIDE `originalValue`
// (a snapshot of the LAYER 2 claim taken at review time), never
// replacing it -- see ProceduralClaimReviewEntry below.
//
// DECISION VOCABULARY: the first three values are the SAME literal
// strings as professional-knowledge-claim-binding.ts's own
// ClaimReviewConfirmationState (PROFESSIONALLY_CONFIRMED/_CORRECTED/
// _REJECTED) -- intentionally, for future vocabulary consistency --
// but this file does NOT import that module. That module's own
// construction pipeline (ApprovedKnowledgeSource/decomposeApprovedSource)
// is a different, dormant, window/reconciliation-keyed world (per the
// T1.4.b audit's own explicit finding); reusing its TYPE STRING LITERALS
// here creates zero coupling to its DORMANT runtime machinery.
// PROFESSIONALLY_UNKNOWN is new: a first-class, explicit "the available
// material/review does not establish the answer" decision -- distinct
// from REJECTED (the claim IS wrong) and from simply never having a
// claim entry at all (not yet reviewed).
export const PROCEDURAL_CLAIM_REVIEW_DECISIONS = [
  "PROFESSIONALLY_CONFIRMED",
  "PROFESSIONALLY_CORRECTED",
  "PROFESSIONALLY_REJECTED",
  "PROFESSIONALLY_UNKNOWN",
] as const;
export type ProceduralClaimReviewDecision = (typeof PROCEDURAL_CLAIM_REVIEW_DECISIONS)[number];

export function isProceduralClaimReviewDecision(value: unknown): value is ProceduralClaimReviewDecision {
  return typeof value === "string" && (PROCEDURAL_CLAIM_REVIEW_DECISIONS as readonly string[]).includes(value);
}

// Stage 8.5T1.4.b audit, Part 3/15/16 -- the ONLY reviewable claim type
// in this stage: one claim per repeated-kind pattern from T1.4.a's own
// ProceduralCandidate.repetitionByKind (e.g. "COMBING repeats 5x"),
// never per individual timestamp/action entry. `claimId` is simply the
// action `kind` string itself -- already a stable, deterministic key
// (repetitionByKind is keyed by kind), so no new hashing scheme is
// needed. `claimType` exists so a later, additional reviewable claim
// kind can never collide with this one on the same claimId string.
export const PROCEDURAL_CLAIM_TYPES = ["PROCEDURAL_PATTERN"] as const;
export type ProceduralClaimType = (typeof PROCEDURAL_CLAIM_TYPES)[number];

export function isProceduralClaimType(value: unknown): value is ProceduralClaimType {
  return typeof value === "string" && (PROCEDURAL_CLAIM_TYPES as readonly string[]).includes(value);
}

// A frozen snapshot of what T1.4.a's ProceduralCandidate.repetitionByKind
// actually said for this claim's own kind, taken at the moment of
// review -- never re-derived afterward, never mutated by a correction.
export interface ProceduralPatternClaimValue {
  readonly kind: string;
  readonly occurrenceCount: number;
}

export interface ProceduralClaimReviewEntry {
  readonly claimId: string;
  readonly claimType: ProceduralClaimType;
  readonly decision: ProceduralClaimReviewDecision;
  // LAYER 2 snapshot -- see file header. Always "INFERRED": T1.4.a's own
  // fixed authority for every repetition-pattern claim it produces.
  readonly originalValue: ProceduralPatternClaimValue;
  readonly originalProvenance: "INFERRED";
  // Present only for PROFESSIONALLY_CORRECTED. Free text (keyboard or
  // voice transcript, per the audit's Part 18 -- both reach this same
  // field identically; no voice-specific code exists or is needed
  // here). Never overwrites originalValue.
  readonly correctedValue?: string;
  readonly note?: string;
  // Stage 8.5T1.4.b audit, Part 2 -- ALWAYS server-session-derived by
  // the caller (professional-learning-procedural-review-service.ts /
  // the API route) -- this type has no way to distinguish a
  // client-supplied value from a server-derived one, so the caller
  // MUST NEVER construct this field from request-body input.
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
}

export interface ProceduralReviewState {
  readonly claims: Readonly<Record<string, ProceduralClaimReviewEntry>>;
}

function isValidPatternClaimValue(value: unknown): value is ProceduralPatternClaimValue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === "string" && record.kind.length > 0 && typeof record.occurrenceCount === "number" && Number.isFinite(record.occurrenceCount) && record.occurrenceCount >= 0;
}

function isValidClaimReviewEntry(value: unknown): value is ProceduralClaimReviewEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.claimId !== "string" || record.claimId.length === 0) return false;
  if (!isProceduralClaimType(record.claimType)) return false;
  if (!isProceduralClaimReviewDecision(record.decision)) return false;
  if (!isValidPatternClaimValue(record.originalValue)) return false;
  if (record.originalProvenance !== "INFERRED") return false;
  if (record.correctedValue !== undefined && typeof record.correctedValue !== "string") return false;
  if (record.note !== undefined && typeof record.note !== "string") return false;
  if (typeof record.reviewedByUserId !== "string" || record.reviewedByUserId.length === 0) return false;
  if (typeof record.reviewedAt !== "string") return false;
  return true;
}

// Defensive read-side check, mirroring professional-learning-video-
// temporal-evidence.ts's own isValidProfessionalLearningTemporalEvidence
// precedent exactly: a frozen Json payload is validated by a pure
// function, never trusted verbatim. An existing row with
// proceduralReview = null is NOT validated by this function at all --
// callers check for null/undefined first (see toRecord's own mapping).
export function isValidProceduralReviewState(value: unknown): value is ProceduralReviewState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.claims !== "object" || record.claims === null) return false;
  return Object.values(record.claims as Record<string, unknown>).every(isValidClaimReviewEntry);
}

// Idempotency support (Stage 8.5T1.4.b.1, "same exact decision submitted
// repeatedly must not create duplicate authority records" -- Part
// "IDEMPOTENCY"): compares only the AUTHORITY CONTENT of two entries,
// deliberately excluding reviewedAt (which legitimately differs by
// wall-clock time even for a genuine duplicate submission). Used to
// distinguish a harmless double-click/retry (safe no-op) from a
// genuinely conflicting concurrent decision (must fail closed).
export function isSameProceduralReviewDecision(a: ProceduralClaimReviewEntry, b: ProceduralClaimReviewEntry): boolean {
  return (
    a.claimId === b.claimId &&
    a.claimType === b.claimType &&
    a.decision === b.decision &&
    a.originalValue.kind === b.originalValue.kind &&
    a.originalValue.occurrenceCount === b.originalValue.occurrenceCount &&
    (a.correctedValue ?? null) === (b.correctedValue ?? null) &&
    (a.note ?? null) === (b.note ?? null) &&
    a.reviewedByUserId === b.reviewedByUserId
  );
}
