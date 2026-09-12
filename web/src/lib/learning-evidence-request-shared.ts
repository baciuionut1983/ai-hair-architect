import type { ProfessionalLearningEvidenceRightsClassification } from "@/lib/professional-learning-evidence-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L3 -- shared,
// pure request-shaping helpers used by every /learning-evidence route, so
// the 4 ingestion routes (text/voice-transcript, image, image-set, video)
// resolve domain/title/rights identically rather than drifting into 4
// slightly different conventions.

export const MAX_LEARNING_EVIDENCE_TITLE_LENGTH = 200;

// Task Part 14: "If user does not know or does not choose: use
// UNKNOWN/UNSPECIFIED only if existing domain model supports it
// honestly." vertical (professional-learning-evidence-validators.ts) is
// an open, non-empty string with no closed vocabulary -- "unspecified" is
// a real, honest value under that model, never a fabricated domain
// guess. Never inferred with AI (Part 14's own explicit prohibition).
export const UNSPECIFIED_LEARNING_EVIDENCE_VERTICAL = "unspecified";

// Task Part 17 asks for optional title/description only -- it does not
// ask for a rights-classification UI control. Every ingestion path in
// this stage is the professional personally typing, recording, or
// uploading their OWN material through their own authenticated session --
// USER_OWNED_OR_AUTHORIZED is the honest default for that act, not a
// permissive guess about someone else's content. A future stage that
// lets a professional attach genuinely external material (Part 17's
// EXTERNAL_REFERENCE/UNKNOWN classifications) can add that control then.
export const DEFAULT_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATION: ProfessionalLearningEvidenceRightsClassification = "USER_OWNED_OR_AUTHORIZED";

export function resolveLearningEvidenceVertical(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, 100);
  }
  return UNSPECIFIED_LEARNING_EVIDENCE_VERTICAL;
}

export function resolveLearningEvidenceTitle(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, MAX_LEARNING_EVIDENCE_TITLE_LENGTH);
  }
  return null;
}

export function resolveSubmissionId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 100) : undefined;
}
