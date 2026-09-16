import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { withL5R3AcceptanceFixture } from "../../tests/l5r3-acceptance-db-fixture";
import { verifyApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import { decomposeApprovedSource } from "@/lib/professional-knowledge-decomposition";
import { buildKnowledgeAssimilationProposal } from "@/lib/professional-knowledge-assimilation-proposal";
import { L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID, L5R2_REAL_WINDOW_PLAN } from "@/lib/professional-learning-video-l5r2-real-fixture";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 -- THE FIRST
// REAL PROFESSIONALLY-VALIDATED KNOWLEDGE ASSIMILATION ACCEPTANCE. Real
// Postgres reads only (the real L5.R2 evidence + ProfessionalLearningReview
// rows from the real acceptance/approval runs) -- ZERO AI calls, ZERO
// video access, ZERO network of any kind. Uses the already-captured L5.R2
// fixture (professional-learning-video-l5r2-real-fixture.ts), NEVER a new
// extraction (Section 7: EXTRACTION != ASSIMILATION).
//
// Gated ONLY by DATABASE_URL -- no real-provider flag is needed since this
// test makes no provider call whatsoever.
const suite = process.env.DATABASE_URL ? describe : describe.skip;

const REAL_OWNER_USER_ID = "449216a6-695d-40ae-9af3-17f218c8d172";
const REAL_SOURCE_EVIDENCE_ID = "66b5e27a-bb9b-4e8d-a777-a4f8eb211720";
const REAL_REVIEW_ID = "0452ffd9-af59-418f-a2dd-9f2b2c4ee779";
const ASSIMILATION_VERSION = "l5r3-assimilation-v1";
const PROPOSAL_VERSION = "l5r3-proposal-v1";

suite("Stage 8.5L5.R3 -- real professionally-validated knowledge assimilation (zero AI calls, zero network)", () => {
  it("loads the real frozen L5.R2 result + real review, verifies authority, decomposes, compares against the real registry, and builds a real proposal", async () => withL5R3AcceptanceFixture(async (prisma) => {
    const evidenceRow = await prisma.professionalLearningEvidence.findUnique({ where: { id: REAL_SOURCE_EVIDENCE_ID } });
    expect(evidenceRow).not.toBeNull();
    const reviewRow = await prisma.professionalLearningReview.findUnique({ where: { id: REAL_REVIEW_ID } });
    expect(reviewRow).not.toBeNull();
    if (!evidenceRow || !reviewRow) throw new Error("unreachable -- asserted above");

    const registry = buildCanonicalCandidateSkillRegistry();
    const registryRowsBefore = await prisma.professionalSkillDefinition.count();
    const draftRowsBefore = await prisma.professionalLearningDraft.count({ where: { sourceEvidenceId: REAL_SOURCE_EVIDENCE_ID } });
    const reviewRowsBefore = await prisma.professionalLearningReview.count({ where: { sourceEvidenceId: REAL_SOURCE_EVIDENCE_ID } });

    const rawResultsByWindowId = new Map<string, ProfessionalLearningExtractorOutput>(Object.entries(L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID));

    // --- Section 4/5/6: authority gate ---
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
    expect(eligibility.recomputedHash).toBe(reviewRow.approvedResultHash);
    expect(eligibility.source).not.toBeNull();
    if (!eligibility.source) throw new Error("unreachable -- asserted above");

    // --- Section 39-45: decomposition ---
    const decomposition = decomposeApprovedSource(eligibility.source, ASSIMILATION_VERSION);
    expect(decomposition.knowledgeUnits.length).toBeGreaterThan(0);

    // --- Section 29-38: registry comparison + Section 46: proposal ---
    const proposal = buildKnowledgeAssimilationProposal({ proposalVersion: PROPOSAL_VERSION, decomposition, registry });

    expect(proposal.status).toBe("DRAFT_PENDING_PROFESSIONAL_APPROVAL");
    expect(proposal.registryComparisons).toHaveLength(decomposition.knowledgeUnits.length);
    // No comparison outcome may ever be PROPOSE_NEW_REUSABLE_SKILL from
    // this run's real evidence alone (Section 37/80: highest bar, never
    // forced) -- this run has zero PROFESSIONAL_INPUT field-level
    // corrections and zero established reference relationships, so
    // nothing clears that bar. Asserted, not assumed.
    expect(proposal.proposedNewSkills).toHaveLength(0);
    expect(proposal.possibleConflicts).toHaveLength(0);

    // --- Section 30/71: registry immutability ---
    const registryRowsAfter = await prisma.professionalSkillDefinition.count();
    expect(registryRowsAfter).toBe(registryRowsBefore);
    expect(registryRowsBefore).toBe(0);

    // --- Section 72: review immutability ---
    const reviewRowsAfter = await prisma.professionalLearningReview.count({ where: { sourceEvidenceId: REAL_SOURCE_EVIDENCE_ID } });
    expect(reviewRowsAfter).toBe(reviewRowsBefore);
    const reviewReloaded = await prisma.professionalLearningReview.findUnique({ where: { id: REAL_REVIEW_ID } });
    expect(reviewReloaded?.approvedResultHash).toBe(reviewRow.approvedResultHash);
    expect(reviewReloaded?.status).toBe(reviewRow.status);

    // --- Section 48: no draft created ---
    const draftRowsAfter = await prisma.professionalLearningDraft.count({ where: { sourceEvidenceId: REAL_SOURCE_EVIDENCE_ID } });
    expect(draftRowsAfter).toBe(draftRowsBefore);
    expect(draftRowsBefore).toBe(0);

    // Write the full real result for the report (never committed -- see
    // the stage's own scratch-JSON precedent from L5.R1/L5.R1.1/L5.R2).
    const outputPath = path.join(process.cwd(), "scratch-l5r3-real-assimilation-proposal-result.json");
    fs.writeFileSync(outputPath, JSON.stringify({ eligibility: { eligibility: eligibility.eligibility, recomputedHash: eligibility.recomputedHash }, decomposition, proposal }, null, 2), "utf8");
  }), 60_000);
});
