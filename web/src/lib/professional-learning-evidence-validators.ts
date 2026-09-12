// AI Hair Architect, Professional Skill Engine Stage 8.5L2 -- PROFESSIONAL
// LEARNING EVIDENCE, pure domain validators. No I/O, no database, no
// provider call -- mirrors this repo's own established "validators file,
// separate from repository file" convention (capture-set-validators.ts /
// capture-set-repository.ts, hair-state-snapshot-evidence-validators.ts /
// hair-state-snapshot-repository.ts).
//
// ARCHITECTURAL LOCK (Stage 8.5L2): this file validates EVIDENCE shape
// only -- raw professional teaching material. It contains ZERO technique
// classification, ZERO image/video analysis, ZERO comparison against the
// Skill Registry, and proposes NO ProfessionalLearningDraft. Turning
// evidence into professional knowledge is explicitly out of scope for
// this stage (Stage 8.5L2 Part 15).
//
// EXACTLY-ONE-ASSET-POINTER RULE mirrors HairStateSnapshotEvidence's own
// "evidenceKind decides which single pointer may be set" pattern, both at
// this pure-validator layer AND as a DB-level CHECK constraint
// (ProfessionalLearningEvidence_evidence_pointer_check, see this stage's
// migration) -- never by convention alone.

export const PROFESSIONAL_LEARNING_EVIDENCE_TYPES = [
  "TEXT",
  "VOICE_TRANSCRIPT",
  "IMAGE",
  "IMAGE_SET",
  "DIAGRAM",
  "VIDEO",
  "EXTERNAL_RESEARCH",
  "MANUFACTURER_SOURCE",
  "TREND_SOURCE",
] as const;
export type ProfessionalLearningEvidenceType = (typeof PROFESSIONAL_LEARNING_EVIDENCE_TYPES)[number];

export function isProfessionalLearningEvidenceType(value: unknown): value is ProfessionalLearningEvidenceType {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_EVIDENCE_TYPES as readonly string[]).includes(value);
}

// Future-capable only in this stage (Stage 8.5L2 Part 2/Part 17): no
// online-research, manufacturer-catalog, or trend-signal functionality
// exists yet. A row of one of these three types can only ever carry text
// and/or sourceMetadata, never an asset pointer -- see
// EVIDENCE_TYPES_WITH_NO_ASSET_POINTER below.
export const FUTURE_CAPABLE_ONLY_EVIDENCE_TYPES = ["EXTERNAL_RESEARCH", "MANUFACTURER_SOURCE", "TREND_SOURCE"] as const;

// Currently exactly one real value -- see model header in schema.prisma
// (Stage 8.5L2 Part 4: "impossible to accidentally interpret this as
// public content"). Deliberately a closed array of one, not a boolean,
// so a future second scope is an additive value here, never a schema
// rewrite.
export const PROFESSIONAL_LEARNING_EVIDENCE_VISIBILITY_SCOPES = ["PRIVATE_LEARNING_EVIDENCE"] as const;
export type ProfessionalLearningEvidenceVisibilityScope = (typeof PROFESSIONAL_LEARNING_EVIDENCE_VISIBILITY_SCOPES)[number];

export function isProfessionalLearningEvidenceVisibilityScope(value: unknown): value is ProfessionalLearningEvidenceVisibilityScope {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_EVIDENCE_VISIBILITY_SCOPES as readonly string[]).includes(value);
}

// EVIDENCE availability/authority lifecycle only -- never a professional-
// knowledge approval workflow (Stage 8.5L2 Part 14). REVOKE and
// DELETE_SOURCE are independent events (Stage 8.5L2 Part 10); a row can
// reach DELETED_SOURCE without ever having been REVOKED, and vice versa.
export const PROFESSIONAL_LEARNING_EVIDENCE_STATUSES = ["ACTIVE", "REVOKED", "DELETED_SOURCE"] as const;
export type ProfessionalLearningEvidenceStatus = (typeof PROFESSIONAL_LEARNING_EVIDENCE_STATUSES)[number];

export function isProfessionalLearningEvidenceStatus(value: unknown): value is ProfessionalLearningEvidenceStatus {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_EVIDENCE_STATUSES as readonly string[]).includes(value);
}

// Minimal rights/provenance distinction (Stage 8.5L2 Part 17) -- NOT a
// copyright enforcement engine, only enough to know origin/handling
// expectations for a future online-research/private-learning flow. No
// default is ever applied at the repository layer -- see that file's own
// reasoning.
export const PROFESSIONAL_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATIONS = ["USER_OWNED_OR_AUTHORIZED", "EXTERNAL_REFERENCE", "UNKNOWN"] as const;
export type ProfessionalLearningEvidenceRightsClassification = (typeof PROFESSIONAL_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATIONS)[number];

export function isProfessionalLearningEvidenceRightsClassification(value: unknown): value is ProfessionalLearningEvidenceRightsClassification {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATIONS as readonly string[]).includes(value);
}

export const ORIGINAL_TEXT_MAX_LENGTH = 4000;
export const TITLE_MAX_LENGTH = 200;

export type ProfessionalLearningEvidenceAssetPointerKind = "imageAssetId" | "captureSetId" | "videoAssetId" | null;

// The single source of truth for which pointer (if any) an evidenceType
// requires -- both the pure validator below AND the migration's own
// CHECK constraint implement exactly this mapping; keep them in sync by
// construction, never by re-deriving the rule twice.
export function requiredAssetPointerKindForEvidenceType(evidenceType: ProfessionalLearningEvidenceType): ProfessionalLearningEvidenceAssetPointerKind {
  switch (evidenceType) {
    case "IMAGE":
    case "DIAGRAM":
      return "imageAssetId";
    case "IMAGE_SET":
      return "captureSetId";
    case "VIDEO":
      return "videoAssetId";
    case "TEXT":
    case "VOICE_TRANSCRIPT":
    case "EXTERNAL_RESEARCH":
    case "MANUFACTURER_SOURCE":
    case "TREND_SOURCE":
      return null;
  }
}

export interface ProfessionalLearningEvidenceAssetPointers {
  readonly imageAssetId?: string | null;
  readonly captureSetId?: string | null;
  readonly videoAssetId?: string | null;
}

// Pure re-implementation of ProfessionalLearningEvidence_evidence_pointer_check
// -- exactly the required pointer is a non-empty string, and both other
// pointers are absent/null. Deliberately checked here too (not only left
// to the DB) so a caller gets a clear, typed rejection before any write
// is attempted.
export function isValidEvidenceAssetPointerCombination(
  evidenceType: ProfessionalLearningEvidenceType,
  pointers: ProfessionalLearningEvidenceAssetPointers,
): boolean {
  const required = requiredAssetPointerKindForEvidenceType(evidenceType);
  const kinds: readonly (keyof ProfessionalLearningEvidenceAssetPointers)[] = ["imageAssetId", "captureSetId", "videoAssetId"];

  for (const kind of kinds) {
    const value = pointers[kind];
    const isSet = typeof value === "string" && value.length > 0;
    if (kind === required && !isSet) return false;
    if (kind !== required && isSet) return false;
  }
  return true;
}

export interface CreateProfessionalLearningEvidenceInput {
  readonly evidenceType: ProfessionalLearningEvidenceType;
  readonly vertical: string;
  readonly title?: string | null;
  readonly originalText?: string | null;
  readonly imageAssetId?: string | null;
  readonly captureSetId?: string | null;
  readonly videoAssetId?: string | null;
  readonly provenance: Record<string, unknown>;
  readonly sourceMetadata?: Record<string, unknown> | null;
  readonly rightsClassification: ProfessionalLearningEvidenceRightsClassification;
}

// Structural validation only -- ownership, ImageAsset/CaptureSet/VideoAsset
// existence, and cross-user reference checks happen inside the repository
// layer's own transaction (Stage 8.5L2 Part 5/21), never here.
export function isValidCreateProfessionalLearningEvidenceInput(value: unknown): value is CreateProfessionalLearningEvidenceInput {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;

  if (!isProfessionalLearningEvidenceType(record.evidenceType)) return false;
  if (typeof record.vertical !== "string" || record.vertical.length === 0) return false;
  if (!isProfessionalLearningEvidenceRightsClassification(record.rightsClassification)) return false;

  if (record.title !== undefined && record.title !== null) {
    if (typeof record.title !== "string" || record.title.length === 0 || record.title.length > TITLE_MAX_LENGTH) return false;
  }

  if (record.originalText !== undefined && record.originalText !== null) {
    if (typeof record.originalText !== "string" || record.originalText.length > ORIGINAL_TEXT_MAX_LENGTH) return false;
  }

  const evidenceType = record.evidenceType;
  if (evidenceType === "TEXT" || evidenceType === "VOICE_TRANSCRIPT") {
    if (typeof record.originalText !== "string" || record.originalText.length === 0) return false;
  }

  if (
    !isValidEvidenceAssetPointerCombination(evidenceType, {
      imageAssetId: record.imageAssetId as string | null | undefined,
      captureSetId: record.captureSetId as string | null | undefined,
      videoAssetId: record.videoAssetId as string | null | undefined,
    })
  ) {
    return false;
  }

  if (typeof record.provenance !== "object" || record.provenance === null || Array.isArray(record.provenance)) return false;

  if (record.sourceMetadata !== undefined && record.sourceMetadata !== null) {
    if (typeof record.sourceMetadata !== "object" || Array.isArray(record.sourceMetadata)) return false;
  }

  return true;
}
