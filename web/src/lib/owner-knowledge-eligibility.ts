import { createHash } from "crypto";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { isValidReviewedProceduralKnowledgeEntry, REVIEWED_PROCEDURAL_PROJECTION_VERSION } from "@/lib/reviewed-procedural-knowledge-contracts";
import { TEMPORAL_TO_PROCEDURAL_BRIDGE_VERSION } from "@/lib/professional-learning-video-temporal-to-procedural-adapter";

export const OWNER_KNOWLEDGE_ELIGIBILITY_VERSION = "t1.6.1-eligibility-v1" as const;
// Read boundary only; the released review API and stored text are unchanged.
export const MAX_ELIGIBILITY_CORRECTED_VALUE_LENGTH = 2000;
export const OWNER_KNOWLEDGE_INELIGIBILITY_REASONS = Object.freeze([
  "OWNER_MISMATCH", "MALFORMED_KNOWLEDGE", "REVIEW_NOT_ELIGIBLE", "UNSUPPORTED_CLAIM_CLASS",
  "UNSUPPORTED_PROJECTION_VERSION", "CORRECTED_VALUE_TOO_LARGE", "CORRECTED_VALUE_MALFORMED",
  "GLOBAL_CONSTRAINT_CONFLICT", "CLAIM_CLASS_NOT_DECISION_RELEVANT", "SKILL_BINDING_MISSING", "CONTEXT_BINDING_MISSING",
] as const);
export type OwnerKnowledgeIneligibilityReason = (typeof OWNER_KNOWLEDGE_INELIGIBILITY_REASONS)[number];

export interface OwnerKnowledgeEligibilityContext {
  readonly ownerUserId: string;
  // Only a negative veto from the existing selector's explicit conflict
  // diagnostics. False is NOT evidence of compatibility or eligibility.
  readonly hasGlobalConstraintConflict: boolean;
}

export interface OwnerKnowledgeEligibilityResult {
  readonly ownerUserId: string;
  readonly resolverVersion: typeof OWNER_KNOWLEDGE_ELIGIBILITY_VERSION;
  // No class currently has a decision binding. There is intentionally no
  // constructible eligible/active result in this foundation slice.
  readonly status: "INELIGIBLE";
  readonly eligible: false;
  readonly reasons: readonly OwnerKnowledgeIneligibilityReason[];
  readonly reference: {
    readonly knowledgeId: string;
    readonly draftId: string;
    readonly sourceEvidenceId: string;
    readonly videoAssetId: string;
    readonly claimId: string;
    readonly sourceDecisionId: string;
    readonly proceduralReviewRevision: number;
    readonly reviewedByUserId: string;
    readonly reviewedAt: string;
    readonly projectionVersion: string;
    readonly bridgeVersion: string;
    readonly extractorVersion: string;
    readonly decision: "PROFESSIONALLY_CONFIRMED" | "PROFESSIONALLY_CORRECTED";
    readonly contentFingerprint: string;
  } | null;
}

// Pure: no listing, hidden registry, semantic mapping, prompt, or provider.
export function resolveOwnerKnowledgeEligibility(knowledge: unknown, context: OwnerKnowledgeEligibilityContext): OwnerKnowledgeEligibilityResult {
  if (!context.ownerUserId.trim() || typeof context.hasGlobalConstraintConflict !== "boolean") throw new TypeError("Invalid eligibility owner context.");
  const reasons = new Set<OwnerKnowledgeIneligibilityReason>();
  let reference: OwnerKnowledgeEligibilityResult["reference"] = null;
  const finish = (): OwnerKnowledgeEligibilityResult => ({
    ownerUserId: context.ownerUserId, resolverVersion: OWNER_KNOWLEDGE_ELIGIBILITY_VERSION, status: "INELIGIBLE", eligible: false,
    reasons: OWNER_KNOWLEDGE_INELIGIBILITY_REASONS.filter(reason => reasons.has(reason)), reference,
  });
  if (!isRecord(knowledge)) { reasons.add("MALFORMED_KNOWLEDGE"); return finish(); }
  // Never echo another owner's identifiers, values, or provenance.
  if (knowledge.ownerUserId !== context.ownerUserId) { reasons.add("OWNER_MISMATCH"); return finish(); }
  if (context.hasGlobalConstraintConflict) reasons.add("GLOBAL_CONSTRAINT_CONFLICT");
  if (isRecord(knowledge.provenance) && (knowledge.provenance.projectionVersion !== REVIEWED_PROCEDURAL_PROJECTION_VERSION || knowledge.provenance.bridgeVersion !== TEMPORAL_TO_PROCEDURAL_BRIDGE_VERSION)) reasons.add("UNSUPPORTED_PROJECTION_VERSION");
  if (knowledge.kind !== "REVIEWED_PROCEDURAL_CLAIM" || (isRecord(knowledge.payload) && knowledge.payload.claimType !== "PROCEDURAL_PATTERN")) reasons.add("UNSUPPORTED_CLAIM_CLASS");
  if (knowledge.status !== "APPROVED_BUT_UNATTACHED" || (isRecord(knowledge.payload) && !["PROFESSIONALLY_CONFIRMED", "PROFESSIONALLY_CORRECTED"].includes(String(knowledge.payload.decision)))) reasons.add("REVIEW_NOT_ELIGIBLE");
  if (!isValidReviewedProceduralKnowledgeEntry(knowledge)) { reasons.add("MALFORMED_KNOWLEDGE"); return finish(); }
  const p = knowledge.provenance;
  if (knowledge.payload.decision === "PROFESSIONALLY_CORRECTED") {
    if (knowledge.payload.value.length > MAX_ELIGIBILITY_CORRECTED_VALUE_LENGTH) reasons.add("CORRECTED_VALUE_TOO_LARGE");
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uD800-\uDFFF]/u.test(knowledge.payload.value)) reasons.add("CORRECTED_VALUE_MALFORMED");
  }
  // This explicit whitelist includes no raw professional text. A content
  // digest distinguishes changed corrections without carrying them forward.
  const contentFingerprint = createHash("sha256").update(JSON.stringify({
    kind: knowledge.kind, scope: knowledge.scope, vertical: knowledge.vertical,
    decision: knowledge.payload.decision, claimId: knowledge.payload.claimId,
    value: knowledge.payload.decision === "PROFESSIONALLY_CORRECTED" ? knowledge.payload.value : { kind: knowledge.payload.value.kind, occurrenceCount: knowledge.payload.value.occurrenceCount },
    originalAIClaim: { value: { kind: p.originalAIClaim.value.kind, occurrenceCount: p.originalAIClaim.value.occurrenceCount }, provenance: "INFERRED" },
  }), "utf8").digest("hex");
  reference = {
    knowledgeId: knowledge.id, draftId: p.draftId, sourceEvidenceId: p.sourceEvidenceId, videoAssetId: p.videoAssetId,
    claimId: p.claimId, sourceDecisionId: p.sourceDecisionId, proceduralReviewRevision: p.proceduralReviewRevision,
    reviewedByUserId: p.reviewedByUserId, reviewedAt: p.reviewedAt, projectionVersion: p.projectionVersion,
    bridgeVersion: p.bridgeVersion, extractorVersion: p.extractorVersion, decision: knowledge.payload.decision, contentFingerprint,
  };
  // Even a correction that sounds like a skill/parameter remains ONLY_THIS_CLAIM.
  // Extra fields claiming bindings are never consulted or promoted.
  reasons.add("CLAIM_CLASS_NOT_DECISION_RELEVANT");
  reasons.add("SKILL_BINDING_MISSING");
  reasons.add("CONTEXT_BINDING_MISSING");
  return finish();
}
