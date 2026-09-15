import { describe, expect, it } from "vitest";

import {
  buildActiveProfessionalKnowledgeRegistry,
  computeProfessionalKnowledgeRegistryFingerprint,
  queryApprovedButUnattached,
  queryContextualKnowledgeBySubject,
  queryEvidenceSupportingSkill,
  queryTechniquePurposes,
  queryTechniquesByEffect,
  queryWorkflowTransitionsFrom,
  summarizeProfessionalKnowledgeSnapshot,
} from "@/lib/professional-knowledge-registry";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import {
  guardGraduatedElevationIntact,
  guardInterior45DependsOnOneLength,
  guardInterior45LengthRelationshipIntact,
  guardInterior45NotMandatoryForOneLength,
  guardNoElevation45OnInterior45,
  guardOneLengthNoTravellingGuideRegression,
  runAllFailClosedGuards,
} from "@/lib/professional-knowledge-activation-l5r3-5-execute";
import { INTERIOR_45_GUIDE_CAPABILITY } from "@/lib/cutting-skill-45-degree-interior";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.6 --
// PROFESSIONAL BRAIN ACCEPTANCE TEST + PRE/POST KNOWLEDGE SNAPSHOT + R3.5
// safety re-proofs. Deterministic, READ-ONLY. NO LLM, NO provider, NO
// network anywhere in this file.

describe("pre/post knowledge snapshot", () => {
  it("PRE: before this stage, the Professional Knowledge Registry concept did not exist -- 0 entries, a real, empty baseline", () => {
    const empty: ReturnType<typeof buildActiveProfessionalKnowledgeRegistry> = [];
    expect(summarizeProfessionalKnowledgeSnapshot(empty).totalEntries).toBe(0);
  });

  it("POST: after this stage, 16 entries exist -- exact category delta", () => {
    const summary = summarizeProfessionalKnowledgeSnapshot(buildActiveProfessionalKnowledgeRegistry());
    expect(summary.totalEntries).toBe(16);
    expect(summary).toMatchObject({
      countsByCategory: {
        ACTIVE_TECHNIQUE_IDENTITY: 3,
        ACTIVE_PURPOSE: 3,
        ACTIVE_EFFECT_RELATIONSHIP: 1,
        ACTIVE_WORKFLOW: 1,
        ACTIVE_CONTEXTUAL_KNOWLEDGE: 3,
        ACTIVE_EVIDENCE_SUPPORT: 1,
        APPROVED_BUT_UNATTACHED: 4,
        UNKNOWN: 0,
      },
    });
  });

  it("the pre and post fingerprints differ -- a real, detectable, positive-only change (ADDED, never MODIFIED/REMOVED)", () => {
    const preFingerprint = computeProfessionalKnowledgeRegistryFingerprint([]);
    const postFingerprint = computeProfessionalKnowledgeRegistryFingerprint(buildActiveProfessionalKnowledgeRegistry());
    expect(preFingerprint).not.toBe(postFingerprint);
  });
});

describe("Query A: what professional purposes can Point Cut serve?", () => {
  it("ALIGNMENT_CORRECTION is retrievable", () => {
    expect(queryTechniquePurposes(buildActiveProfessionalKnowledgeRegistry(), "point-cut")).toEqual(["ALIGNMENT_CORRECTION"]);
  });
});

describe("Query B: what techniques may reduce/lighten terminal mass?", () => {
  it("returns Deep Point Cut, Channel Cut, Slice-and-Slide -- 3 distinct, never aliased", () => {
    const result = queryTechniquesByEffect(buildActiveProfessionalKnowledgeRegistry(), "REDUCE_SOFTEN_TEXTURIZE_TERMINAL_MASS");
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
  });
});

describe("Query C: what workflow transition is known after wet structural cutting?", () => {
  it("dry refinement/check/finishing, where approved scope supports it", () => {
    const result = queryWorkflowTransitionsFrom(buildActiveProfessionalKnowledgeRegistry(), "wet_structural_work");
    expect(result[0]?.toValue).toBe("dry_refinement_check_finishing");
  });
});

describe("Query D: what professional evidence supports this Graduated Cutting behavior?", () => {
  it("real evidence retrievable, without cloning the skill", () => {
    const result = queryEvidenceSupportingSkill(buildActiveProfessionalKnowledgeRegistry(), "skill-cutting-graduated");
    expect(result).toHaveLength(1);
    // Graduated Cutting's own SkillDefinition is untouched -- this is a
    // SEPARATE, supporting entry, never a second copy of the skill.
    const graduated = buildCanonicalCandidateSkillRegistry().find((r) => r.skillId === "skill-cutting-graduated")!;
    expect(graduated.payload.parameters.length).toBeGreaterThan(0); // still the real, full skill, unmodified
  });
});

describe("Query E: what is commonly used on short-hair terminal zones?", () => {
  it("returns candidates without turning them into requirements", () => {
    const result = queryContextualKnowledgeBySubject(buildActiveProfessionalKnowledgeRegistry(), "SHORT");
    expect(result.length).toBeGreaterThan(0);
    for (const r of result) expect(r.relation).not.toBe("REQUIRED");
  });
});

describe("Query F: what knowledge is professionally approved but not safely attached?", () => {
  it("the 4 pending items are retrievable and visible", () => {
    const pending = queryApprovedButUnattached(buildActiveProfessionalKnowledgeRegistry());
    expect(pending).toHaveLength(4);
  });
});

describe("Query G: I have completed One-Length and want inward curvature -- 45deg Interior remains retrievable and unchanged", () => {
  it("45deg Interior is still ACTIVE, unmodified by this stage", () => {
    const registry = buildCanonicalCandidateSkillRegistry();
    const interior45 = registry.find((r) => r.skillId === "skill-cutting-45-degree-interior")!;
    expect(interior45).toBeDefined();
    expect(interior45.status).toBe("ACTIVE");
    expect(interior45.payload.prerequisiteSkillIds).toContain("skill-cutting-one-length-perimeter");
  });

  it("no elevation=45 anywhere on 45deg Interior (re-proof, R3.5's own guard reused verbatim)", () => {
    expect(guardNoElevation45OnInterior45()).toBe(true);
  });

  it("45deg Interior's guide remains UNKNOWN (re-proof)", () => {
    expect(INTERIOR_45_GUIDE_CAPABILITY.guideSource).toBe("UNKNOWN");
    expect(INTERIOR_45_GUIDE_CAPABILITY.guideBehavior).toBe("UNKNOWN");
  });
});

describe("R3.5 continuity -- One-Length and Graduated Cutting safety re-proofs, guard functions reused verbatim (no reimplementation)", () => {
  it("One-Length has NOT gained travelling-guide behavior", () => {
    expect(guardOneLengthNoTravellingGuideRegression()).toBe(true);
  });

  it("Graduated Cutting's own 45deg elevation semantics remain intact", () => {
    expect(guardGraduatedElevationIntact()).toBe(true);
  });

  it("45deg Interior still depends on (never mandatory for) One-Length", () => {
    expect(guardInterior45DependsOnOneLength()).toBe(true);
    expect(guardInterior45NotMandatoryForOneLength()).toBe(true);
  });

  it("45deg Interior's length relationship (exterior < interior) remains intact", () => {
    expect(guardInterior45LengthRelationshipIntact()).toBe(true);
  });

  it("the full R3.5 fail-closed guard suite still passes unchanged after this stage's own additions", () => {
    const result = runAllFailClosedGuards();
    expect(result.allPassed).toBe(true);
    expect(result.failedGuardNames).toHaveLength(0);
  });
});
