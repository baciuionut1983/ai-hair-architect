// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- PROFESSIONAL
// REVIEW OF BLIND LONG-VIDEO EXTRACTION, pure domain validators. No I/O, no
// database, no provider call -- mirrors this repo's own established
// "validators file, separate from repository file" convention
// (professional-learning-draft-validators.ts /
// professional-learning-draft-repository.ts).
//
// See professional-learning-review-repository.ts / the ProfessionalLearningReview
// Prisma model header for why this is a SEPARATE model from
// ProfessionalLearningDraft rather than another draft row: a draft's
// `extraction` uses a closed, single-technique-shaped field vocabulary
// (professional-learning-draft-validators.ts#PROFESSIONAL_LEARNING_EXTRACTION_FIELD_NAMES),
// and a whole-procedure professional review of a genuinely compound,
// multi-phase result does not fit that shape without forcing exactly the
// single-technique template this engagement forbids.

export const PROFESSIONAL_LEARNING_REVIEW_STATUSES = ["PROFESSIONALLY_VALIDATED"] as const;
export type ProfessionalLearningReviewStatus = (typeof PROFESSIONAL_LEARNING_REVIEW_STATUSES)[number];

export function isProfessionalLearningReviewStatus(value: unknown): value is ProfessionalLearningReviewStatus {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_REVIEW_STATUSES as readonly string[]).includes(value);
}

// A confirmed theme is a short, professional-authored label for one
// distinguishable aspect of the reviewed procedure that the reviewer
// stated was accurate (e.g. "progressive_elevation", "stationary_guide").
// Deliberately a free string, not the draft's closed field-name
// vocabulary -- see file header: this review may confirm several
// per-window findings that would collide if forced into one flat
// field-name map (e.g. a mobile guide in one window and a stationary
// guide in another cannot both be the draft's single `guideType` value).
export interface ProfessionalLearningReviewApprovalDetail {
  readonly provenance: "PROFESSIONAL_INPUT";
  readonly confirmedThemes: readonly string[];
  readonly reviewerNote: string;
  // Explicit, directly-queryable negative assertions -- this approval, by
  // itself, changes none of these things (Ionuț's own instructions: keep
  // the blind result unchanged, do not remove existing UNKNOWNs on the
  // strength of this general approval alone, do not touch the registry,
  // do not create/activate skills).
  readonly fieldsChanged: false;
  readonly unknownsRemoved: false;
  readonly registryMutated: false;
  readonly skillsCreated: false;
  // Falsification claim: the reviewer explicitly did not find any false
  // technical statement or invented action in the reviewed material.
  readonly falseStatementsFound: false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidApprovalDetail(value: unknown): value is ProfessionalLearningReviewApprovalDetail {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  if (record.provenance !== "PROFESSIONAL_INPUT") return false;
  if (!Array.isArray(record.confirmedThemes) || record.confirmedThemes.length === 0) return false;
  if (!record.confirmedThemes.every((theme) => isNonEmptyString(theme))) return false;
  if (!isNonEmptyString(record.reviewerNote)) return false;
  if (record.fieldsChanged !== false) return false;
  if (record.unknownsRemoved !== false) return false;
  if (record.registryMutated !== false) return false;
  if (record.skillsCreated !== false) return false;
  if (record.falseStatementsFound !== false) return false;

  return true;
}

export function isValidApprovedResultHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
