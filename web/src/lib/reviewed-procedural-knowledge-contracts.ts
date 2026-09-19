import type { ProfessionalKnowledgeProvenance } from "@/lib/professional-knowledge-entry-contracts";
import type { ProceduralPatternClaimValue } from "@/lib/professional-learning-procedural-review-validators";
import { isRecord } from "@/lib/technical-visual-map-validators";

export const REVIEWED_PROCEDURAL_PROJECTION_VERSION = "t1.5-projection-v1";

export interface ReviewedProceduralProvenance extends ProfessionalKnowledgeProvenance {
  readonly originalAIClaim: { readonly value: ProceduralPatternClaimValue; readonly provenance: "INFERRED" };
  readonly decisionType: "CONFIRMATION" | "CORRECTION";
  // No procedural decision row/id exists. sourceDecisionId is the canonical
  // JSON tuple [draftId, claimId, revision], referencing the existing JSON slot.
  readonly draftId: string;
  readonly sourceEvidenceId: string;
  readonly videoAssetId: string;
  readonly claimId: string;
  readonly proceduralReviewRevision: number;
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
  readonly extractorVersion: string;
  readonly bridgeVersion: string;
  readonly projectionVersion: typeof REVIEWED_PROCEDURAL_PROJECTION_VERSION;
}

export interface ReviewedProceduralKnowledgeEntry {
  readonly id: string;
  readonly kind: "REVIEWED_PROCEDURAL_CLAIM";
  readonly status: "APPROVED_BUT_UNATTACHED";
  readonly scope: "ONLY_THIS_CLAIM";
  readonly ownerUserId: string;
  readonly vertical: string;
  readonly createdAt: string;
  readonly provenance: ReviewedProceduralProvenance;
  readonly payload:
    | { readonly claimId: string; readonly claimType: "PROCEDURAL_PATTERN"; readonly decision: "PROFESSIONALLY_CONFIRMED"; readonly value: ProceduralPatternClaimValue }
    | { readonly claimId: string; readonly claimType: "PROCEDURAL_PATTERN"; readonly decision: "PROFESSIONALLY_CORRECTED"; readonly value: string };
}

export interface ReviewedProceduralKnowledgeProjection {
  readonly ownerUserId: string;
  readonly draftId: string;
  readonly sourceEvidenceId: string;
  readonly videoAssetId: string;
  readonly proceduralReviewRevision: number;
  readonly projectionVersion: typeof REVIEWED_PROCEDURAL_PROJECTION_VERSION;
  readonly bridgeVersion: string;
  readonly reviewState: "MISSING" | "PRESENT";
  readonly entries: readonly ReviewedProceduralKnowledgeEntry[];
  readonly professionallyUndetermined: readonly {
    readonly claimId: string;
    readonly claimType: "PROCEDURAL_PATTERN";
    readonly decision: "PROFESSIONALLY_UNKNOWN";
    readonly originalValue: ProceduralPatternClaimValue;
    readonly originalProvenance: "INFERRED";
    readonly reviewedByUserId: string;
    readonly reviewedAt: string;
  }[];
  readonly unreviewedClaimIds: readonly string[];
}

const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const timestamp = (v: unknown): v is string => nonempty(v) && Number.isFinite(Date.parse(v));
const pattern = (v: unknown): v is ProceduralPatternClaimValue => isRecord(v) && nonempty(v.kind) && Number.isSafeInteger(v.occurrenceCount) && Number(v.occurrenceCount) > 0;

export function isValidReviewedProceduralKnowledgeEntry(value: unknown): value is ReviewedProceduralKnowledgeEntry {
  if (!isRecord(value) || value.kind !== "REVIEWED_PROCEDURAL_CLAIM" || value.status !== "APPROVED_BUT_UNATTACHED" || value.scope !== "ONLY_THIS_CLAIM") return false;
  if (!nonempty(value.id) || !nonempty(value.ownerUserId) || !nonempty(value.vertical) || !timestamp(value.createdAt)) return false;
  const p = value.provenance;
  const claim = value.payload;
  if (!isRecord(p) || !isRecord(claim) || !isRecord(p.originalAIClaim) || !pattern(p.originalAIClaim.value) || p.originalAIClaim.provenance !== "INFERRED") return false;
  if (p.professionalAuthority !== "PROFESSIONAL_INPUT" || p.reviewedByUserId !== value.ownerUserId || !timestamp(p.reviewedAt) || p.reviewedAt !== value.createdAt) return false;
  if (![p.draftId, p.sourceEvidenceId, p.videoAssetId, p.claimId, p.extractorVersion, p.bridgeVersion].every(nonempty)) return false;
  if (!Number.isSafeInteger(p.proceduralReviewRevision) || Number(p.proceduralReviewRevision) < 1 || Number(p.proceduralReviewRevision) > 2_147_483_647) return false;
  if (p.projectionVersion !== REVIEWED_PROCEDURAL_PROJECTION_VERSION || p.sourceDecisionId !== JSON.stringify([p.draftId, p.claimId, p.proceduralReviewRevision])) return false;
  if (claim.claimType !== "PROCEDURAL_PATTERN" || claim.claimId !== p.claimId || p.originalAIClaim.value.kind !== p.claimId) return false;
  if (claim.decision === "PROFESSIONALLY_CORRECTED") return p.decisionType === "CORRECTION" && nonempty(claim.value);
  return claim.decision === "PROFESSIONALLY_CONFIRMED" && p.decisionType === "CONFIRMATION" && pattern(claim.value) && claim.value.kind === p.originalAIClaim.value.kind && claim.value.occurrenceCount === p.originalAIClaim.value.occurrenceCount;
}
