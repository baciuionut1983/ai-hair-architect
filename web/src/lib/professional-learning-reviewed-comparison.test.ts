import { describe, expect, it } from "vitest";

import { computeReviewedComparison } from "./professional-learning-reviewed-comparison";
import { createReferenceDependencyRelationship } from "./professional-learning-reference-dependency";
import { buildCanonicalCandidateSkillRegistry } from "./professional-brain-skill-templates";
import type { ProfessionalLearningExtraction } from "./professional-learning-draft-validators";
import type { ProfessionalSkillDefinitionRecord } from "./professional-skill-registry-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1.1 -- proves
// computeReviewedComparison is generic (parameter+capability driven),
// never hardcoded to "Blunt Bob"/"One-Length" by name, and never mutates
// or writes anything (pure function, no prisma import anywhere in the
// module under test).

const ONE_LENGTH_SKILL_ID = "skill-cutting-one-length-perimeter";

function extractionWith(fields: ProfessionalLearningExtraction): ProfessionalLearningExtraction {
  return fields;
}

describe("computeReviewedComparison (Stage 8.5L5.R1.1)", () => {
  const registry = buildCanonicalCandidateSkillRegistry();

  it("Section 29/46/47 -- 0 degrees elevation + BOTH guide-establishment AND guide-use relationships (Ionuț's real two-part correction) uniquely map to VARIATION_OF_EXISTING for Construct One-Length Perimeter", () => {
    const extraction = extractionWith({ elevation: { value: "0 degrees", source: "PROFESSIONAL_INPUT", confidence: 1 } });
    const establishesGuide = createReferenceDependencyRelationship({
      sourceEntity: { ref: "establish-guide-action", kind: "PROFESSIONAL_STATEMENT" },
      targetEntity: { ref: "guide-strand", kind: "PROFESSIONAL_STATEMENT" },
      relationshipType: "ESTABLISHES_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
    });
    const cutsToGuide = createReferenceDependencyRelationship({
      sourceEntity: { ref: "guide-strand", kind: "PROFESSIONAL_STATEMENT" },
      targetEntity: { ref: "next-strand", kind: "PROFESSIONAL_STATEMENT" },
      relationshipType: "CUTS_TO_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
    });

    const result = computeReviewedComparison(extraction, "POSSIBLE_NEW_SKILL", [establishesGuide, cutsToGuide], registry);

    expect(result.outcome).toBe("VARIATION_OF_EXISTING");
    expect(result.comparedSkillId).toBe(ONE_LENGTH_SKILL_ID);
    const finding = result.findings.find((f) => f.skillId === ONE_LENGTH_SKILL_ID);
    expect(finding?.parameterEvidence).toEqual([{ skillId: ONE_LENGTH_SKILL_ID, fieldName: "elevation", parameterName: "elevation" }]);
    expect(finding?.capabilityEvidence.length).toBe(2);
  });

  it("a SINGLE relationship type (guide-use only, without also establishing the guide) is honestly insufficient to break the tie against Occipital Transition, which shares the same fixed 0-degree elevation and CONNECT_ZONES capability", () => {
    const extraction = extractionWith({ elevation: { value: "0 degrees", source: "PROFESSIONAL_INPUT", confidence: 1 } });
    const cutsToGuide = createReferenceDependencyRelationship({
      sourceEntity: { ref: "guide-strand", kind: "PROFESSIONAL_STATEMENT" },
      targetEntity: { ref: "next-strand", kind: "PROFESSIONAL_STATEMENT" },
      relationshipType: "CUTS_TO_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
    });

    const result = computeReviewedComparison(extraction, "POSSIBLE_NEW_SKILL", [cutsToGuide], registry);

    // Honest tie -- never silently guesses which of the equally-supported
    // registry skills is meant.
    expect(result.outcome).toBe("EVIDENCE_FOR_EXISTING");
    expect(result.comparedSkillId).toBeNull();
    expect(result.reason).toContain(ONE_LENGTH_SKILL_ID);
  });

  it("parameter evidence alone (no established relationship) yields EVIDENCE_FOR_EXISTING with no single comparedSkillId (also tied across the elevation=0 family)", () => {
    const extraction = extractionWith({ elevation: { value: "0°", source: "PROFESSIONAL_INPUT", confidence: 1 } });
    const result = computeReviewedComparison(extraction, "POSSIBLE_NEW_SKILL", [], registry);

    expect(result.outcome).toBe("EVIDENCE_FOR_EXISTING");
    expect(result.comparedSkillId).toBeNull();
  });

  it("a parameter whose registry value is only one of SEVERAL allowed options (e.g. Graduated Cutting's own multi-phase elevation) never counts as parameter evidence -- only a FIXED, single-valued parameter does", () => {
    const extraction = extractionWith({ elevation: { value: "0 degrees", source: "PROFESSIONAL_INPUT" } });
    const result = computeReviewedComparison(extraction, "POSSIBLE_NEW_SKILL", [], registry);
    const graduatedFinding = result.findings.find((f) => f.skillId === "skill-cutting-graduated");
    expect(graduatedFinding?.parameterEvidence ?? []).toEqual([]);
  });

  it("an UNESTABLISHED relationship (e.g. temporal-adjacency-only, OBSERVED with no semanticSupport) contributes zero capability evidence", () => {
    const unestablished = createReferenceDependencyRelationship({
      sourceEntity: { ref: "a", kind: "ACTION" },
      targetEntity: { ref: "b", kind: "ACTION" },
      relationshipType: "CUTS_TO_REFERENCE",
      provenance: "OBSERVED",
    });
    const result = computeReviewedComparison({}, "POSSIBLE_NEW_SKILL", [unestablished], registry);
    expect(result.outcome).toBe("POSSIBLE_NEW_SKILL");
    expect(result.comparedSkillId).toBeNull();
  });

  it("no matching parameter or capability anywhere leaves the original outcome unchanged (still POSSIBLE_NEW_SKILL)", () => {
    const extraction = extractionWith({ tool: { value: "clippers", source: "PROFESSIONAL_INPUT" } });
    const result = computeReviewedComparison(extraction, "POSSIBLE_NEW_SKILL", [], registry);
    expect(result.outcome).toBe("POSSIBLE_NEW_SKILL");
    expect(result.comparedSkillId).toBeNull();
    expect(result.findings).toEqual([]);
  });

  it("Section 21 -- is a no-op when the original outcome was already confident (e.g. EVIDENCE_FOR_EXISTING), never overriding a settled result", () => {
    const extraction = extractionWith({ elevation: { value: "0°", source: "PROFESSIONAL_INPUT" } });
    const result = computeReviewedComparison(extraction, "EVIDENCE_FOR_EXISTING", [], registry);
    expect(result.outcome).toBe("EVIDENCE_FOR_EXISTING");
    expect(result.findings).toEqual([]);
  });

  it("only PROFESSIONAL_INPUT field claims count as reviewed parameter evidence -- an OBSERVED/INFERRED claim from the original blind pass is not double-counted here", () => {
    const extraction = extractionWith({ elevation: { value: "0 degrees", source: "OBSERVED", confidence: 0.9 } });
    const result = computeReviewedComparison(extraction, "POSSIBLE_NEW_SKILL", [], registry);
    expect(result.outcome).toBe("POSSIBLE_NEW_SKILL");
  });

  it("Section 18/22/23 -- generic reusability: the SAME function matches a completely different, made-up skill with no name/keyword rule involved", () => {
    const fakeSkill: ProfessionalSkillDefinitionRecord = {
      id: "row-1",
      skillId: "skill-fake-example",
      version: 1,
      vertical: "nails",
      name: "Some Unrelated Nail Technique",
      status: "ACTIVE",
      authorityType: "PROFESSIONALLY_AUTHORED",
      payload: {
        skillId: "skill-fake-example",
        version: 1,
        vertical: "nails",
        name: "Some Unrelated Nail Technique",
        description: "test fixture",
        status: "ACTIVE",
        authorityType: "PROFESSIONALLY_AUTHORED",
        rationale: "test fixture",
        parameters: [{ name: "cuttingAngle", valueKind: "enum", allowedValues: ["45_deg_bevel"], description: "test" }],
        procedure: [
          { order: 1, instruction: "step one" },
          { order: 2, instruction: "step two" },
        ],
        capabilities: [{ kind: "ESTABLISH_GUIDE" }],
        createdAt: new Date().toISOString(),
      },
      reviewedByUserId: null,
      reviewedAt: null,
      supersededBySkillDefinitionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const extraction = extractionWith({ cuttingAngle: { value: "45 degrees", source: "PROFESSIONAL_INPUT" } });
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: { ref: "x", kind: "PROFESSIONAL_STATEMENT" },
      targetEntity: { ref: "y", kind: "PROFESSIONAL_STATEMENT" },
      relationshipType: "ESTABLISHES_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
    });

    const result = computeReviewedComparison(extraction, "POSSIBLE_NEW_SKILL", [relationship], [fakeSkill]);

    expect(result.outcome).toBe("VARIATION_OF_EXISTING");
    expect(result.comparedSkillId).toBe("skill-fake-example");
  });

  it("never returns MATCH_EXISTING -- parameter+capability correspondence alone is never treated as a full match", () => {
    const extraction = extractionWith({ elevation: { value: "0°", source: "PROFESSIONAL_INPUT" } });
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: { ref: "a", kind: "PROFESSIONAL_STATEMENT" },
      targetEntity: { ref: "b", kind: "PROFESSIONAL_STATEMENT" },
      relationshipType: "CUTS_TO_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
    });
    const result = computeReviewedComparison(extraction, "POSSIBLE_NEW_SKILL", [relationship], registry);
    expect(result.outcome).not.toBe("MATCH_EXISTING");
  });
});
