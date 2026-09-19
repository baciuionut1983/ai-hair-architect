import { createHash } from "crypto";
import { OWNER_KNOWLEDGE_ELIGIBILITY_VERSION, OWNER_KNOWLEDGE_INELIGIBILITY_REASONS, type OwnerKnowledgeEligibilityResult } from "@/lib/owner-knowledge-eligibility";

export interface SealedOwnerKnowledgeEligibilitySection {
  readonly ownerUserId: string;
  readonly resolverVersion: typeof OWNER_KNOWLEDGE_ELIGIBILITY_VERSION;
  readonly evaluations: readonly OwnerKnowledgeEligibilityResult[];
}
export interface OwnerKnowledgeEligibilityPackageExtension {
  readonly knowledgeEligibility?: SealedOwnerKnowledgeEligibilitySection;
  readonly requestFingerprint?: string;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// The package's provider context stays byte-identical. Eligibility lives in
// a sibling section, never ProfessionalReasoningContext or its fingerprint.
// With no evaluations, even the new property names are absent from JSON.
export function sealOwnerKnowledgeEligibility<T extends { context: { contextFingerprint: string } }>(base: T, ownerUserId: string, evaluations: readonly OwnerKnowledgeEligibilityResult[]): T & OwnerKnowledgeEligibilityPackageExtension {
  if (!ownerUserId.trim()) throw new TypeError("Missing eligibility owner.");
  if (evaluations.length === 0) return base;
  const canonical = evaluations.map(result => {
    if (result.ownerUserId !== ownerUserId || (result.reference !== null && result.reference.reviewedByUserId !== ownerUserId) || result.resolverVersion !== OWNER_KNOWLEDGE_ELIGIBILITY_VERSION
      || result.status !== "INELIGIBLE" || result.eligible !== false || result.reasons.length === 0 || result.reasons.some(reason => !OWNER_KNOWLEDGE_INELIGIBILITY_REASONS.includes(reason))) throw new TypeError("Invalid eligibility section.");
    // Explicit reconstruction, not JSON-spreading untrusted extra fields.
    const p = result.reference;
    return {
      ownerUserId, resolverVersion: OWNER_KNOWLEDGE_ELIGIBILITY_VERSION, status: "INELIGIBLE" as const, eligible: false as const,
      reasons: OWNER_KNOWLEDGE_INELIGIBILITY_REASONS.filter(reason => result.reasons.includes(reason)),
      reference: p ? {
        knowledgeId: p.knowledgeId, draftId: p.draftId, sourceEvidenceId: p.sourceEvidenceId, videoAssetId: p.videoAssetId, claimId: p.claimId,
        sourceDecisionId: p.sourceDecisionId, proceduralReviewRevision: p.proceduralReviewRevision, reviewedByUserId: p.reviewedByUserId, reviewedAt: p.reviewedAt,
        projectionVersion: p.projectionVersion, bridgeVersion: p.bridgeVersion, extractorVersion: p.extractorVersion, decision: p.decision, contentFingerprint: p.contentFingerprint,
      } : null,
    };
  }).sort((a, b) => { const left = JSON.stringify(a); const right = JSON.stringify(b); return left < right ? -1 : left > right ? 1 : 0; });
  const unique = canonical.filter((result, index) => index === 0 || JSON.stringify(result) !== JSON.stringify(canonical[index - 1]));
  const knowledgeEligibility = freeze({ ownerUserId, resolverVersion: OWNER_KNOWLEDGE_ELIGIBILITY_VERSION, evaluations: unique });
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ contextFingerprint: base.context.contextFingerprint, knowledgeEligibility }), "utf8").digest("hex");
  return Object.freeze({ ...base, knowledgeEligibility, requestFingerprint });
}

// Legacy requests retain exactly the existing fingerprint. This helper does
// not participate in proposal lookup, provider invocation, or persistence.
export function reasoningRequestPackageFingerprint(pkg: { context: { contextFingerprint: string } } & OwnerKnowledgeEligibilityPackageExtension): string {
  return pkg.requestFingerprint ?? pkg.context.contextFingerprint;
}
