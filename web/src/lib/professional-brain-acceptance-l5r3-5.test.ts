import { describe, expect, it } from "vitest";

import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { buildRealAssimilationPlan } from "@/lib/professional-knowledge-assimilation-l5r3-4-real-plan";
import { buildGuideRelationshipCapability } from "@/lib/professional-skill-guide-relationship-contracts";
import { GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { INTERIOR_45_SKILL } from "@/lib/cutting-skill-45-degree-interior";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.5 --
// PROFESSIONAL BRAIN ACCEPTANCE TEST. Deterministic READ-ONLY capability
// queries against the resulting local Professional Skill Registry. NO
// LLM, NO provider, NO network -- every query below is a plain,
// structural filter/find over already-validated, already-approved data.

describe("Query A: completed One-Length + want terminations to curve inward", () => {
  it("resolves to 45deg Interior, with prerequisite = completed One-Length and target effect = inward terminal curvature", () => {
    const registry = buildCanonicalCandidateSkillRegistry();
    const match = registry.find((r) => r.skillId === "skill-cutting-45-degree-interior")!;
    expect(match).toBeDefined();
    expect(match.status).toBe("ACTIVE");
    expect(match.payload.prerequisiteSkillIds).toContain("skill-cutting-one-length-perimeter");
    expect(match.payload.description.toLowerCase()).toMatch(/inward/);
    // No other active skill claims this same prerequisite+effect combination.
    const others = registry.filter((r) => r.skillId !== match.skillId);
    for (const other of others) expect((other.payload.description ?? "").toLowerCase()).not.toMatch(/inward terminal curvature|turn inward/);
  });
});

describe("Query B: terminal weight reduction -- must not collapse Deep Point Cut / Slice-and-Slide / Channel Cut", () => {
  it("the ACTIVE registry today answers only partially (Slice-and-Slide + 45deg Interior share REFINE_ENDS, both real, distinct skills) -- honestly, never fabricating registry membership for pending techniques", () => {
    const registry = buildCanonicalCandidateSkillRegistry();
    const refineEndsSkills = registry.filter((r) => (r.payload.capabilities ?? []).some((c) => c.kind === "REFINE_ENDS"));
    const ids = refineEndsSkills.map((r) => r.skillId);
    expect(ids).toContain("skill-cutting-slice-and-slide-refinement");
    expect(ids).toContain("skill-cutting-45-degree-interior");
    expect(new Set(ids).size).toBe(ids.length); // never aliased/duplicated
  });

  it("the PENDING proposal layer's own approved effect relationship names three DISTINCT, never-aliased techniqueIds for the related effect", () => {
    const plan = buildRealAssimilationPlan();
    const effectMutation = plan.mutationSet.find((m) => m.operation === "ADD_EFFECT_RELATIONSHIP")!;
    const relatedIds = effectMutation.fieldsAdded.filter((f) => f.name === "relatedTechniqueId").map((f) => f.value);
    expect(relatedIds).toEqual(["deep-point-cut", "channel-cut", "skill-cutting-slice-and-slide-refinement"]);
    expect(new Set(relatedIds).size).toBe(3); // no aliasing
    expect(effectMutation.proposedIdentity).toBeNull(); // an effect relationship never itself proposes a merged identity
  });
});

describe("Query C: lower termination correction/alignment -- Point Cut, never generic texturization", () => {
  it("Point Cut is represented (in the still-pending proposal layer) as a technique/purpose combination, with purpose ALIGNMENT_CORRECTION, distinct from Deep Point Cut's TEXTURIZATION_WEIGHT_REDUCTION", () => {
    const plan = buildRealAssimilationPlan();
    const pointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "point-cut")!;
    const deepPointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "deep-point-cut")!;
    expect(pointCut.proposedIdentity?.purpose).toBe("ALIGNMENT_CORRECTION");
    expect(deepPointCut.proposedIdentity?.purpose).toBe("TEXTURIZATION_WEIGHT_REDUCTION");
    expect(pointCut.proposedIdentity?.purpose).not.toBe(deepPointCut.proposedIdentity?.purpose);
  });

  it("Point Cut is honestly NOT yet in the ACTIVE registry -- the brain must never imply it is generically active/universal texturization authority", () => {
    const registry = buildCanonicalCandidateSkillRegistry();
    expect(registry.some((r) => r.skillId === "point-cut" || r.skillId.includes("point-cut"))).toBe(false);
  });
});

describe("Query D: 'previously cut strand is the reference' -- must NOT auto-conclude travelling guide", () => {
  it("a source-only guide capability (PREVIOUSLY_CUT_SECTION, no independently established behavior) resolves guideBehavior to UNKNOWN, never TRAVELLING or STATIONARY", () => {
    const capability = buildGuideRelationshipCapability({ guideSource: "PREVIOUSLY_CUT_SECTION" });
    expect(capability.guideBehavior).toBe("UNKNOWN");
    expect(capability.guideBehavior).not.toBe("TRAVELLING");
    expect(capability.guideBehavior).not.toBe("STATIONARY");
  });
});

describe("Query E: '45 degrees' alone -- the brain must NOT know what dimension is meant from the number alone", () => {
  it("searching the ACTIVE registry for the literal value/fact '45' surfaces TWO structurally different parameter names, never one collapsed meaning", () => {
    const registry = buildCanonicalCandidateSkillRegistry();
    const matches: { skillId: string; parameterName: string }[] = [];
    for (const record of registry) {
      for (const parameter of record.payload.parameters) {
        const values = (parameter.allowedValues ?? []).map((v) => String(v));
        if (values.some((v) => v.includes("45"))) matches.push({ skillId: record.skillId, parameterName: parameter.name });
      }
    }
    const graduatedMatch = matches.find((m) => m.skillId === GRADUATED_CUTTING_SKILL.skillId)!;
    const interiorMatch = matches.find((m) => m.skillId === INTERIOR_45_SKILL.skillId)!;
    expect(graduatedMatch).toBeDefined();
    expect(interiorMatch).toBeDefined();
    expect(graduatedMatch.parameterName).toBe("elevation");
    expect(interiorMatch.parameterName).toBe("terminalCuttingLineAngle");
    expect(graduatedMatch.parameterName).not.toBe(interiorMatch.parameterName);
  });
});
