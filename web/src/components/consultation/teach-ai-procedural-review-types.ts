import type { ProceduralReviewState, ProceduralPatternClaimValue } from '@/lib/professional-learning-procedural-review-validators';

export interface ReviewableClaim {
  readonly claimId: string;
  readonly claimType: 'PROCEDURAL_PATTERN';
  readonly originalValue: ProceduralPatternClaimValue;
  readonly originalProvenance: 'INFERRED';
}

interface DraftExtractionEntry {
  readonly value: unknown;
  readonly source: string;
  // Stage 8.5L4.R2.2, Part 17 -- present only when the semantic-binding
  // guard downgraded a claim to UNKNOWN while preserving what was
  // actually observed; see formatExtractionForDisplay.
  readonly rawObservation?: string;
}

// T1.2 -- TEMPORAL OBSERVATION PRESERVATION. Mirrors professional-
// learning-video-temporal-evidence.ts's own persisted shape exactly --
// this is EVIDENCE, never the reviewable professional summary above,
// and never professional truth on its own.
interface DraftTemporalEvidence {
  readonly observations?: readonly { readonly timeStartSeconds: number; readonly timeEndSeconds: number; readonly observation: string; readonly source: string }[];
  readonly actions?: readonly { readonly timeStartSeconds: number; readonly timeEndSeconds: number; readonly kind: string; readonly source: string }[];
  readonly editGaps?: readonly { readonly beforeTimeSeconds: number; readonly afterTimeSeconds: number; readonly source: string }[];
}

// T1.4.a -- TEMPORAL EVIDENCE -> PROCEDURAL INTERPRETATION. Mirrors the
// server's ProceduralCandidate JSON shape exactly (professional-
// learning-video-procedural-candidate.ts) -- computed at response time
// only, never persisted, never professional truth on its own. Absent
// (null) whenever the server found nothing derivable.
interface DraftProceduralInterpretation {
  readonly orderedActions: readonly {
    readonly action: { readonly kind: string };
    readonly absoluteInterval: { readonly timeStartSeconds: number; readonly timeEndSeconds: number };
    readonly precedingTransition: string;
  }[];
  readonly repetitionByKind: Readonly<Record<string, { readonly occurrenceActionCandidateIds: readonly string[] }>>;
  readonly zoneCompletionByKind: Readonly<Record<string, string>>;
  readonly coreChainSummary: Readonly<Record<string, string>>;
}

export interface LearningDraft {
  readonly id: string;
  readonly status: string;
  readonly discernmentCategory: string;
  readonly comparisonOutcome: string;
  readonly comparedSkillId: string | null;
  readonly extraction: Record<string, DraftExtractionEntry | undefined>;
  readonly temporalEvidence: DraftTemporalEvidence | null;
  readonly proceduralInterpretation: DraftProceduralInterpretation | null;
  readonly reviewableProceduralClaims: readonly ReviewableClaim[];
  readonly proceduralReview: ProceduralReviewState | null;
  readonly proceduralReviewRevision: number;
  readonly conflictDetail: { readonly existingClaim: string; readonly newClaim: string; readonly reason: string } | null;
}
