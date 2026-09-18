import type { ProfessionalLearningDraftRecord } from "@/lib/professional-learning-draft-repository";
import { buildProceduralInterpretation } from "@/lib/professional-learning-video-temporal-to-procedural-adapter";

// One server-only projection for both reads and review validation. No I/O,
// extraction, or professional authority is introduced by this hydration.
export function hydrateProceduralDraft(draft: ProfessionalLearningDraftRecord) {
  const proceduralInterpretation = buildProceduralInterpretation(draft.id, draft.temporalEvidence);
  const reviewableProceduralClaims = Object.entries(proceduralInterpretation?.repetitionByKind ?? {}).map(([claimId, repetition]) => ({
    claimId,
    claimType: "PROCEDURAL_PATTERN" as const,
    originalValue: { kind: claimId, occurrenceCount: repetition.occurrenceActionCandidateIds.length },
    originalProvenance: "INFERRED" as const,
  }));
  return { ...draft, proceduralInterpretation, reviewableProceduralClaims };
}

// PostgreSQL/Prisma Int is signed 32-bit. Leave room for one increment.
export function isExpectedProceduralReviewRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 2_147_483_647;
}
