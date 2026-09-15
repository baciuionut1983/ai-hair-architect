import { describe, expect, it } from "vitest";

import { verifyApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import { decomposeApprovedSource } from "@/lib/professional-knowledge-decomposition";
import { buildKnowledgeAssimilationProposal } from "@/lib/professional-knowledge-assimilation-proposal";
import { L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID, L5R2_REAL_WINDOW_PLAN } from "@/lib/professional-learning-video-l5r2-real-fixture";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 --
// DETERMINISTIC REPLAY of the real L5.R3 knowledge assimilation (Section
// 60). Reruns the COMPLETE authority-gate + decomposition + registry-
// comparison + proposal pipeline against the exact already-committed L5.R2
// fixture with ZERO database access, ZERO AI calls, ZERO video access,
// ZERO network of any kind anywhere in this file. Always runs as part of
// npm test/CI.
//
// The real evidence/review identity fields (owner, evidence id, review id,
// approvedResultHash) are hardcoded LITERAL strings here -- taken from the
// real captured result documented in this stage's own report -- not read
// from any database. Reproducing them exactly is itself part of the
// canonical-equivalence proof.

const REAL_OWNER_USER_ID = "449216a6-695d-40ae-9af3-17f218c8d172";
const REAL_SOURCE_EVIDENCE_ID = "66b5e27a-bb9b-4e8d-a777-a4f8eb211720";
const REAL_REVIEW_ID = "0452ffd9-af59-418f-a2dd-9f2b2c4ee779";
const REAL_APPROVED_RESULT_HASH = "2381fdf110c87ca8a6dbc52bdf56eb16a9ecf883f7983615bb0499ec87f82190";
const ASSIMILATION_VERSION = "l5r3-assimilation-v1";
const PROPOSAL_VERSION = "l5r3-proposal-v1";

function runPipeline() {
  const rawResultsByWindowId = new Map<string, ProfessionalLearningExtractorOutput>(Object.entries(L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID));

  const eligibility = verifyApprovedKnowledgeSource({
    requestingOwnerUserId: REAL_OWNER_USER_ID,
    evidence: { id: REAL_SOURCE_EVIDENCE_ID, ownerUserId: REAL_OWNER_USER_ID, status: "ACTIVE" },
    review: {
      id: REAL_REVIEW_ID,
      ownerUserId: REAL_OWNER_USER_ID,
      sourceEvidenceId: REAL_SOURCE_EVIDENCE_ID,
      reviewedExtractionVersion: L5R2_REAL_WINDOW_PLAN.segmentationVersion,
      approvedResultHash: REAL_APPROVED_RESULT_HASH,
      status: "PROFESSIONALLY_VALIDATED",
    },
    windowPlan: L5R2_REAL_WINDOW_PLAN,
    rawResultsByWindowId,
  });

  if (eligibility.eligibility !== "ELIGIBLE" || !eligibility.source) throw new Error(`unreachable in replay -- eligibility was ${eligibility.eligibility}`);

  const decomposition = decomposeApprovedSource(eligibility.source, ASSIMILATION_VERSION);
  const registry = buildCanonicalCandidateSkillRegistry();
  const proposal = buildKnowledgeAssimilationProposal({ proposalVersion: PROPOSAL_VERSION, decomposition, registry });

  return { eligibility, decomposition, proposal };
}

describe("Stage 8.5L5.R3 -- deterministic replay of the real knowledge assimilation (ZERO database, ZERO AI, ZERO network)", () => {
  it("Section 4: recomputed hash matches the real professionally reviewed hash exactly, with zero database access", () => {
    const { eligibility } = runPipeline();
    expect(eligibility.eligibility).toBe("ELIGIBLE");
    expect(eligibility.recomputedHash).toBe(REAL_APPROVED_RESULT_HASH);
  });

  it("Section 64: rerunning the pipeline twice on the identical fixture produces byte-identical knowledge unit ids and proposal hash (idempotency)", () => {
    const first = runPipeline();
    const second = runPipeline();
    expect(second.decomposition.knowledgeUnits.map((u) => u.id)).toEqual(first.decomposition.knowledgeUnits.map((u) => u.id));
    expect(second.proposal.canonicalHash).toBe(first.proposal.canonicalHash);
  });

  it("replays the exact real result: 12 knowledge units (8 execution/validation groups + 4 reference-relationship candidates), 3 non-reusable observations", () => {
    const { decomposition } = runPipeline();
    expect(decomposition.knowledgeUnits).toHaveLength(12);
    expect(decomposition.nonReusableObservations).toHaveLength(3);
    expect(decomposition.nonReusableObservations.map((o) => o.kind).sort()).toEqual(["COMBING", "REPOSITIONING", "REPOSITIONING"]);
  });

  it("replays the exact real registry-comparison result: all 12 units INSUFFICIENT_FOR_ASSIMILATION, zero conflicts, zero new skills proposed", () => {
    const { proposal } = runPipeline();
    expect(proposal.insufficientItems).toHaveLength(12);
    expect(proposal.proposedNewSkills).toHaveLength(0);
    expect(proposal.possibleConflicts).toHaveLength(0);
    expect(proposal.proposedVariations).toHaveLength(0);
    expect(proposal.proposedExtensions).toHaveLength(0);
    expect(proposal.proposedEvidenceAttachments).toHaveLength(0);
  });

  // STAGE 8.5L5.R3.5 FLIP (this revision): both literals below changed
  // because buildCanonicalCandidateSkillRegistry() now includes Ionuț's
  // approved 45deg Interior skill (7 skills, not 6) -- registryContextHash
  // is a direct, deterministic hash of the full registry content
  // (computeRegistryContextHash), so any real registry growth changes it;
  // canonicalHash incorporates registryContextHash, so it changes too.
  // The pipeline's own CONTENT is unaffected -- the sibling test above
  // ("replays the exact real registry-comparison result...") still
  // passes unchanged: 12 insufficient items, zero new skills, zero
  // conflicts -- this frozen L5.R2 decomposition still finds nothing
  // newly assimilable against the larger registry. Both new literal
  // values were captured by directly running this exact test against the
  // real, live post-activation registry (never guessed).
  it("replays the exact real proposal canonical hash and registry context hash", () => {
    const { proposal } = runPipeline();
    expect(proposal.canonicalHash).toBe("2cbdd8afd49d5cd4c003f04be7e19123702e81425e26e5c7f440954d93a3dc19");
    expect(proposal.registryContextHash).toBe("4ba57db71d311c1b203c4c4f28bf0c84774eec7e40fd3e9d35485dd83d4dcac0");
    expect(proposal.status).toBe("DRAFT_PENDING_PROFESSIONAL_APPROVAL");
  });

  it("Section 62-63: a different (fictitious, larger) registry context produces a different registryContextHash and is detected as stale against the real proposal", () => {
    const { proposal, decomposition } = runPipeline();
    const largerRegistry = [...buildCanonicalCandidateSkillRegistry()];
    const withExtra = buildKnowledgeAssimilationProposal({
      proposalVersion: PROPOSAL_VERSION,
      decomposition,
      registry: [...largerRegistry, { ...largerRegistry[0], id: "registry-extra", skillId: "skill-fictitious-extra-for-stale-test", version: 1 }],
    });
    expect(withExtra.registryContextHash).not.toBe(proposal.registryContextHash);
  });
});
