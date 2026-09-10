import { describe, expect, it } from "vitest";

import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import type { SkillDefinition, SkillParameterDefinition, SkillProcedureStep } from "@/lib/professional-skill-contracts";
import {
  buildProfessionalReasoningContext,
  isProfessionalReasoningProposal,
  type ProfessionalReasoningProposal,
} from "@/lib/professional-reasoning-contracts";

// Professional Skill Engine, Stage 5 -- PART A/B pure contract tests. No
// I/O, no AI.

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
function syntheticParameter(): SkillParameterDefinition {
  return { name: "syntheticParam", valueKind: "boolean", description: SYNTHETIC };
}
function syntheticSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    skillId: "synthetic.contracts-test.skill",
    version: 1,
    vertical: "cutting",
    name: "SYNTHETIC TEST FIXTURE",
    description: SYNTHETIC,
    status: "ACTIVE",
    authorityType: "PROFESSIONALLY_AUTHORED",
    rationale: SYNTHETIC,
    parameters: [syntheticParameter()],
    procedure: syntheticProcedure(),
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

function validProposal(overrides: Partial<ProfessionalReasoningProposal> = {}): ProfessionalReasoningProposal {
  return {
    schemaVersion: "1.0.0-pr5",
    planSummary: "SYNTHETIC -- a plan summary.",
    proposedSkills: [],
    proposedOrder: [],
    preservationConstraints: [],
    unresolvedRequirements: [],
    clarifyingQuestions: [],
    reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
    ...overrides,
  };
}

describe("buildProfessionalReasoningContext (Part A)", () => {
  it("1. binds the exact CURRENT snapshot id and version", () => {
    const current = { id: "current-id-1", snapshotVersion: 3, payload: basePayload() };
    const target = { id: "target-id-1", snapshotVersion: 5, payload: basePayload() };
    const selection = selectCandidateSkillsForDelta(current, target, []);
    const context = buildProfessionalReasoningContext({ selection });
    expect(context.currentSnapshotId).toBe("current-id-1");
    expect(context.currentSnapshotVersion).toBe(3);
  });

  it("2. binds the exact TARGET snapshot id and version", () => {
    const current = { id: "c", snapshotVersion: 1, payload: basePayload() };
    const target = { id: "target-id-2", snapshotVersion: 9, payload: basePayload() };
    const selection = selectCandidateSkillsForDelta(current, target, []);
    const context = buildProfessionalReasoningContext({ selection });
    expect(context.targetSnapshotId).toBe("target-id-2");
    expect(context.targetSnapshotVersion).toBe(9);
  });

  it("3. binds the exact HairStateDelta computed from those snapshots", () => {
    const current = { id: "c", snapshotVersion: 1, payload: basePayload() };
    const target = { id: "t", snapshotVersion: 1, payload: withZone(basePayload(), "nape", { weightIntent: { value: "reduce", source: "professional_input" } }) };
    const selection = selectCandidateSkillsForDelta(current, target, []);
    const context = buildProfessionalReasoningContext({ selection });
    expect(context.delta.entries.some((e) => e.scope === "nape" && e.field === "weightIntent" && e.transformation === "REDUCED")).toBe(true);
  });

  it("4. binds exact candidate skill definition IDs and exact versions", () => {
    const skill = syntheticSkill({ capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }] });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const selection = selectCandidateSkillsForDelta({ id: "c", snapshotVersion: 1, payload: basePayload() }, { id: "t", snapshotVersion: 1, payload: target }, [asRecord(skill)]);
    const context = buildProfessionalReasoningContext({ selection });
    expect(context.candidateSkills).toHaveLength(1);
    expect(context.candidateSkills[0].skillDefinitionId).toBe(`record-${skill.skillId}-v1`);
    expect(context.candidateSkills[0].skillKey).toBe(skill.skillId);
    expect(context.candidateSkills[0].skillVersion).toBe(1);
  });

  it("5. unresolved deltas remain present in the context, verbatim", () => {
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "build", source: "professional_input" } });
    const selection = selectCandidateSkillsForDelta({ id: "c", snapshotVersion: 1, payload: basePayload() }, { id: "t", snapshotVersion: 1, payload: target }, []);
    const context = buildProfessionalReasoningContext({ selection });
    expect(context.unresolvedDeltas.some((e) => e.scope === "crown" && e.field === "weightIntent")).toBe(true);
  });

  it("preserveConstraints are derived from PRESERVED delta entries, never a second, independent source", () => {
    const current = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "observed" } });
    const target = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "professional_input" } });
    const selection = selectCandidateSkillsForDelta({ id: "c", snapshotVersion: 1, payload: current }, { id: "t", snapshotVersion: 1, payload: target }, []);
    const context = buildProfessionalReasoningContext({ selection });
    expect(context.preserveConstraints.some((c) => c.scope === "nape" && c.field === "perimeterRelationship")).toBe(true);
  });

  it("professionalRequestText is trimmed and bounded, never derived automatically", () => {
    const selection = selectCandidateSkillsForDelta({ id: "c", snapshotVersion: 1, payload: basePayload() }, { id: "t", snapshotVersion: 1, payload: basePayload() }, []);
    const context = buildProfessionalReasoningContext({ selection, professionalRequestText: "  Vreau să păstrez lungimea.  " });
    expect(context.professionalRequestText).toBe("Vreau să păstrez lungimea.");
    const contextWithout = buildProfessionalReasoningContext({ selection });
    expect(contextWithout.professionalRequestText).toBeUndefined();
  });

  it("contextFingerprint is deterministic -- identical inputs always fingerprint identically", () => {
    const current = { id: "c", snapshotVersion: 1, payload: basePayload() };
    const target = { id: "t", snapshotVersion: 1, payload: withZone(basePayload(), "nape", { weightIntent: { value: "reduce", source: "professional_input" } }) };
    const selection1 = selectCandidateSkillsForDelta(current, target, []);
    const selection2 = selectCandidateSkillsForDelta(current, target, []);
    const context1 = buildProfessionalReasoningContext({ selection: selection1 });
    const context2 = buildProfessionalReasoningContext({ selection: selection2 });
    expect(context1.contextFingerprint).toBe(context2.contextFingerprint);
  });

  it("evidence summaries carry only kind+role, never image bytes or URLs -- structurally incapable of new visual observations", () => {
    const selection = selectCandidateSkillsForDelta({ id: "c", snapshotVersion: 1, payload: basePayload() }, { id: "t", snapshotVersion: 1, payload: basePayload() }, []);
    const context = buildProfessionalReasoningContext({
      selection,
      currentEvidence: [{ evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE" }],
      targetEvidence: [{ evidenceKind: "IMAGE_ASSET", evidenceRole: "TARGET_REFERENCE" }],
    });
    expect(context.currentEvidence).toEqual([{ evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE" }]);
    expect(Object.keys(context.currentEvidence[0])).toEqual(["evidenceKind", "evidenceRole"]);
  });
});

describe("isProfessionalReasoningProposal (Part B schema)", () => {
  it("accepts a well-formed, minimal valid proposal", () => {
    expect(isProfessionalReasoningProposal(validProposal())).toBe(true);
  });

  it("accepts a well-formed proposal with real proposed skills and a matching proposedOrder", () => {
    const proposal = validProposal({
      proposedSkills: [
        {
          stepId: "step-1",
          skillDefinitionId: "record-1",
          skillKey: "skill-1",
          skillVersion: 1,
          zone: "nape",
          addressesDelta: { scope: "nape", field: "lengthIntent" },
          declaredCapabilityUsed: "PRESERVE_LENGTH",
          parameters: [{ name: "elevation", value: "0_deg_blunt" }],
          rationale: "SYNTHETIC rationale.",
        },
      ],
      proposedOrder: ["step-1"],
    });
    expect(isProfessionalReasoningProposal(proposal)).toBe(true);
  });

  it("rejects a proposedOrder that references an unknown stepId", () => {
    const proposal = validProposal({ proposedOrder: ["nonexistent-step"] });
    expect(isProfessionalReasoningProposal(proposal)).toBe(false);
  });

  it("rejects a proposedOrder missing a real declared step", () => {
    const proposal = { ...validProposal(), proposedSkills: [{ stepId: "step-1", skillDefinitionId: "x", skillKey: "x", skillVersion: 1, zone: "nape", addressesDelta: { scope: "nape", field: "lengthIntent" }, declaredCapabilityUsed: "PRESERVE_LENGTH", parameters: [], rationale: "r" }], proposedOrder: [] };
    expect(isProfessionalReasoningProposal(proposal)).toBe(false);
  });

  it("rejects an unrecognized reasoningStatus", () => {
    expect(isProfessionalReasoningProposal({ ...validProposal(), reasoningStatus: "MADE_UP_STATUS" })).toBe(false);
  });

  it("rejects a missing planSummary", () => {
    const { planSummary: _drop, ...rest } = validProposal();
    expect(isProfessionalReasoningProposal(rest)).toBe(false);
  });

  it("rejects a non-object value entirely", () => {
    expect(isProfessionalReasoningProposal(null)).toBe(false);
    expect(isProfessionalReasoningProposal("a string")).toBe(false);
    expect(isProfessionalReasoningProposal(42)).toBe(false);
  });
});
