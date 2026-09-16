import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { withL5R3AcceptanceFixture } from "../../tests/l5r3-acceptance-db-fixture";
import { verifyApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import { decomposeApprovedSource } from "@/lib/professional-knowledge-decomposition";
import { bindClaimsForApprovedSource } from "@/lib/professional-knowledge-claim-binding";
import { buildKnowledgeAssimilationProposal } from "@/lib/professional-knowledge-assimilation-proposal";
import { L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID, L5R2_REAL_WINDOW_PLAN } from "@/lib/professional-learning-video-l5r2-real-fixture";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.1 -- THE
// FIRST REAL PROFESSIONALLY VALIDATED CLAIM BINDING ACCEPTANCE. Real
// Postgres reads only (the real L5.R2 evidence + the real
// ProfessionalLearningReview row, including its real confirmedThemes) --
// ZERO AI calls, ZERO video access, ZERO network. Reuses the already-
// captured L5.R2 fixture and L5.R3's own decomposition unchanged; this
// stage only ADDS claim binding + confirmed-claim-aware registry
// comparison on top.
const suite = process.env.DATABASE_URL ? describe : describe.skip;

const REAL_OWNER_USER_ID = "449216a6-695d-40ae-9af3-17f218c8d172";
const REAL_SOURCE_EVIDENCE_ID = "66b5e27a-bb9b-4e8d-a777-a4f8eb211720";
const REAL_REVIEW_ID = "0452ffd9-af59-418f-a2dd-9f2b2c4ee779";
const ASSIMILATION_VERSION = "l5r3-assimilation-v1";
const PROPOSAL_VERSION_BEFORE = "l5r3-proposal-v1";
const PROPOSAL_VERSION_AFTER = "l5r3.1-proposal-v1";

suite("Stage 8.5L5.R3.1 -- real professionally validated claim binding (zero AI calls, zero network)", () => {
  it("recovers real frozen claims, binds Ionut's real confirmed themes, and re-runs registry comparison -- registry/review/draft immutable", async () => withL5R3AcceptanceFixture(async (prisma) => {
    const evidenceRow = await prisma.professionalLearningEvidence.findUnique({ where: { id: REAL_SOURCE_EVIDENCE_ID } });
    const reviewRow = await prisma.professionalLearningReview.findUnique({ where: { id: REAL_REVIEW_ID } });
    expect(evidenceRow).not.toBeNull();
    expect(reviewRow).not.toBeNull();
    if (!evidenceRow || !reviewRow) throw new Error("unreachable -- asserted above");

    const approvalDetail = reviewRow.approvalDetail as { confirmedThemes?: readonly string[] };
    const confirmedThemes = approvalDetail.confirmedThemes ?? [];
    expect(confirmedThemes.length).toBeGreaterThan(0);

    const registry = buildCanonicalCandidateSkillRegistry();
    const registryRowsBefore = await prisma.professionalSkillDefinition.count();
    const draftRowsBefore = await prisma.professionalLearningDraft.count({ where: { sourceEvidenceId: REAL_SOURCE_EVIDENCE_ID } });
    const reviewApprovalDetailBefore = JSON.stringify(reviewRow.approvalDetail);
    const reviewHashBefore = reviewRow.approvedResultHash;

    const rawResultsByWindowId = new Map<string, ProfessionalLearningExtractorOutput>(Object.entries(L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID));

    const eligibility = verifyApprovedKnowledgeSource({
      requestingOwnerUserId: REAL_OWNER_USER_ID,
      evidence: { id: evidenceRow.id, ownerUserId: evidenceRow.ownerUserId, status: evidenceRow.status },
      review: {
        id: reviewRow.id,
        ownerUserId: reviewRow.ownerUserId,
        sourceEvidenceId: reviewRow.sourceEvidenceId,
        reviewedExtractionVersion: reviewRow.reviewedExtractionVersion,
        approvedResultHash: reviewRow.approvedResultHash,
        status: reviewRow.status,
      },
      windowPlan: L5R2_REAL_WINDOW_PLAN,
      rawResultsByWindowId,
    });
    expect(eligibility.eligibility).toBe("ELIGIBLE");
    if (!eligibility.source) throw new Error("unreachable -- asserted above");

    const decomposition = decomposeApprovedSource(eligibility.source, ASSIMILATION_VERSION);

    // --- BEFORE: L5.R3's own original proposal, unchanged ---
    const proposalBefore = buildKnowledgeAssimilationProposal({ proposalVersion: PROPOSAL_VERSION_BEFORE, decomposition, registry });
    expect(proposalBefore.insufficientItems).toHaveLength(12);

    // --- Section 12/13: claim binding using Ionut's REAL confirmed themes ---
    const bindings = bindClaimsForApprovedSource(eligibility.source, decomposition, confirmedThemes, ASSIMILATION_VERSION);
    expect(bindings).toHaveLength(decomposition.knowledgeUnits.length);
    const confirmedClaimsByUnitId = new Map(bindings.map((b) => [b.knowledgeUnitId, b.claims]));

    // --- AFTER: enriched proposal with confirmed claim bindings ---
    const proposalAfter = buildKnowledgeAssimilationProposal({ proposalVersion: PROPOSAL_VERSION_AFTER, decomposition, registry, confirmedClaimsByUnitId });

    // Section 66/67: report the real before/after split -- never optimized
    // for a higher assimilation rate.
    const outcomeCounts = (comparisons: typeof proposalAfter.registryComparisons) => {
      const counts: Record<string, number> = {};
      for (const c of comparisons) counts[c.outcome] = (counts[c.outcome] ?? 0) + 1;
      return counts;
    };

    // --- Section 54/55: registry + review immutability ---
    const registryRowsAfter = await prisma.professionalSkillDefinition.count();
    expect(registryRowsAfter).toBe(registryRowsBefore);
    expect(registryRowsBefore).toBe(0);
    const draftRowsAfter = await prisma.professionalLearningDraft.count({ where: { sourceEvidenceId: REAL_SOURCE_EVIDENCE_ID } });
    expect(draftRowsAfter).toBe(draftRowsBefore);
    const reviewReloaded = await prisma.professionalLearningReview.findUnique({ where: { id: REAL_REVIEW_ID } });
    expect(JSON.stringify(reviewReloaded?.approvalDetail)).toBe(reviewApprovalDetailBefore);
    expect(reviewReloaded?.approvedResultHash).toBe(reviewHashBefore);

    const outputPath = path.join(process.cwd(), "scratch-l5r3-1-real-claim-binding-result.json");
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          confirmedThemes,
          knowledgeUnits: decomposition.knowledgeUnits,
          bindings,
          proposalBeforeOutcomeCounts: outcomeCounts(proposalBefore.registryComparisons),
          proposalAfterOutcomeCounts: outcomeCounts(proposalAfter.registryComparisons),
          registryComparisonsAfter: proposalAfter.registryComparisons,
          proposalAfterCanonicalHash: proposalAfter.canonicalHash,
        },
        null,
        2,
      ),
      "utf8",
    );
  }), 60_000);
});
