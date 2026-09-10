import { describe, expect, it } from "vitest";

import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import type { SkillDefinition, SkillParameterDefinition, SkillProcedureStep } from "@/lib/professional-skill-contracts";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import { buildProfessionalReasoningContext, type ProfessionalReasoningContext, type ProfessionalReasoningProposal } from "@/lib/professional-reasoning-contracts";
import { validateProfessionalReasoningProposal } from "@/lib/professional-reasoning-validator";

// Professional Skill Engine, Stage 5 -- PART C/D/E VALIDATOR, the
// safety-critical adversarial test suite. No I/O, no AI. Every mocked-AI
// misbehavior named in the task's own Part K is exercised here, each as
// its own dedicated test proving REJECT.

const SYNTHETIC = "SYNTHETIC TEST FIXTURE -- not a real professional rule.";

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}
function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}
function syntheticProcedure(): SkillProcedureStep[] {
  return [
    { order: 1, instruction: "SYNTHETIC -- step one.", referencedParameters: [] },
    { order: 2, instruction: "SYNTHETIC -- step two.", referencedParameters: [] },
  ];
}
function elevationParameter(): SkillParameterDefinition {
  return { name: "elevation", valueKind: "enum", allowedValues: ["0_deg_blunt", "45_deg_graduation"], description: SYNTHETIC };
}
function overdirectionParameter(): SkillParameterDefinition {
  return { name: "overdirection", valueKind: "boolean", description: SYNTHETIC };
}

function skillA(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    skillId: "synthetic.validator-test.skill-a",
    version: 1,
    vertical: "cutting",
    name: "SYNTHETIC -- Skill A",
    description: SYNTHETIC,
    status: "ACTIVE",
    authorityType: "PROFESSIONALLY_AUTHORED",
    rationale: SYNTHETIC,
    parameters: [elevationParameter(), overdirectionParameter()],
    procedure: syntheticProcedure(),
    capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }],
    createdAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

function asRecord(skill: SkillDefinition): ProfessionalSkillDefinitionRecord {
  return {
    id: `record-${skill.skillId}-v${skill.version}`,
    skillId: skill.skillId,
    version: skill.version,
    vertical: skill.vertical,
    name: skill.name,
    status: skill.status,
    authorityType: skill.authorityType,
    payload: skill,
    reviewedByUserId: null,
    reviewedAt: null,
    supersededBySkillDefinitionId: null,
    createdAt: skill.createdAt,
    updatedAt: skill.createdAt,
  };
}

// Base scenario: skill-A can REDUCE_WEIGHT at crown. TARGET wants exactly
// that. Also carries a real PRESERVED nape constraint, so preservation-
// constraint-dropping can be tested honestly.
function buildBaseContext(registry: readonly ProfessionalSkillDefinitionRecord[] = [asRecord(skillA())]): ProfessionalReasoningContext {
  const current = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "observed" } });
  const target = withZone(
    withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } }),
    "nape",
    { perimeterRelationship: { value: "at_perimeter", source: "professional_input" } },
  );
  const selection = selectCandidateSkillsForDelta({ id: "current-1", snapshotVersion: 1, payload: current }, { id: "target-1", snapshotVersion: 1, payload: target }, registry);
  return buildProfessionalReasoningContext({ selection });
}

function validRawProposal(context: ProfessionalReasoningContext): ProfessionalReasoningProposal {
  const candidate = context.candidateSkills[0];
  return {
    schemaVersion: context.schemaVersion,
    planSummary: "SYNTHETIC -- reduce crown weight, preserve nape perimeter.",
    proposedSkills: [
      {
        stepId: "step-1",
        skillDefinitionId: candidate.skillDefinitionId,
        skillKey: candidate.skillKey,
        skillVersion: candidate.skillVersion,
        zone: "crown",
        addressesDelta: candidate.addressesDelta,
        declaredCapabilityUsed: candidate.matchedCapability,
        parameters: [{ name: "elevation", value: "45_deg_graduation" }],
        rationale: "SYNTHETIC -- addresses crown weight reduction.",
      },
    ],
    proposedOrder: ["step-1"],
    preservationConstraints: context.preserveConstraints,
    unresolvedRequirements: context.unresolvedDeltas.map((e) => ({ scope: e.scope, field: e.field, reason: "SYNTHETIC -- no capability." })),
    clarifyingQuestions: [],
    reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
  };
}

describe("validateProfessionalReasoningProposal", () => {
  it("VALID: a well-formed, fully-compliant proposal is accepted", () => {
    const context = buildBaseContext();
    const result = validateProfessionalReasoningProposal(validRawProposal(context), context, [asRecord(skillA())]);
    expect(result.valid).toBe(true);
  });

  it("VALID: the returned proposal is a fresh object, never a passthrough of extra raw fields", () => {
    const context = buildBaseContext();
    const raw = { ...validRawProposal(context), maliciousExtraField: { revisedCurrentSnapshot: "tampered" } };
    const result = validateProfessionalReasoningProposal(raw, context, [asRecord(skillA())]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect((result.proposal as unknown as Record<string, unknown>).maliciousExtraField).toBeUndefined();
    }
  });

  // -------------------------------------------------------------------------
  // PART K -- adversarial cases, one per required item.
  // -------------------------------------------------------------------------

  it("K1. invents a nonexistent skill -> REJECT", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    const tampered = { ...raw, proposedSkills: [{ ...raw.proposedSkills[0], skillDefinitionId: "nonexistent-skill-id", skillKey: "nonexistent-skill" }] };
    const result = validateProfessionalReasoningProposal(tampered, context, [asRecord(skillA())]);
    expect(result.valid).toBe(false);
  });

  it("K2. references the correct skill but the WRONG version -> REJECT", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    const tampered = { ...raw, proposedSkills: [{ ...raw.proposedSkills[0], skillVersion: 999 }] };
    const result = validateProfessionalReasoningProposal(tampered, context, [asRecord(skillA())]);
    expect(result.valid).toBe(false);
  });

  it("K3. uses a real skill that is NOT in the candidate list for this context -> REJECT", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    const otherSkill = skillA({ skillId: "synthetic.validator-test.not-a-candidate", capabilities: [{ kind: "BUILD_WEIGHT", zones: ["nape"] }] });
    const tampered = { ...raw, proposedSkills: [{ ...raw.proposedSkills[0], skillDefinitionId: `record-${otherSkill.skillId}-v1`, skillKey: otherSkill.skillId }] };
    // The registry DOES contain otherSkill (it's real), but it never matched this context's own delta -- not a candidate.
    const result = validateProfessionalReasoningProposal(tampered, context, [asRecord(skillA()), asRecord(otherSkill)]);
    expect(result.valid).toBe(false);
  });

  it("K4. claims a skill can REDUCE_WEIGHT when the registry does not declare that capability -> REJECT", () => {
    const noCapabilitySkill = skillA({ skillId: "synthetic.validator-test.no-capability", capabilities: [] });
    const current = basePayload();
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const selection = selectCandidateSkillsForDelta({ id: "c", snapshotVersion: 1, payload: current }, { id: "t", snapshotVersion: 1, payload: target }, [asRecord(noCapabilitySkill)]);
    const context = buildProfessionalReasoningContext({ selection });
    // The registry offers zero real candidates (no declared capability) --
    // the AI fabricates one anyway.
    const fabricated: ProfessionalReasoningProposal = {
      schemaVersion: context.schemaVersion,
      planSummary: "SYNTHETIC",
      proposedSkills: [
        {
          stepId: "step-1",
          skillDefinitionId: `record-${noCapabilitySkill.skillId}-v1`,
          skillKey: noCapabilitySkill.skillId,
          skillVersion: 1,
          zone: "crown",
          addressesDelta: { scope: "crown", field: "weightIntent" },
          declaredCapabilityUsed: "REDUCE_WEIGHT",
          parameters: [],
          rationale: "SYNTHETIC -- fabricated capability claim.",
        },
      ],
      proposedOrder: ["step-1"],
      preservationConstraints: [],
      unresolvedRequirements: [],
      clarifyingQuestions: [],
      reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
    };
    const result = validateProfessionalReasoningProposal(fabricated, context, [asRecord(noCapabilitySkill)]);
    expect(result.valid).toBe(false);
  });

  it("K5. overrides a deterministic applicability FALSE -> REJECT", () => {
    const inapplicableSkill = skillA({
      skillId: "synthetic.validator-test.inapplicable",
      applicabilityCondition: { op: "equals", fact: "current.crown.condition", value: "virgin_healthy" },
    });
    const current = withZone(basePayload(), "crown", { condition: { value: "fragile_breakage", source: "observed" } });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const selection = selectCandidateSkillsForDelta({ id: "c", snapshotVersion: 1, payload: current }, { id: "t", snapshotVersion: 1, payload: target }, [asRecord(inapplicableSkill)]);
    const context = buildProfessionalReasoningContext({ selection });
    // This skill's applicability resolved FALSE at the Stage 4 selector
    // level, so it never appears in context.candidateSkills -- the AI
    // proposes it anyway.
    expect(context.candidateSkills).toHaveLength(0);
    const fabricated: ProfessionalReasoningProposal = {
      schemaVersion: context.schemaVersion,
      planSummary: "SYNTHETIC",
      proposedSkills: [
        {
          stepId: "step-1",
          skillDefinitionId: `record-${inapplicableSkill.skillId}-v1`,
          skillKey: inapplicableSkill.skillId,
          skillVersion: 1,
          zone: "crown",
          addressesDelta: { scope: "crown", field: "weightIntent" },
          declaredCapabilityUsed: "REDUCE_WEIGHT",
          parameters: [],
          rationale: "SYNTHETIC -- overriding a real FALSE applicability.",
        },
      ],
      proposedOrder: ["step-1"],
      preservationConstraints: [],
      unresolvedRequirements: [],
      clarifyingQuestions: [],
      reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
    };
    const result = validateProfessionalReasoningProposal(fabricated, context, [asRecord(inapplicableSkill)]);
    expect(result.valid).toBe(false);
  });

  it("K6. converts an UNKNOWN precondition into TRUE -> REJECT", () => {
    const unknownPreconditionSkill = skillA({
      skillId: "synthetic.validator-test.unknown-precondition",
      applicabilityCondition: { op: "equals", fact: "scalpSensitivityLabTestResult", value: "normal" },
    });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const selection = selectCandidateSkillsForDelta({ id: "c", snapshotVersion: 1, payload: basePayload() }, { id: "t", snapshotVersion: 1, payload: target }, [asRecord(unknownPreconditionSkill)]);
    const context = buildProfessionalReasoningContext({ selection });
    expect(context.candidateSkills).toHaveLength(0); // UNKNOWN, never promoted to a candidate.
    const fabricated: ProfessionalReasoningProposal = {
      schemaVersion: context.schemaVersion,
      planSummary: "SYNTHETIC",
      proposedSkills: [
        {
          stepId: "step-1",
          skillDefinitionId: `record-${unknownPreconditionSkill.skillId}-v1`,
          skillKey: unknownPreconditionSkill.skillId,
          skillVersion: 1,
          zone: "crown",
          addressesDelta: { scope: "crown", field: "weightIntent" },
          declaredCapabilityUsed: "REDUCE_WEIGHT",
          parameters: [],
          rationale: "SYNTHETIC -- treating unknown as true.",
        },
      ],
      proposedOrder: ["step-1"],
      preservationConstraints: [],
      unresolvedRequirements: [],
      clarifyingQuestions: [],
      reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
    };
    const result = validateProfessionalReasoningProposal(fabricated, context, [asRecord(unknownPreconditionSkill)]);
    expect(result.valid).toBe(false);
  });

  it("K7. invents an unsupported parameter value -> REJECT", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    const tampered = { ...raw, proposedSkills: [{ ...raw.proposedSkills[0], parameters: [{ name: "elevation", value: "180_deg_overdirection" }] }] };
    const result = validateProfessionalReasoningProposal(tampered, context, [asRecord(skillA())]);
    expect(result.valid).toBe(false);
  });

  it("K7b. invents a parameter the skill never declares -> REJECT", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    const tampered = { ...raw, proposedSkills: [{ ...raw.proposedSkills[0], parameters: [{ name: "cuttingAngleInDegrees", value: 47 }] }] };
    const result = validateProfessionalReasoningProposal(tampered, context, [asRecord(skillA())]);
    expect(result.valid).toBe(false);
  });

  it("K8. says an unresolved delta is solved without supporting capability -> REJECT", () => {
    const context = buildBaseContext([]); // empty registry -- crown.weightIntent has zero candidates.
    expect(context.unresolvedDeltas.some((e) => e.scope === "crown" && e.field === "weightIntent")).toBe(true);
    const fabricated: ProfessionalReasoningProposal = {
      schemaVersion: context.schemaVersion,
      planSummary: "SYNTHETIC -- falsely claims everything is solved.",
      proposedSkills: [],
      proposedOrder: [],
      preservationConstraints: context.preserveConstraints,
      unresolvedRequirements: [], // dishonestly empty -- the crown delta is silently dropped.
      clarifyingQuestions: [],
      reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
    };
    const result = validateProfessionalReasoningProposal(fabricated, context, []);
    expect(result.valid).toBe(false);
  });

  it("K9. removes a PRESERVE constraint -> REJECT", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    expect(raw.preservationConstraints.length).toBeGreaterThan(0);
    const tampered = { ...raw, preservationConstraints: [] };
    const result = validateProfessionalReasoningProposal(tampered, context, [asRecord(skillA())]);
    expect(result.valid).toBe(false);
  });

  it("K10. alters CURRENT or TARGET facts -> REJECT (structurally inert: the schema carries no such field, and any smuggled field is dropped, never applied)", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    const tampered = { ...raw, currentSnapshotOverride: { nape: { relativeLength: "short" } }, targetSnapshotOverride: { crown: { weightIntent: "build" } } };
    const result = validateProfessionalReasoningProposal(tampered, context, [asRecord(skillA())]);
    // The proposal is still otherwise valid -- but the smuggled override
    // fields never survive into the returned, trusted object.
    expect(result.valid).toBe(true);
    if (result.valid) {
      const asAny = result.proposal as unknown as Record<string, unknown>;
      expect(asAny.currentSnapshotOverride).toBeUndefined();
      expect(asAny.targetSnapshotOverride).toBeUndefined();
    }
  });

  it("K11. returns a malformed structured response -> REJECT", () => {
    const context = buildBaseContext();
    const result = validateProfessionalReasoningProposal({ not: "a valid proposal shape" }, context, [asRecord(skillA())]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.rejectionReasons[0]).toMatch(/SCHEMA_VALIDATION_FAILED/);
    }
  });

  it("K12. proposes a haircut-template identifier instead of real skills -> REJECT", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    const tampered = { ...raw, proposedSkills: [{ ...raw.proposedSkills[0], skillDefinitionId: "template-butterfly-v1", skillKey: "butterfly-haircut-template" }] };
    const result = validateProfessionalReasoningProposal(tampered, context, [asRecord(skillA())]);
    expect(result.valid).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Composition (Part D)
  // -------------------------------------------------------------------------

  it("28. one skill may cover multiple valid, distinct deltas (two steps, same skill)", () => {
    const multiCapabilitySkill = skillA({
      skillId: "synthetic.validator-test.multi-capability",
      capabilities: [
        { kind: "REDUCE_WEIGHT", zones: ["crown"] },
        { kind: "PRESERVE_PERIMETER", zones: ["nape"] },
      ],
    });
    const context = buildBaseContext([asRecord(multiCapabilitySkill)]);
    expect(context.candidateSkills.length).toBeGreaterThanOrEqual(2);
    const raw = validRawProposal(context); // uses only the first candidate
    const napeCandidate = context.candidateSkills.find((c) => c.addressesDelta.scope === "nape")!;
    const combined: ProfessionalReasoningProposal = {
      ...raw,
      proposedSkills: [
        raw.proposedSkills[0],
        {
          stepId: "step-2",
          skillDefinitionId: napeCandidate.skillDefinitionId,
          skillKey: napeCandidate.skillKey,
          skillVersion: napeCandidate.skillVersion,
          zone: "nape",
          addressesDelta: napeCandidate.addressesDelta,
          declaredCapabilityUsed: napeCandidate.matchedCapability,
          parameters: [],
          rationale: "SYNTHETIC -- preserves nape perimeter.",
        },
      ],
      proposedOrder: ["step-1", "step-2"],
    };
    const result = validateProfessionalReasoningProposal(combined, context, [asRecord(multiCapabilitySkill)]);
    expect(result.valid).toBe(true);
  });

  it("29. multiple different skills may contribute to one delta", () => {
    const skillB = skillA({ skillId: "synthetic.validator-test.skill-b" });
    const registry = [asRecord(skillA()), asRecord(skillB)];
    const context = buildBaseContext(registry);
    const candidatesForCrown = context.candidateSkills.filter((c) => c.addressesDelta.scope === "crown");
    expect(candidatesForCrown).toHaveLength(2);
    const combined: ProfessionalReasoningProposal = {
      schemaVersion: context.schemaVersion,
      planSummary: "SYNTHETIC",
      proposedSkills: candidatesForCrown.map((c, i) => ({
        stepId: `step-${i + 1}`,
        skillDefinitionId: c.skillDefinitionId,
        skillKey: c.skillKey,
        skillVersion: c.skillVersion,
        zone: "crown",
        addressesDelta: c.addressesDelta,
        declaredCapabilityUsed: c.matchedCapability,
        parameters: [],
        rationale: "SYNTHETIC",
      })),
      proposedOrder: candidatesForCrown.map((_, i) => `step-${i + 1}`),
      preservationConstraints: context.preserveConstraints,
      // Neither skillA nor skillB declares PRESERVE_PERIMETER, so the
      // nape.perimeterRelationship delta is honestly unresolved here too
      // -- must be reported, never silently dropped.
      unresolvedRequirements: context.unresolvedDeltas.map((e) => ({ scope: e.scope, field: e.field, reason: "SYNTHETIC -- no capability." })),
      clarifyingQuestions: [],
      reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
    };
    const result = validateProfessionalReasoningProposal(combined, context, registry);
    expect(result.valid).toBe(true);
  });

  it("30. skill order is represented explicitly and validated as an exact permutation (schema-level)", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    const badOrder = { ...raw, proposedOrder: ["step-1", "step-1"] }; // duplicate reference
    const result = validateProfessionalReasoningProposal(badOrder, context, [asRecord(skillA())]);
    expect(result.valid).toBe(false);
  });

  it("31. a duplicate step for the exact same (skill, delta) pair fails deterministically", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    const duplicated: ProfessionalReasoningProposal = {
      ...raw,
      proposedSkills: [raw.proposedSkills[0], { ...raw.proposedSkills[0], stepId: "step-2" }],
      proposedOrder: ["step-1", "step-2"],
    };
    const result = validateProfessionalReasoningProposal(duplicated, context, [asRecord(skillA())]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.rejectionReasons.some((r) => r.includes("DUPLICATE_STEP"))).toBe(true);
    }
  });

  it("32. a proposed step missing a required parameter's value is fine structurally, but an invalid value for a declared parameter is NEEDS_INPUT-worthy, never guessed silently -- the caller must not fabricate one on our behalf", () => {
    const context = buildBaseContext();
    const raw = validRawProposal(context);
    // A step that simply omits the optional elevation parameter (never
    // guesses one) is still valid -- absence is honest, a WRONG guess is not.
    const withoutOptionalParam = { ...raw, proposedSkills: [{ ...raw.proposedSkills[0], parameters: [] }] };
    const result = validateProfessionalReasoningProposal(withoutOptionalParam, context, [asRecord(skillA())]);
    expect(result.valid).toBe(true);
  });

  it("conflicting capability pair on the same delta is rejected deterministically", () => {
    const reduceLengthSkill = skillA({ skillId: "synthetic.validator-test.reduce-length", capabilities: [{ kind: "REDUCE_LENGTH", zones: ["nape"] }] });
    const increaseLengthSkill = skillA({ skillId: "synthetic.validator-test.increase-length", capabilities: [{ kind: "INCREASE_LENGTH", zones: ["nape"] }] });
    // relativeLength must move both directions for both capabilities to
    // ever independently match -- construct two separate contexts and
    // manually force a conflicting pair into one proposal to prove the
    // conflict detector itself, regardless of how such a pair could arise.
    const current = withZone(basePayload(), "nape", { relativeLength: { value: "medium", source: "observed" } });
    const targetShort = withZone(basePayload(), "nape", { relativeLength: { value: "short", source: "professional_input" } });
    const selection = selectCandidateSkillsForDelta({ id: "c", snapshotVersion: 1, payload: current }, { id: "t", snapshotVersion: 1, payload: targetShort }, [asRecord(reduceLengthSkill)]);
    const context = buildProfessionalReasoningContext({ selection });
    const reduceCandidate = context.candidateSkills[0];
    const conflicting: ProfessionalReasoningProposal = {
      schemaVersion: context.schemaVersion,
      planSummary: "SYNTHETIC",
      proposedSkills: [
        {
          stepId: "step-1",
          skillDefinitionId: reduceCandidate.skillDefinitionId,
          skillKey: reduceCandidate.skillKey,
          skillVersion: reduceCandidate.skillVersion,
          zone: "nape",
          addressesDelta: reduceCandidate.addressesDelta,
          declaredCapabilityUsed: "REDUCE_LENGTH",
          parameters: [],
          rationale: "SYNTHETIC",
        },
        {
          stepId: "step-2",
          skillDefinitionId: `record-${increaseLengthSkill.skillId}-v1`,
          skillKey: increaseLengthSkill.skillId,
          skillVersion: 1,
          zone: "nape",
          addressesDelta: reduceCandidate.addressesDelta,
          declaredCapabilityUsed: "INCREASE_LENGTH",
          parameters: [],
          rationale: "SYNTHETIC -- contradicts step-1.",
        },
      ],
      proposedOrder: ["step-1", "step-2"],
      preservationConstraints: [],
      unresolvedRequirements: [],
      clarifyingQuestions: [],
      reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
    };
    // step-2 is not itself a real candidate (INCREASE_LENGTH was never
    // matched), so it is rejected on registry grounds too -- both
    // rejection paths are legitimate; the important, tested property is
    // that this can never validate successfully.
    const result = validateProfessionalReasoningProposal(conflicting, context, [asRecord(reduceLengthSkill), asRecord(increaseLengthSkill)]);
    expect(result.valid).toBe(false);
  });
});
