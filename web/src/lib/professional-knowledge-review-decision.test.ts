import { describe, expect, it } from "vitest";

import {
  buildProfessionalReviewDecision,
  classifyProfessionalDecisionAssimilation,
  computeProfessionalReviewDecisionId,
  CONTEXTUAL_PREFERENCE_RELATIONS,
  isContextualPreferenceRelation,
  UNIVERSAL_RULE_RELATIONS,
  type ProfessionalReviewDecision,
} from "@/lib/professional-knowledge-review-decision";
import type { BoundClaim } from "@/lib/professional-knowledge-claim-binding";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.2 -- pure
// tests for the professional-decision-capture layer, no I/O, no
// database, no AI calls.

function boundClaim(overrides: Partial<BoundClaim> = {}): BoundClaim {
  return {
    claimId: "claim-1",
    claimType: "EXTRACTION_FIELD",
    fieldName: "techniqueCandidate",
    value: "point cutting",
    originalProvenance: "INFERRED",
    sourceIntervals: [],
    reviewConfirmation: "NOT_REVIEWED",
    confirmedByTheme: null,
    supportModality: "UNRESOLVED",
    ...overrides,
  };
}

function skill(overrides: Partial<SkillDefinition> = {}): ProfessionalSkillDefinitionRecord {
  const payload: SkillDefinition = {
    skillId: "skill-fictitious-1",
    version: 1,
    vertical: "hair_cutting",
    name: "Fictitious",
    description: "test",
    status: "ACTIVE",
    authorityType: "PROFESSIONALLY_AUTHORED",
    rationale: "test",
    parameters: [],
    procedure: [
      { order: 1, instruction: "a" },
      { order: 2, instruction: "b" },
    ],
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
  return {
    id: `registry-${payload.skillId}`,
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

describe("professional-knowledge-review-decision: types and construction", () => {
  it("Section 'NON-NEGOTIABLE SEMANTIC RULE': contextual and universal-rule vocabularies are structurally disjoint sets", () => {
    for (const relation of CONTEXTUAL_PREFERENCE_RELATIONS) expect((UNIVERSAL_RULE_RELATIONS as readonly string[]).includes(relation)).toBe(false);
    for (const relation of UNIVERSAL_RULE_RELATIONS) expect(isContextualPreferenceRelation(relation)).toBe(false);
  });

  it("test 1: an AI-inferred claim + professional CONFIRMATION preserves BOTH the original AI provenance and the professional decision, never merging them", () => {
    const claim = boundClaim({ value: "mobile guide", originalProvenance: "INFERRED" });
    const decision = buildProfessionalReviewDecision({
      sourceEvidenceId: "ev-1",
      reviewId: "review-1",
      approvedResultHash: "hash-1",
      reviewItemLabel: "#2",
      decisionType: "CONFIRMATION",
      boundClaim: claim,
      professionalValue: "mobile guide -- previously cut strand used as the guide",
      professionalNote: "Confirmed: the guide travels through the haircut.",
    });
    expect(decision.originalAIClaim).toEqual({ value: "mobile guide", provenance: "INFERRED" });
    expect(decision.professionalValue).toBe("mobile guide -- previously cut strand used as the guide");
    expect(decision.decisionType).toBe("CONFIRMATION");
  });

  it("test 2: a professional CORRECTION never rewrites the original AI claim -- both remain independently inspectable", () => {
    const claim = boundClaim({ value: "point cutting", originalProvenance: "INFERRED" });
    const decision = buildProfessionalReviewDecision({
      sourceEvidenceId: "ev-1",
      reviewId: "review-1",
      approvedResultHash: "hash-1",
      reviewItemLabel: "#7",
      decisionType: "CORRECTION",
      boundClaim: claim,
      professionalValue: "DEEP_POINT_CUT",
      professionalNote: "More precisely: deep point cut -- scissors penetrate deeper into the ends.",
      technique: { techniqueId: "deep-point-cut", label: "Deep Point Cut", familyId: "point-cutting-family", relatedTechniqueIds: ["point-cut"], distinctFrom: ["skill-cutting-slice-and-slide-refinement"] },
    });
    expect(decision.originalAIClaim?.value).toBe("point cutting"); // untouched
    expect(decision.professionalValue).toBe("DEEP_POINT_CUT");
    expect(decision.technique?.techniqueId).toBe("deep-point-cut");
  });

  it("test 3: Deep Point Cut's technique identity is never aliased to Slice-and-Slide -- distinctFrom names it explicitly", () => {
    const decision = buildProfessionalReviewDecision({
      sourceEvidenceId: "ev-1",
      reviewId: "review-1",
      approvedResultHash: "hash-1",
      reviewItemLabel: "#7",
      decisionType: "CORRECTION",
      boundClaim: boundClaim(),
      professionalValue: "DEEP_POINT_CUT",
      professionalNote: "test",
      technique: { techniqueId: "deep-point-cut", label: "Deep Point Cut", distinctFrom: ["skill-cutting-slice-and-slide-refinement"] },
    });
    expect(decision.technique?.distinctFrom).toContain("skill-cutting-slice-and-slide-refinement");
  });

  it("test 9: a pure ADDITION (Channel Cut) is valid with originalAIClaim explicitly null -- no BoundClaim required or permitted", () => {
    const decision = buildProfessionalReviewDecision({
      sourceEvidenceId: "ev-1",
      reviewId: "review-1",
      approvedResultHash: "hash-1",
      reviewItemLabel: "#13",
      decisionType: "ADDITION",
      professionalValue: "CHANNEL_CUT",
      professionalNote: "AI extraction did not identify this technique.",
    });
    expect(decision.originalAIClaim).toBeNull();
    expect(decision.boundClaimId).toBeNull();
  });

  it("fails closed: an ADDITION may never wrap a BoundClaim, and a CONFIRMATION/CORRECTION may never omit one", () => {
    expect(() =>
      buildProfessionalReviewDecision({ sourceEvidenceId: "ev-1", reviewId: "review-1", approvedResultHash: "hash-1", reviewItemLabel: "#x", decisionType: "ADDITION", boundClaim: boundClaim(), professionalValue: "x", professionalNote: "x" }),
    ).toThrow();
    expect(() => buildProfessionalReviewDecision({ sourceEvidenceId: "ev-1", reviewId: "review-1", approvedResultHash: "hash-1", reviewItemLabel: "#x", decisionType: "CONFIRMATION", professionalValue: "x", professionalNote: "x" })).toThrow();
  });

  it("test 10: a professional addition can retain a source interval explicitly marked as professional-estimated, never presented as AI-detected", () => {
    const decision = buildProfessionalReviewDecision({
      sourceEvidenceId: "ev-1",
      reviewId: "review-1",
      approvedResultHash: "hash-1",
      reviewItemLabel: "#13",
      decisionType: "ADDITION",
      professionalValue: "CHANNEL_CUT",
      professionalNote: "test",
      sourceIntervals: [{ timeStartSeconds: 557, timeEndSeconds: 571, estimatedByProfessional: true }],
    });
    expect(decision.sourceIntervals[0].estimatedByProfessional).toBe(true);
  });

  it("test 13: unknown numeric geometry stays UNKNOWN -- unknownFields never contains a fabricated numeric value, only labels", () => {
    const decision = buildProfessionalReviewDecision({
      sourceEvidenceId: "ev-1",
      reviewId: "review-1",
      approvedResultHash: "hash-1",
      reviewItemLabel: "#4",
      decisionType: "CONFIRMATION",
      boundClaim: boundClaim(),
      professionalValue: "stationary guide + overdirection",
      professionalNote: "test",
      unknownFields: ["exact overdirection angle", "exact diagonal geometry"],
    });
    for (const field of decision.unknownFields) expect(field).not.toMatch(/\d/);
  });

  it("determinism: identical inputs produce identical decision ids; changed professionalValue changes the id", () => {
    const a = computeProfessionalReviewDecisionId("ev-1", "hash-1", "#2", "mobile guide");
    const b = computeProfessionalReviewDecisionId("ev-1", "hash-1", "#2", "mobile guide");
    const c = computeProfessionalReviewDecisionId("ev-1", "hash-1", "#2", "stationary guide");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("professional-knowledge-review-decision: classifyProfessionalDecisionAssimilation", () => {
  it("test 9 (classifier): an ADDITION always classifies as PROFESSIONAL_ADDITION_PENDING_REVIEW, regardless of registry content", () => {
    const decision: ProfessionalReviewDecision = buildProfessionalReviewDecision({
      sourceEvidenceId: "ev-1",
      reviewId: "review-1",
      approvedResultHash: "hash-1",
      reviewItemLabel: "#13",
      decisionType: "ADDITION",
      professionalValue: "CHANNEL_CUT",
      professionalNote: "test",
    });
    const result = classifyProfessionalDecisionAssimilation({ decision, registry: [skill({ capabilities: [{ kind: "REFINE_ENDS" }] })], impliedCapability: "REFINE_ENDS" });
    expect(result.outcome).toBe("PROFESSIONAL_ADDITION_PENDING_REVIEW");
    expect(result.comparedSkillId).toBeNull();
  });

  it("test 5/6: a contextual-only decision (no known technical field) classifies as PROPOSE_CONTEXTUAL_PREFERENCE -- never a capability match, and 'commonly used for' never becomes a registry attachment", () => {
    const decision = buildProfessionalReviewDecision({
      sourceEvidenceId: "ev-1",
      reviewId: "review-1",
      approvedResultHash: "hash-1",
      reviewItemLabel: "#13",
      decisionType: "ADDITION",
      professionalValue: "CHANNEL_CUT",
      professionalNote: "test",
    });
    // Re-derive as CONFIRMATION-shaped to exercise the contextual-only
    // branch specifically (ADDITION always short-circuits above).
    const confirmationShaped: ProfessionalReviewDecision = { ...decision, decisionType: "CONFIRMATION", boundClaimId: "claim-1", contextualKnowledge: [{ relation: "COMMONLY_USED_FOR", subject: "SHORT_HAIR", note: "common practice, not a rule" }] };
    const result = classifyProfessionalDecisionAssimilation({ decision: confirmationShaped, registry: [], impliedCapability: undefined });
    expect(result.outcome).toBe("PROPOSE_CONTEXTUAL_PREFERENCE");
  });

  it("test 4: the same impliedCapability can be shared by two DIFFERENT techniques without forcing them into the same skill -- distinctFrom keeps them as separate proposals", () => {
    const registrySkill = skill({ skillId: "skill-cutting-slice-and-slide-refinement", capabilities: [{ kind: "REFINE_ENDS" }] });
    const sliceAndSlideDecision = buildProfessionalReviewDecision({ sourceEvidenceId: "ev-1", reviewId: "review-1", approvedResultHash: "hash-1", reviewItemLabel: "#x", decisionType: "CONFIRMATION", boundClaim: boundClaim(), professionalValue: "slice and slide", professionalNote: "t", knownFields: ["fingers-held"] });
    const channelCutDecision: ProfessionalReviewDecision = {
      ...buildProfessionalReviewDecision({ sourceEvidenceId: "ev-1", reviewId: "review-1", approvedResultHash: "hash-1", reviewItemLabel: "#13", decisionType: "ADDITION", professionalValue: "CHANNEL_CUT", professionalNote: "t", knownFields: ["natural-fall"] }),
      decisionType: "CORRECTION",
      boundClaimId: "claim-x",
      technique: { techniqueId: "channel-cut", label: "Channel Cut", distinctFrom: ["skill-cutting-slice-and-slide-refinement"] },
    };

    const slideResult = classifyProfessionalDecisionAssimilation({ decision: sliceAndSlideDecision, registry: [registrySkill], impliedCapability: "REFINE_ENDS" });
    const channelResult = classifyProfessionalDecisionAssimilation({ decision: channelCutDecision, registry: [registrySkill], impliedCapability: "REFINE_ENDS" });

    expect(slideResult.outcome).toBe("EXTEND_EXISTING_CAPABILITY");
    expect(slideResult.comparedSkillId).toBe("skill-cutting-slice-and-slide-refinement");
    expect(channelResult.outcome).toBe("PROPOSE_TECHNIQUE_VARIANT"); // same capability, but distinctFrom keeps it separate
    expect(channelResult.comparedSkillId).toBe("skill-cutting-slice-and-slide-refinement");
    expect(channelResult.outcome).not.toBe(slideResult.outcome);
  });

  it("test 11: when NO registry skill declares the capability at all, and the technique is distinct from a named (absent-match) skill, the outcome is PROPOSE_NEW_SKILL, never a forced variant", () => {
    const decision: ProfessionalReviewDecision = {
      ...buildProfessionalReviewDecision({ sourceEvidenceId: "ev-1", reviewId: "review-1", approvedResultHash: "hash-1", reviewItemLabel: "#13", decisionType: "ADDITION", professionalValue: "CHANNEL_CUT", professionalNote: "t", knownFields: ["natural-fall"] }),
      decisionType: "CORRECTION",
      boundClaimId: "claim-x",
      technique: { techniqueId: "channel-cut", label: "Channel Cut", distinctFrom: ["skill-cutting-slice-and-slide-refinement"] },
    };
    const result = classifyProfessionalDecisionAssimilation({ decision, registry: [], impliedCapability: "REFINE_ENDS" });
    expect(result.outcome).toBe("PROPOSE_NEW_SKILL");
  });

  it("KEEP_UNKNOWN when a decision has no known fields and no contextual knowledge", () => {
    const decision = buildProfessionalReviewDecision({ sourceEvidenceId: "ev-1", reviewId: "review-1", approvedResultHash: "hash-1", reviewItemLabel: "#x", decisionType: "CONFIRMATION", boundClaim: boundClaim(), professionalValue: "unclear", professionalNote: "t", unknownFields: ["exact geometry"] });
    const result = classifyProfessionalDecisionAssimilation({ decision, registry: [], impliedCapability: "REFINE_ENDS" });
    expect(result.outcome).toBe("KEEP_UNKNOWN");
  });

  it("NO_ASSIMILATION when a decision has a known field but no capability was supplied for comparison", () => {
    const decision = buildProfessionalReviewDecision({ sourceEvidenceId: "ev-1", reviewId: "review-1", approvedResultHash: "hash-1", reviewItemLabel: "#x", decisionType: "CONFIRMATION", boundClaim: boundClaim(), professionalValue: "v", professionalNote: "t", knownFields: ["something"] });
    const result = classifyProfessionalDecisionAssimilation({ decision, registry: [], impliedCapability: undefined });
    expect(result.outcome).toBe("NO_ASSIMILATION");
  });

  it("classification never mutates the registry array passed in (zero side effects)", () => {
    const registry = [skill({ capabilities: [{ kind: "REFINE_ENDS" }] })];
    const snapshot = JSON.stringify(registry);
    const decision = buildProfessionalReviewDecision({ sourceEvidenceId: "ev-1", reviewId: "review-1", approvedResultHash: "hash-1", reviewItemLabel: "#x", decisionType: "CONFIRMATION", boundClaim: boundClaim(), professionalValue: "v", professionalNote: "t", knownFields: ["x"] });
    classifyProfessionalDecisionAssimilation({ decision, registry, impliedCapability: "REFINE_ENDS" });
    expect(JSON.stringify(registry)).toBe(snapshot);
  });
});
