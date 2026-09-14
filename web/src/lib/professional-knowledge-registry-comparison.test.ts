import { describe, expect, it } from "vitest";

import {
  compareKnowledgeUnitAgainstRegistry,
  computeRegistryContextHash,
  isProposalStaleAgainstRegistry,
} from "@/lib/professional-knowledge-registry-comparison";
import type { ProfessionalKnowledgeUnit } from "@/lib/professional-knowledge-unit";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import { createReferenceDependencyRelationship, type ReferenceDependencyRelationship } from "@/lib/professional-learning-reference-dependency";
import type { BoundClaim } from "@/lib/professional-knowledge-claim-binding";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 -- pure
// registry-comparison tests, no I/O, no database, no AI calls, ZERO
// registry writes. Never relies on real registry skills or real haircut
// names (Section 27/32/65) -- every fixture here is fictitious, including
// one deliberately NON-HAIR fixture (Section 65) proving the comparison
// core is domain-general.

function baseUnit(overrides: Partial<ProfessionalKnowledgeUnit> = {}): ProfessionalKnowledgeUnit {
  return {
    id: "unit-1",
    type: "EXECUTION_CAPABILITY",
    sourceEvidenceId: "ev-1",
    reviewId: "review-1",
    approvedResultHash: "hash-1",
    assimilationVersion: "v1",
    domain: "hair_cutting",
    label: "CUTTING_ACTION pattern observed in window 0",
    sourceIntervals: [],
    supportingActionCandidateIds: [],
    occurrenceCount: 2,
    knownFields: {},
    referenceRelationshipIds: [],
    evidenceSupport: "PARTIALLY_SUPPORTED",
    ...overrides,
  };
}

function skill(overrides: Partial<SkillDefinition> = {}): ProfessionalSkillDefinitionRecord {
  const payload: SkillDefinition = {
    skillId: "skill-fictitious-1",
    version: 1,
    vertical: "hair_cutting",
    name: "Fictitious Test Skill",
    description: "A fictitious skill used only for deterministic comparison tests.",
    status: "ACTIVE",
    authorityType: "PROFESSIONALLY_AUTHORED",
    rationale: "test fixture",
    parameters: [],
    procedure: [
      { order: 1, instruction: "step one" },
      { order: 2, instruction: "step two" },
    ],
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
  return {
    id: `registry-${payload.skillId}-v${payload.version}`,
    skillId: payload.skillId,
    version: payload.version,
    vertical: payload.vertical,
    name: payload.name,
    status: payload.status,
    authorityType: payload.authorityType,
    payload,
    reviewedByUserId: null,
    reviewedAt: null,
    supersededBySkillDefinitionId: null,
    createdAt: payload.createdAt,
    updatedAt: payload.createdAt,
  };
}

describe("professional-knowledge-registry-comparison", () => {
  it("Section 38: zero evidence -> INSUFFICIENT_FOR_ASSIMILATION (never forced)", () => {
    const result = compareKnowledgeUnitAgainstRegistry(baseUnit(), [], [skill()]);
    expect(result.outcome).toBe("INSUFFICIENT_FOR_ASSIMILATION");
    expect(result.comparedSkillId).toBeNull();
  });

  it("Section 33: a PROFESSIONAL_INPUT field matching a skill's own single fixed parameter -> ATTACH_EVIDENCE_TO_EXISTING", () => {
    const registrySkill = skill({ parameters: [{ name: "elevation", valueKind: "enum", allowedValues: ["0 degrees"], description: "test" }] });
    const unit = baseUnit({ knownFields: { elevation: { value: "0 degrees", source: "PROFESSIONAL_INPUT", confidence: 1 } } });
    const result = compareKnowledgeUnitAgainstRegistry(unit, [], [registrySkill]);
    expect(result.outcome).toBe("ATTACH_EVIDENCE_TO_EXISTING");
    expect(result.comparedSkillId).toBe(registrySkill.skillId);
  });

  it("an OBSERVED (not PROFESSIONAL_INPUT) field never counts as comparison evidence", () => {
    const registrySkill = skill({ parameters: [{ name: "elevation", valueKind: "enum", allowedValues: ["0 degrees"], description: "test" }] });
    const unit = baseUnit({ knownFields: { elevation: { value: "0 degrees", source: "OBSERVED" } } });
    const result = compareKnowledgeUnitAgainstRegistry(unit, [], [registrySkill]);
    expect(result.outcome).toBe("INSUFFICIENT_FOR_ASSIMILATION");
  });

  it("Section 34: BOTH parameter evidence and capability evidence -> PROPOSE_VARIATION_OF_EXISTING, never a clone", () => {
    const registrySkill = skill({
      parameters: [{ name: "elevation", valueKind: "enum", allowedValues: ["90 degrees"], description: "test" }],
      capabilities: [{ kind: "ESTABLISH_GUIDE" }],
    });
    const unit = baseUnit({ knownFields: { elevation: { value: "90 degrees", source: "PROFESSIONAL_INPUT", confidence: 1 } }, referenceRelationshipIds: ["rel-1"] });
    const relationship: ReferenceDependencyRelationship = createReferenceDependencyRelationship({
      sourceEntity: { ref: "obs-1", kind: "OBSERVATION" },
      targetEntity: { ref: "unspecified", kind: "UNSPECIFIED" },
      relationshipType: "ESTABLISHES_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
    });
    const result = compareKnowledgeUnitAgainstRegistry(unit, [relationship], [registrySkill]);
    expect(result.outcome).toBe("PROPOSE_VARIATION_OF_EXISTING");
    expect(result.comparedSkillId).toBe(registrySkill.skillId);
  });

  it("Section 36: a professionally-authored value that CONTRADICTS the skill's own fixed parameter -> POSSIBLE_CONFLICT_WITH_EXISTING, never auto-resolved", () => {
    const registrySkill = skill({ parameters: [{ name: "elevation", valueKind: "enum", allowedValues: ["0 degrees"], description: "test" }] });
    const unit = baseUnit({ knownFields: { elevation: { value: "90 degrees", source: "PROFESSIONAL_INPUT", confidence: 1 } } });
    const result = compareKnowledgeUnitAgainstRegistry(unit, [], [registrySkill]);
    expect(result.outcome).toBe("POSSIBLE_CONFLICT_WITH_EXISTING");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].proposedValue).toBe("90 degrees");
  });

  it("a genuine tie between two equally-supported skills -> ATTACH_EVIDENCE_TO_EXISTING with comparedSkillId left null (never a false unique pick)", () => {
    const skillA = skill({ skillId: "skill-a", parameters: [{ name: "elevation", valueKind: "enum", allowedValues: ["0 degrees"], description: "t" }] });
    const skillB = skill({ skillId: "skill-b", parameters: [{ name: "elevation", valueKind: "enum", allowedValues: ["0 degrees"], description: "t" }] });
    const unit = baseUnit({ knownFields: { elevation: { value: "0 degrees", source: "PROFESSIONAL_INPUT", confidence: 1 } } });
    const result = compareKnowledgeUnitAgainstRegistry(unit, [], [skillA, skillB]);
    expect(result.outcome).toBe("ATTACH_EVIDENCE_TO_EXISTING");
    expect(result.comparedSkillId).toBeNull();
  });

  it("Section 20: a REFERENCE_RELATIONSHIP unit backed by an UNESTABLISHED relationship is always INSUFFICIENT, regardless of registry content", () => {
    const registrySkill = skill({ capabilities: [{ kind: "ESTABLISH_GUIDE" }] });
    const unestablished = createReferenceDependencyRelationship({
      sourceEntity: { ref: "obs-1", kind: "OBSERVATION" },
      targetEntity: { ref: "unspecified", kind: "UNSPECIFIED" },
      relationshipType: "ESTABLISHES_REFERENCE",
      provenance: "INFERRED", // no semanticSupport -> never established
    });
    const unit = baseUnit({ type: "REFERENCE_RELATIONSHIP", referenceRelationshipIds: [unestablished.id] });
    const result = compareKnowledgeUnitAgainstRegistry(unit, [unestablished], [registrySkill]);
    expect(result.outcome).toBe("INSUFFICIENT_FOR_ASSIMILATION");
  });

  it("Section 65: cross-domain generic fixture -- a fictitious NAILS capability compares identically through the same generic core (never a hair-only code path)", () => {
    const nailsSkill = skill({
      skillId: "skill-fictitious-nails-cross-check",
      vertical: "nails",
      name: "Fictitious Nails Cross-Check",
      capabilities: [{ kind: "CONNECT_ZONES" }],
    });
    const nailsRelationship = createReferenceDependencyRelationship({
      sourceEntity: { ref: "obs-nails-1", kind: "OBSERVATION" },
      targetEntity: { ref: "unspecified", kind: "UNSPECIFIED" },
      relationshipType: "USES_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
    });
    const nailsUnit = baseUnit({ id: "unit-nails-1", domain: "nails", type: "VALIDATION_RULE", referenceRelationshipIds: [nailsRelationship.id] });
    const result = compareKnowledgeUnitAgainstRegistry(nailsUnit, [nailsRelationship], [nailsSkill]);
    expect(result.outcome).toBe("ATTACH_EVIDENCE_TO_EXISTING");
    expect(result.comparedSkillId).toBe(nailsSkill.skillId);
  });

  it("Section 62: computeRegistryContextHash is order-independent and stable", () => {
    const skillA = skill({ skillId: "skill-a" });
    const skillB = skill({ skillId: "skill-b" });
    expect(computeRegistryContextHash([skillA, skillB])).toBe(computeRegistryContextHash([skillB, skillA]));
  });

  it("Section 62-63: a changed registry produces a different context hash, detected as stale", () => {
    const skillA = skill({ skillId: "skill-a" });
    const before = computeRegistryContextHash([skillA]);
    const skillAChanged = skill({ skillId: "skill-a", version: 2 });
    const after = computeRegistryContextHash([skillAChanged]);
    expect(before).not.toBe(after);
    expect(isProposalStaleAgainstRegistry(before, after)).toBe(true);
    expect(isProposalStaleAgainstRegistry(before, before)).toBe(false);
  });

  // Stage 8.5L5.R3.1 (Section 30/31): a PROFESSIONALLY_CONFIRMED claim
  // binding may strengthen an otherwise-insufficient unit, tagged with a
  // distinct `via` so it is never confused with a real PROFESSIONAL_INPUT
  // correction.
  function confirmedClaim(overrides: Partial<BoundClaim> = {}): BoundClaim {
    return {
      claimId: "claim-1",
      claimType: "EXTRACTION_FIELD",
      fieldName: "elevation",
      value: "0 degrees",
      originalProvenance: "INFERRED",
      sourceIntervals: [],
      reviewConfirmation: "PROFESSIONALLY_CONFIRMED",
      confirmedByTheme: "progressive_elevation",
      supportModality: "AUDIO_NARRATION",
      ...overrides,
    };
  }

  it("Section 31: with zero confirmed claims, an otherwise-unsupported unit is INSUFFICIENT; the SAME unit with a matching confirmed claim becomes ATTACH_EVIDENCE_TO_EXISTING", () => {
    const registrySkill = skill({ parameters: [{ name: "elevation", valueKind: "enum", allowedValues: ["0 degrees"], description: "test" }] });
    const unit = baseUnit(); // knownFields stays {} -- no PROFESSIONAL_INPUT correction exists

    const withoutConfirmation = compareKnowledgeUnitAgainstRegistry(unit, [], [registrySkill], []);
    expect(withoutConfirmation.outcome).toBe("INSUFFICIENT_FOR_ASSIMILATION");

    const withConfirmation = compareKnowledgeUnitAgainstRegistry(unit, [], [registrySkill], [confirmedClaim()]);
    expect(withConfirmation.outcome).toBe("ATTACH_EVIDENCE_TO_EXISTING");
    expect(withConfirmation.parameterEvidence[0].via).toBe("PROFESSIONAL_REVIEW_CONFIRMATION");
  });

  it("Section 32: a confirmed claim strengthens eligibility for THAT field only -- it never fabricates evidence for an unrelated parameter", () => {
    const registrySkill = skill({ parameters: [{ name: "distribution", valueKind: "enum", allowedValues: ["natural fall"], description: "test" }] });
    const unit = baseUnit();
    const result = compareKnowledgeUnitAgainstRegistry(unit, [], [registrySkill], [confirmedClaim()]); // confirmed claim is for "elevation", skill wants "distribution"
    expect(result.outcome).toBe("INSUFFICIENT_FOR_ASSIMILATION");
  });

  it("a claim that is NOT_REVIEWED (no matching theme) never counts as comparison evidence, even if its value would otherwise match", () => {
    const registrySkill = skill({ parameters: [{ name: "elevation", valueKind: "enum", allowedValues: ["0 degrees"], description: "test" }] });
    const unit = baseUnit();
    const result = compareKnowledgeUnitAgainstRegistry(unit, [], [registrySkill], [confirmedClaim({ reviewConfirmation: "NOT_REVIEWED", confirmedByTheme: null })]);
    expect(result.outcome).toBe("INSUFFICIENT_FOR_ASSIMILATION");
  });
});
