import { describe, expect, it } from "vitest";

import { verifyApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import { decomposeApprovedSource } from "@/lib/professional-knowledge-decomposition";
import { bindClaimsForApprovedSource } from "@/lib/professional-knowledge-claim-binding";
import { buildKnowledgeAssimilationProposal } from "@/lib/professional-knowledge-assimilation-proposal";
import { L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID, L5R2_REAL_WINDOW_PLAN } from "@/lib/professional-learning-video-l5r2-real-fixture";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.1 --
// DETERMINISTIC REPLAY of the real claim binding + enriched registry
// comparison (Section 57-59). ZERO database, ZERO AI, ZERO network
// anywhere in this file. The real confirmedThemes list is a hardcoded
// LITERAL array here (taken from the real captured result documented in
// this stage's own report), not read from any database.

const REAL_OWNER_USER_ID = "449216a6-695d-40ae-9af3-17f218c8d172";
const REAL_SOURCE_EVIDENCE_ID = "66b5e27a-bb9b-4e8d-a777-a4f8eb211720";
const REAL_REVIEW_ID = "0452ffd9-af59-418f-a2dd-9f2b2c4ee779";
const REAL_APPROVED_RESULT_HASH = "2381fdf110c87ca8a6dbc52bdf56eb16a9ecf883f7983615bb0499ec87f82190";
const REAL_CONFIRMED_THEMES = [
  "progressive_elevation",
  "mobile_guide",
  "sectioning",
  "overdirection",
  "stationary_guide",
  "graduated_bob_technique",
  "top_zone_elevation",
  "wet_to_dry_transition",
  "point_cutting",
  "texturizing",
  "final_styling",
  "repeated_actions_and_observed_validations",
];
const ASSIMILATION_VERSION = "l5r3-assimilation-v1";
const PROPOSAL_VERSION_AFTER = "l5r3.1-proposal-v1";

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
  const bindings = bindClaimsForApprovedSource(eligibility.source, decomposition, REAL_CONFIRMED_THEMES, ASSIMILATION_VERSION);
  const confirmedClaimsByUnitId = new Map(bindings.map((b) => [b.knowledgeUnitId, b.claims]));
  const registry = buildCanonicalCandidateSkillRegistry();
  const proposal = buildKnowledgeAssimilationProposal({ proposalVersion: PROPOSAL_VERSION_AFTER, decomposition, registry, confirmedClaimsByUnitId });

  return { eligibility, decomposition, bindings, proposal };
}

describe("Stage 8.5L5.R3.1 -- deterministic replay of the real claim binding (ZERO database, ZERO AI, ZERO network)", () => {
  it("Section 57-58: rerunning the pipeline twice produces byte-identical binding ids, claim ids, and proposal hash", () => {
    const first = runPipeline();
    const second = runPipeline();
    expect(second.bindings.map((b) => b.id)).toEqual(first.bindings.map((b) => b.id));
    expect(second.bindings.flatMap((b) => b.claims.map((c) => c.claimId))).toEqual(first.bindings.flatMap((b) => b.claims.map((c) => c.claimId)));
    expect(second.proposal.canonicalHash).toBe(first.proposal.canonicalHash);
  });

  it("replays the exact real claim recovery: window 0's guideType is bound as INFERRED and PROFESSIONALLY_CONFIRMED by mobile_guide", () => {
    const { decomposition, bindings } = runPipeline();
    const window0Unit = decomposition.knowledgeUnits.find((u) => u.type === "EXECUTION_CAPABILITY" && u.label.includes("CUTTING_ACTION pattern observed in window 0"))!;
    const binding = bindings.find((b) => b.knowledgeUnitId === window0Unit.id)!;
    const guideClaim = binding.claims.find((c) => c.fieldName === "guideType");
    expect(guideClaim?.value).toBe("mobile guide");
    expect(guideClaim?.originalProvenance).toBe("INFERRED");
    expect(guideClaim?.reviewConfirmation).toBe("PROFESSIONALLY_CONFIRMED");
    expect(guideClaim?.confirmedByTheme).toBe("mobile_guide");
  });

  it("replays the exact real claim recovery: window 1's guideType is bound as OBSERVED and confirmed by stationary_guide, never colliding with mobile_guide", () => {
    const { decomposition, bindings } = runPipeline();
    const window1Unit = decomposition.knowledgeUnits.find((u) => u.type === "EXECUTION_CAPABILITY" && u.label.includes("CUTTING_ACTION pattern observed in window 1"))!;
    const binding = bindings.find((b) => b.knowledgeUnitId === window1Unit.id)!;
    const guideClaim = binding.claims.find((c) => c.fieldName === "guideType");
    expect(guideClaim?.value).toBe("Stationary guideline");
    expect(guideClaim?.originalProvenance).toBe("OBSERVED");
    expect(guideClaim?.confirmedByTheme).toBe("stationary_guide");
  });

  it("replays the exact real result: all 12 units remain INSUFFICIENT_FOR_ASSIMILATION even after claim binding -- the confirmed claims are real free-text descriptions, not values crisp enough to match any of the 6 registry skills' own fixed parameters (Section 32: the gate remains active, never forced)", () => {
    const { proposal } = runPipeline();
    expect(proposal.insufficientItems).toHaveLength(12);
    expect(proposal.proposedNewSkills).toHaveLength(0);
    expect(proposal.possibleConflicts).toHaveLength(0);
  });

  it("replays the exact real reference-candidate claims: 4 separate claims, each preserving its own observation text and established=false", () => {
    const { decomposition, bindings } = runPipeline();
    const referenceUnits = decomposition.knowledgeUnits.filter((u) => u.type === "REFERENCE_RELATIONSHIP");
    expect(referenceUnits).toHaveLength(4);
    for (const unit of referenceUnits) {
      const binding = bindings.find((b) => b.knowledgeUnitId === unit.id)!;
      expect(binding.claims).toHaveLength(1);
      expect(binding.claims[0].claimType).toBe("REFERENCE_CANDIDATE");
      expect(binding.claims[0].note).toContain("established=false");
    }
    // Each of the 4 must be individually identifiable -- never grouped.
    const claimTexts = new Set(bindings.filter((b) => referenceUnits.some((u) => u.id === b.knowledgeUnitId)).flatMap((b) => b.claims.map((c) => c.value)));
    expect(claimTexts.size).toBe(4);
  });
});
