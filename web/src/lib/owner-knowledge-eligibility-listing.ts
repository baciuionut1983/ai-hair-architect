import { prisma } from "@/lib/prisma";
import { readReviewedProceduralKnowledge, ReviewedProceduralKnowledgeReadError } from "@/lib/reviewed-procedural-knowledge-service";
import { resolveOwnerKnowledgeEligibility, type OwnerKnowledgeEligibilityContext, type OwnerKnowledgeEligibilityResult } from "@/lib/owner-knowledge-eligibility";

export class OwnerKnowledgeEligibilityListingError extends Error {
  constructor(readonly code: "KNOWLEDGE_LISTING_LIMIT_EXCEEDED" | "KNOWLEDGE_LISTING_CHANGED" | "KNOWLEDGE_OWNER_MISMATCH") { super(code); }
}

// Bound work without silently truncating private knowledge or reusing cache.
export const MAX_ELIGIBILITY_DRAFTS = 100;
const MAX_ELIGIBILITY_ENTRIES = 1000;
async function listDraftVersions(ownerUserId: string) {
  return prisma.professionalLearningDraft.findMany({
    where: { ownerUserId, status: "APPROVED", supersededByDraftId: null },
    select: { id: true, sourceEvidenceId: true, proceduralReviewRevision: true, updatedAt: true },
    orderBy: { id: "asc" }, take: MAX_ELIGIBILITY_DRAFTS + 1,
  });
}

// Sole production caller: the owner-authorized orchestrator preparation point.
// The T1.5 read service remains the authority for every source-chain check.
export async function listOwnerKnowledgeEligibility(context: OwnerKnowledgeEligibilityContext): Promise<readonly OwnerKnowledgeEligibilityResult[]> {
  if (!context.ownerUserId.trim()) throw new OwnerKnowledgeEligibilityListingError("KNOWLEDGE_OWNER_MISMATCH");
  const initial = await listDraftVersions(context.ownerUserId);
  if (initial.length > MAX_ELIGIBILITY_DRAFTS) throw new OwnerKnowledgeEligibilityListingError("KNOWLEDGE_LISTING_LIMIT_EXCEEDED");
  const results: OwnerKnowledgeEligibilityResult[] = [];
  for (const draft of initial) {
    try {
      const projection = await readReviewedProceduralKnowledge(context.ownerUserId, draft.id);
      if (projection.ownerUserId !== context.ownerUserId) throw new OwnerKnowledgeEligibilityListingError("KNOWLEDGE_OWNER_MISMATCH");
      for (const entry of projection.entries) {
        if (entry.ownerUserId !== context.ownerUserId) throw new OwnerKnowledgeEligibilityListingError("KNOWLEDGE_OWNER_MISMATCH");
        results.push(resolveOwnerKnowledgeEligibility(entry, context));
        if (results.length > MAX_ELIGIBILITY_ENTRIES) throw new OwnerKnowledgeEligibilityListingError("KNOWLEDGE_LISTING_LIMIT_EXCEEDED");
      }
    } catch (error) {
      // Invalid/revoked/missing sources supply no usable knowledge. Operational
      // failures must propagate, never masquerade as an empty knowledge set.
      if (error instanceof ReviewedProceduralKnowledgeReadError && (error.httpStatus === 404 || error.httpStatus === 409)) continue;
      throw error;
    }
  }
  const current = await listDraftVersions(context.ownerUserId);
  if (JSON.stringify(initial) !== JSON.stringify(current)) throw new OwnerKnowledgeEligibilityListingError("KNOWLEDGE_LISTING_CHANGED");
  return results;
}
