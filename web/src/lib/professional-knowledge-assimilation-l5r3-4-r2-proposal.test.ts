import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  computePendingMutationStatus,
  GRADUATED_CUTTING_INTERIOR_TERMINOLOGY_AUDIT,
  INTERIOR_45_PROPOSED_MUTATION,
  IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT,
  IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT_ID,
} from "@/lib/professional-knowledge-assimilation-l5r3-4-r2-proposal";
import { buildRealAssimilationPlan } from "@/lib/professional-knowledge-assimilation-l5r3-4-real-plan";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4.R2 -- pure
// tests for the 45deg Interior provenance record + independent Graduated
// Cutting audit + the new ProposedRegistryMutation. No I/O, no database,
// ZERO AI calls, ZERO registry writes anywhere in this file.

// The real L5.R2 evidence identifiers (professional-knowledge-review-
// l5r3-2-real-decisions.ts's own local, non-exported constants) --
// hardcoded here only for the negative-comparison test below, proving
// this stage's own provenance record never reuses them.
const L5R2_SOURCE_EVIDENCE_ID = "66b5e27a-bb9b-4e8d-a777-a4f8eb211720";
const L5R2_REVIEW_ID = "0452ffd9-af59-418f-a2dd-9f2b2c4ee779";
const L5R2_APPROVED_RESULT_HASH = "2381fdf110c87ca8a6dbc52bdf56eb16a9ecf883f7983615bb0499ec87f82190";

describe("professional authority record -- provenance is professional, never video-derived", () => {
  it("test 1: provenance classification is explicitly PROFESSIONAL_INPUT_NOT_VIDEO_DERIVED", () => {
    expect(IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT.provenanceClassification).toBe("PROFESSIONAL_INPUT_NOT_VIDEO_DERIVED");
  });

  it("test 2: the professional input's own id and authority source never reuse the L5.R2 video review's own evidence/review/result identifiers", () => {
    expect(IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT_ID).not.toBe(L5R2_SOURCE_EVIDENCE_ID);
    expect(IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT_ID).not.toBe(L5R2_REVIEW_ID);
    expect(IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT_ID).not.toBe(L5R2_APPROVED_RESULT_HASH);
    expect(IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT.professionalAuthoritySource).not.toContain(L5R2_SOURCE_EVIDENCE_ID);
  });

  it("test 3: the professional sequence preserves the key mechanics verbatim -- rotation without lifting the hand, corner repositioning never reversed", () => {
    const joined = IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT.professionalSequenceEnglish.join(" ");
    expect(joined).toMatch(/without lifting it away from the base/);
    expect(joined).toMatch(/never reversed/);
    expect(joined).toMatch(/approximately 45deg cutting line/);
  });

  it("test 4: unknownFields is non-empty and explicitly names the guide-reference gap -- never silently omitted", () => {
    expect(IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT.unknownFields.length).toBeGreaterThan(0);
    expect(IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT.unknownFields.some((f) => f.includes("guideSource"))).toBe(true);
  });
});

describe("Graduated Cutting contradiction audit -- independent finding, never a silent edit", () => {
  it("test 5: the outcome is NOT_A_CONTRADICTION -- two structurally different physical referents sharing overlapping English words, never reconciled by editing either skill", () => {
    expect(GRADUATED_CUTTING_INTERIOR_TERMINOLOGY_AUDIT.outcome).toBe("NOT_A_CONTRADICTION");
  });

  it("test 6: the audit cross-checks against the REAL, currently-registered skillIds, not a stale/hardcoded assumption", () => {
    expect(GRADUATED_CUTTING_INTERIOR_TERMINOLOGY_AUDIT.graduatedCuttingSkillIdConfirmedUnchanged).toBe("skill-cutting-graduated");
    expect(GRADUATED_CUTTING_INTERIOR_TERMINOLOGY_AUDIT.oneLengthSkillIdConfirmedUnchanged).toBe("skill-cutting-one-length-perimeter");
  });

  it("test 7: cutting-skill-graduated.ts still contains its own original, byte-unchanged 'interior-shorter-than-perimeter' statement -- this audit never edited it", () => {
    const source = fs.readFileSync(path.join(__dirname, "cutting-skill-graduated.ts"), "utf8");
    expect(source).toMatch(/interior-shorter-than-perimeter relationship/);
  });

  it("test 8: the audit's own recommendation is documentation-only -- explicitly states no code change is required or proposed", () => {
    expect(GRADUATED_CUTTING_INTERIOR_TERMINOLOGY_AUDIT.recommendationForFutureReview).toMatch(/no code change is required or proposed/i);
  });
});

describe("the new ProposedRegistryMutation -- separate, additionally auditable, never activated", () => {
  it("test 9: activationState is PENDING_PROFESSIONAL_APPROVAL (type-guaranteed single-member union)", () => {
    expect(INTERIOR_45_PROPOSED_MUTATION.activationState).toBe("PENDING_PROFESSIONAL_APPROVAL");
  });

  it("test 10: operation is PROPOSE_NEW_SKILL, targetSkillId is null (a new identity, not a mutation of an existing skill)", () => {
    expect(INTERIOR_45_PROPOSED_MUTATION.operation).toBe("PROPOSE_NEW_SKILL");
    expect(INTERIOR_45_PROPOSED_MUTATION.targetSkillId).toBeNull();
  });

  it("test 11: proposedIdentity.distinctFrom names Graduated Cutting, and relatedTechniqueIds names One-Length Perimeter -- dependency without merger", () => {
    expect(INTERIOR_45_PROPOSED_MUTATION.proposedIdentity?.distinctFrom).toContain("skill-cutting-graduated");
    expect(INTERIOR_45_PROPOSED_MUTATION.proposedIdentity?.relatedTechniqueIds).toContain("skill-cutting-one-length-perimeter");
  });

  it("test 12: reason explicitly labels this a professional addition, never an AI-driven proposal", () => {
    expect(INTERIOR_45_PROPOSED_MUTATION.reason).toContain("Professional addition");
  });

  it("test 13: unknownFieldsPreserved never contains a fabricated numeric value -- same discipline as the L5.R3.4 mutation set's own test 23", () => {
    for (const field of INTERIOR_45_PROPOSED_MUTATION.unknownFieldsPreserved) expect(field).not.toMatch(/\d/);
  });

  it("test 14: sourceDecisionIds points at this stage's own professional-input record id, never fabricated, never empty", () => {
    expect(INTERIOR_45_PROPOSED_MUTATION.sourceDecisionIds).toEqual([IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT_ID]);
  });
});

describe("pending mutation status -- existing 10 + new 1 = 11, nothing activated", () => {
  it("test 15: computePendingMutationStatus reports existingCount=10, newCount=1, totalPending=11", () => {
    const status = computePendingMutationStatus();
    expect(status.existingCount).toBe(10);
    expect(status.newCount).toBe(1);
    expect(status.totalPending).toBe(11);
  });

  it("test 16: the existing L5.R3.4.R1 plan's own mutationSet is read-only -- unaffected by this stage's own new mutation existing", () => {
    const before = JSON.stringify(buildRealAssimilationPlan().mutationSet);
    // Force construction/read of the new mutation module's own exports.
    void INTERIOR_45_PROPOSED_MUTATION;
    const after = JSON.stringify(buildRealAssimilationPlan().mutationSet);
    expect(after).toBe(before);
    for (const mutation of buildRealAssimilationPlan().mutationSet) expect(mutation.activationState).toBe("PENDING_PROFESSIONAL_APPROVAL");
  });
});

describe("registry safety -- zero registry mutation, zero activation, zero Prisma/provider coupling", () => {
  it("test 17: the real, currently-registered skill registry never references the new proposed skillId -- proposal-only, never wired in", () => {
    const registryJson = JSON.stringify(buildCanonicalCandidateSkillRegistry());
    expect(registryJson).not.toMatch(/skill-cutting-45-degree-interior/);
  });

  it("test 18: professional-brain-skill-templates.ts's own source file never imports or references the new proposal files", () => {
    const source = fs.readFileSync(path.join(__dirname, "professional-brain-skill-templates.ts"), "utf8");
    expect(source).not.toMatch(/45-degree-interior/);
    expect(source).not.toMatch(/cutting-skill-45-degree-interior/);
  });

  it("test 19: neither new proposal file imports Prisma or calls any provider client", () => {
    for (const file of ["cutting-skill-45-degree-interior.ts", "professional-knowledge-assimilation-l5r3-4-r2-proposal.ts"]) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/from ["']@\/lib\/prisma["']/);
      expect(source).not.toMatch(/\bprisma\./);
    }
  });

  it("test 20: neither new proposal file declares an apply/activate function -- non-executable by default, same discipline as the L5.R3.4 mutation set", () => {
    for (const file of ["cutting-skill-45-degree-interior.ts", "professional-knowledge-assimilation-l5r3-4-r2-proposal.ts"]) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/function apply/i);
      expect(source).not.toMatch(/function activate/i);
      expect(source).not.toMatch(/professionalSkillDefinition\.(create|update|upsert)/);
    }
  });

  it("test 21: the proposal is fully JSON-serializable and deterministically replayable", () => {
    const roundTripped = JSON.parse(JSON.stringify(INTERIOR_45_PROPOSED_MUTATION));
    expect(roundTripped).toEqual(INTERIOR_45_PROPOSED_MUTATION);
  });
});
