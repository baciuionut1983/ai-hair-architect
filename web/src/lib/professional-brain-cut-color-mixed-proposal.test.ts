import { describe, expect, it } from "vitest";

import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import {
  buildUnassessedColorEntry,
  buildUnassessedGlobalEntry,
  buildUnassessedZoneEntry,
  isHairStateColorEntry,
  isHairStateSnapshotPayload,
  type HairStateSnapshotPayload,
} from "@/lib/hair-state-snapshot-validators";
import type { HairStateSnapshotDeltaInput } from "@/lib/hair-state-delta";
import { computeColorStateDelta } from "@/lib/hair-state-color-delta";
import { selectColorCandidateSkillsForDelta } from "@/lib/hair-state-color-delta-skill-candidate-selector";
import {
  COLOR_GLOBAL_EVALUATION_GATE_SKILL,
  COLOR_GLOBAL_EVALUATION_GATE_SKILL_INSTANCE,
  COLOR_GLOBAL_EVALUATION_GATE_EXECUTION_UNITS,
  isColorSkillConditionFact,
} from "@/lib/color-skill-global-single-process-evaluation-gate";
import { compileColorExecutionUnitToAtomicActions } from "@/lib/color-skill-atomic-action-compiler";
import { buildCanonicalColorCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import {
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
  ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
  isEstablishCentralNapeGuideFact,
} from "@/lib/cutting-skill-establish-central-nape-guide";
import type { ProfessionalReasoningProposal } from "@/lib/professional-reasoning-contracts";
import { compileProfessionalExecutionPlan, type ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import { validateProfessionalExecutionPlan } from "@/lib/professional-execution-plan-validator";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";

// AI Hair Architect, Professional Skill Engine, B1 -- PROFESSIONAL BRAIN
// CUT+COLOR SLICE tests. Pure, no I/O, no AI, no paid provider call
// anywhere in this file. Proves: (1) old CUT-only snapshot payloads remain
// valid, (2) the new color delta/selection modules work on their own
// terms, (3) a mixed CUT+COLOR proposal genuinely compiles through the
// REAL, unmodified Stage 6 pipeline, (4) order/dependency precedence is
// ACTUALLY enforced by the existing validator (not merely declared as a
// field), and (5) insufficient chemical/strand-test data ACTUALLY blocks
// compilation rather than silently proceeding.

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}

function snapshot(id: string, snapshotVersion: number, payload: HairStateSnapshotPayload): HairStateSnapshotDeltaInput {
  return { id, snapshotVersion, payload };
}

describe("B1 -- old CUT-only snapshot payloads remain valid (no reinterpretation of history)", () => {
  it("a payload with no colorState field at all is still a fully valid HairStateSnapshotPayload", () => {
    const payload = basePayload();
    expect("colorState" in payload).toBe(false);
    expect(isHairStateSnapshotPayload(payload)).toBe(true);
  });

  it("computeColorStateDelta on two colorState-less payloads reports UNKNOWN, never a fabricated change", () => {
    const payload = basePayload();
    const entries = computeColorStateDelta(snapshot("c1", 1, payload), snapshot("t1", 1, payload));
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.transformation === "UNKNOWN")).toBe(true);
  });
});

describe("B1 -- HairStateColorEntry validation", () => {
  it("buildUnassessedColorEntry produces a structurally valid, honestly-unassessed entry", () => {
    const entry = buildUnassessedColorEntry();
    expect(isHairStateColorEntry(entry)).toBe(true);
    expect(entry.level).toEqual({ value: "unspecified", source: "not_yet_assessed" });
    expect(entry.tone).toEqual({ value: "unspecified", source: "not_yet_assessed" });
  });

  it("a real, known level/tone pair validates", () => {
    expect(isHairStateColorEntry({ level: { value: "level_6", source: "observed" }, tone: { value: "warm_gold", source: "professional_input" } })).toBe(true);
  });

  it("rejects a malformed entry (unrecognized level value, missing tone)", () => {
    expect(isHairStateColorEntry({ level: { value: "level_99", source: "observed" }, tone: { value: "neutral", source: "observed" } })).toBe(false);
    expect(isHairStateColorEntry({ level: { value: "level_6", source: "observed" } })).toBe(false);
  });

  it("a payload WITH a valid colorState is accepted by isHairStateSnapshotPayload", () => {
    const payload: HairStateSnapshotPayload = { ...basePayload(), colorState: { level: { value: "level_5", source: "observed" }, tone: { value: "neutral", source: "observed" } } };
    expect(isHairStateSnapshotPayload(payload)).toBe(true);
  });

  it("a payload with a malformed colorState is rejected", () => {
    const payload = { ...basePayload(), colorState: { level: { value: "not-a-level", source: "observed" } } };
    expect(isHairStateSnapshotPayload(payload)).toBe(false);
  });
});

function colorSnapshot(id: string, snapshotVersion: number, level: string, tone: string): HairStateSnapshotDeltaInput {
  return { id, snapshotVersion, payload: { ...basePayload(), colorState: { level: { value: level as never, source: "observed" }, tone: { value: tone as never, source: "observed" } } } };
}

describe("computeColorStateDelta (pure)", () => {
  it("a real ordered level change (level_5 -> level_8) is deterministically INCREASED, never CHANGED", () => {
    const entries = computeColorStateDelta(colorSnapshot("c1", 1, "level_5", "neutral"), colorSnapshot("t1", 1, "level_8", "neutral"));
    expect(entries.find((e) => e.field === "colorLevel")?.transformation).toBe("INCREASED");
  });

  it("a real ordered level change (level_8 -> level_5) is deterministically REDUCED", () => {
    const entries = computeColorStateDelta(colorSnapshot("c1", 1, "level_8", "neutral"), colorSnapshot("t1", 1, "level_5", "neutral"));
    expect(entries.find((e) => e.field === "colorLevel")?.transformation).toBe("REDUCED");
  });

  it("an unordered tone change (warm_gold -> cool_ash) is CHANGED, never a fabricated lighter/darker direction", () => {
    const entries = computeColorStateDelta(colorSnapshot("c1", 1, "level_5", "warm_gold"), colorSnapshot("t1", 1, "level_5", "cool_ash"));
    expect(entries.find((e) => e.field === "colorTone")?.transformation).toBe("CHANGED");
  });

  it("matching level and tone on both sides is PRESERVED", () => {
    const entries = computeColorStateDelta(colorSnapshot("c1", 1, "level_6", "neutral"), colorSnapshot("t1", 1, "level_6", "neutral"));
    expect(entries.every((e) => e.transformation === "PRESERVED")).toBe(true);
  });

  it("a real target value with no known current value is ADDED", () => {
    const entries = computeColorStateDelta(snapshot("c1", 1, basePayload()), colorSnapshot("t1", 1, "level_7", "warm_gold"));
    expect(entries.every((e) => e.transformation === "ADDED")).toBe(true);
  });

  it("deterministic: the same two payloads always produce the same entries", () => {
    const c = colorSnapshot("c1", 1, "level_4", "cool_violet");
    const t = colorSnapshot("t1", 1, "level_7", "warm_copper");
    expect(computeColorStateDelta(c, t)).toEqual(computeColorStateDelta(c, t));
  });
});

describe("selectColorCandidateSkillsForDelta", () => {
  it("the real color evaluation-gate skill becomes a candidate for a genuine colorLevel/colorTone change", () => {
    const result = selectColorCandidateSkillsForDelta(colorSnapshot("c1", 1, "level_5", "neutral"), colorSnapshot("t1", 1, "level_8", "warm_gold"), buildCanonicalColorCandidateSkillRegistry());
    expect(result.candidateMatches).toHaveLength(2); // colorLevel + colorTone, both matched
    expect(result.candidateMatches.every((m) => m.matchedCapability === "EVALUATE_COLOR_SERVICE")).toBe(true);
    expect(result.candidateMatches.every((m) => m.skillKey === COLOR_GLOBAL_EVALUATION_GATE_SKILL.skillId)).toBe(true);
    expect(result.unresolvedDeltas).toEqual([]);
  });

  it("an empty color registry leaves a genuine color delta honestly unresolved -- never a guessed/invented match", () => {
    const result = selectColorCandidateSkillsForDelta(colorSnapshot("c1", 1, "level_5", "neutral"), colorSnapshot("t1", 1, "level_8", "neutral"), []);
    expect(result.candidateMatches).toEqual([]);
    expect(result.unresolvedDeltas.some((e) => e.field === "colorLevel")).toBe(true);
  });

  it("an UNKNOWN-transformation entry (nothing stated) is neither matched nor reported unresolved -- distinct from a genuine registry gap", () => {
    const result = selectColorCandidateSkillsForDelta(snapshot("c1", 1, basePayload()), snapshot("t1", 1, basePayload()), []);
    expect(result.candidateMatches).toEqual([]);
    expect(result.unresolvedDeltas).toEqual([]);
  });
});

const COMPILED_AT = "2026-09-29T00:00:00.000Z";

function cutTemplate(): ExecutionPlanSkillTemplate<string> {
  return {
    skillDefinition: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
    skillInstance: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
    executionUnits: ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
    isValidFact: isEstablishCentralNapeGuideFact,
  };
}

function colorTemplate(executionUnits: readonly ExecutionUnit<string>[] = COLOR_GLOBAL_EVALUATION_GATE_EXECUTION_UNITS): ExecutionPlanSkillTemplate<string> {
  return {
    skillDefinition: COLOR_GLOBAL_EVALUATION_GATE_SKILL,
    skillInstance: COLOR_GLOBAL_EVALUATION_GATE_SKILL_INSTANCE,
    executionUnits,
    isValidFact: isColorSkillConditionFact,
  };
}

function mixedProposal(order: readonly string[]): ProfessionalReasoningProposal {
  return {
    schemaVersion: "1.0.0-pr5",
    planSummary: "SYNTHETIC (B1 proof) -- establish the central nape guide and evaluate a global single-process color service on the same client.",
    proposedSkills: [
      {
        stepId: "step-cut",
        skillDefinitionId: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId,
        skillKey: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId,
        skillVersion: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.version,
        zone: "nape",
        addressesDelta: { scope: "nape", field: "lengthIntent" },
        declaredCapabilityUsed: "ESTABLISH_GUIDE",
        parameters: [],
        rationale: "SYNTHETIC (B1 proof) -- establishes the central nape reference guide.",
      },
      {
        stepId: "step-color",
        skillDefinitionId: COLOR_GLOBAL_EVALUATION_GATE_SKILL.skillId,
        skillKey: COLOR_GLOBAL_EVALUATION_GATE_SKILL.skillId,
        skillVersion: COLOR_GLOBAL_EVALUATION_GATE_SKILL.version,
        zone: "global",
        addressesDelta: { scope: "global", field: "colorLevel" },
        declaredCapabilityUsed: "EVALUATE_COLOR_SERVICE",
        parameters: [],
        rationale: "SYNTHETIC (B1 proof) -- evaluates the requested color service against the structurally captured base/target color state.",
      },
    ],
    proposedOrder: order,
    preservationConstraints: [],
    unresolvedRequirements: [],
    clarifyingQuestions: [],
    reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
  };
}

describe("B1 -- a mixed CUT+COLOR proposal compiles through the REAL, unmodified Stage 6 pipeline", () => {
  it("compiles successfully with planned units from BOTH the real cut skill and the real color skill, in the approved order", () => {
    const result = compileProfessionalExecutionPlan({
      proposal: mixedProposal(["step-cut", "step-color"]),
      reasoningProposalId: "reasoning-proposal-b1-mixed",
      reasoningProposalContextFingerprint: "d".repeat(64),
      currentSnapshotId: "current-b1",
      currentSnapshotVersion: 1,
      targetSnapshotId: "target-b1",
      targetSnapshotVersion: 1,
      templates: [cutTemplate(), colorTemplate()],
      compiledAt: COMPILED_AT,
    });
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(result.plan.plannedUnits.map((u) => u.executionUnit.sourceSkillInstanceId)).toEqual([
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.skillInstanceId,
      COLOR_GLOBAL_EVALUATION_GATE_SKILL_INSTANCE.skillInstanceId,
    ]);
    const colorUnit = result.plan.plannedUnits[1];
    // The color evaluation gate compiles to PREPARE + CONTROL actions, plus
    // the compiler's own always-appended VERIFY -- and deliberately NO
    // EXECUTE action anywhere: this Skill never asserts a chemical
    // operation happened.
    expect(colorUnit.atomicActions.map((a) => a.actionKind).sort()).toEqual(["CONTROL", "PREPARE", "VERIFY"]);
    expect(colorUnit.atomicActions.some((a) => a.actionKind === "EXECUTE")).toBe(false);

    const validation = validateProfessionalExecutionPlan({ plan: result.plan, proposal: mixedProposal(["step-cut", "step-color"]), templates: [cutTemplate(), colorTemplate()] });
    expect(validation.valid).toBe(true);
    expect(validation.failures).toEqual([]);
  });
});

// SYNTHETIC precedence fixture -- NOT real professional authority. The
// real, authored color Skill (color-skill-global-single-process-
// evaluation-gate.ts) deliberately declares no prerequisiteExecutionUnitIds
// (see that file's own header: no universal truth about which cut skill,
// if any, must precede a general-purpose evaluation gate). This clone adds
// one, purely to prove the EXISTING validator mechanism (check 12) is
// genuinely evaluated for a mixed CUT+COLOR plan, not merely declarable.
function colorExecutionUnitRequiringCutGuideFirst(): readonly ExecutionUnit<string>[] {
  const cutGuideUnitId = ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0].executionUnitId;
  return COLOR_GLOBAL_EVALUATION_GATE_EXECUTION_UNITS.map((unit) => ({ ...unit, prerequisiteExecutionUnitIds: [cutGuideUnitId] }));
}

describe("B1 -- order/dependency enforcement is real, not merely declared", () => {
  it("a plan compiled in the CORRECT order (cut guide before the color step that requires it) passes with zero ORDER_DEPENDENCY_VIOLATION", () => {
    const templates = [cutTemplate(), colorTemplate(colorExecutionUnitRequiringCutGuideFirst())];
    const proposal = mixedProposal(["step-cut", "step-color"]);
    const result = compileProfessionalExecutionPlan({
      proposal,
      reasoningProposalId: "reasoning-proposal-b1-order-ok",
      reasoningProposalContextFingerprint: "e".repeat(64),
      currentSnapshotId: "current-b1",
      currentSnapshotVersion: 1,
      targetSnapshotId: "target-b1",
      targetSnapshotVersion: 1,
      templates,
      compiledAt: COMPILED_AT,
    });
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    const validation = validateProfessionalExecutionPlan({ plan: result.plan, proposal, templates });
    expect(validation.failures.filter((f) => f.failureReason === "ORDER_DEPENDENCY_VIOLATION")).toEqual([]);
  });

  it("a plan compiled in the WRONG order (color step before the cut guide it requires) is caught by the validator as ORDER_DEPENDENCY_VIOLATION -- proving the prerequisite field is actually enforced, not just present", () => {
    const templates = [cutTemplate(), colorTemplate(colorExecutionUnitRequiringCutGuideFirst())];
    const proposal = mixedProposal(["step-color", "step-cut"]);
    const result = compileProfessionalExecutionPlan({
      proposal,
      reasoningProposalId: "reasoning-proposal-b1-order-violation",
      reasoningProposalContextFingerprint: "f".repeat(64),
      currentSnapshotId: "current-b1",
      currentSnapshotVersion: 1,
      targetSnapshotId: "target-b1",
      targetSnapshotVersion: 1,
      templates,
      compiledAt: COMPILED_AT,
    });
    // Compilation itself still succeeds (the compiler never reorders or
    // second-guesses proposedOrder -- see professional-execution-plan-
    // compiler.ts's own header); it is the SEPARATE validator that must
    // catch the violation.
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    const validation = validateProfessionalExecutionPlan({ plan: result.plan, proposal, templates });
    expect(validation.valid).toBe(false);
    const violation = validation.failures.find((f) => f.failureReason === "ORDER_DEPENDENCY_VIOLATION");
    expect(violation).toBeDefined();
    expect(violation?.executionUnitId).toBe(colorExecutionUnitRequiringCutGuideFirst()[0].executionUnitId);
  });
});

// SYNTHETIC "insufficient data" fixture -- NOT real professional
// authority. Clones the real, canonical SkillInstance but leaves
// chemicalHistoryStatus/strandTestStatus UNRESOLVED (no bound value),
// modeling a real client for whom this data has not yet been gathered.
function unresolvedColorSkillInstance(): SkillInstance<string> {
  const bindings: SkillInstanceParameterBinding<string>[] = COLOR_GLOBAL_EVALUATION_GATE_SKILL_INSTANCE.parameterBindings.map((binding) =>
    binding.parameterName === "chemicalHistoryStatus" || binding.parameterName === "strandTestStatus" ? { parameterName: binding.parameterName, bindingState: "UNRESOLVED" } : binding,
  );
  return { ...COLOR_GLOBAL_EVALUATION_GATE_SKILL_INSTANCE, skillInstanceId: `${COLOR_GLOBAL_EVALUATION_GATE_SKILL_INSTANCE.skillInstanceId}-synthetic-unresolved`, parameterBindings: bindings };
}

describe("B1 -- insufficient chemical/strand-test data blocks compilation, never silently proceeds", () => {
  it("compileColorExecutionUnitToAtomicActions refuses to compile when chemical history and strand-test status are UNRESOLVED", () => {
    const instance = unresolvedColorSkillInstance();
    const unit = { ...COLOR_GLOBAL_EVALUATION_GATE_EXECUTION_UNITS[0], sourceSkillInstanceId: instance.skillInstanceId };
    const result = compileColorExecutionUnitToAtomicActions(COLOR_GLOBAL_EVALUATION_GATE_SKILL, instance, unit, isColorSkillConditionFact, COMPILED_AT);
    expect(result.status).toBe("UNRESOLVED");
    if (result.status !== "UNRESOLVED") return;
    expect(result.missingParameterNames).toEqual(expect.arrayContaining(["chemicalHistoryStatus", "strandTestStatus"]));
  });

  it("a mixed CUT+COLOR proposal fails to compile (MISSING_REQUIRED_PARAMETER) end to end when the color step's own instance data is insufficient -- never a partial/silent plan", () => {
    const instance = unresolvedColorSkillInstance();
    const executionUnits = COLOR_GLOBAL_EVALUATION_GATE_EXECUTION_UNITS.map((unit) => ({ ...unit, sourceSkillInstanceId: instance.skillInstanceId }));
    const templates = [cutTemplate(), { skillDefinition: COLOR_GLOBAL_EVALUATION_GATE_SKILL, skillInstance: instance, executionUnits, isValidFact: isColorSkillConditionFact }];
    const result = compileProfessionalExecutionPlan({
      proposal: mixedProposal(["step-cut", "step-color"]),
      reasoningProposalId: "reasoning-proposal-b1-insufficient-data",
      reasoningProposalContextFingerprint: "a".repeat(64),
      currentSnapshotId: "current-b1",
      currentSnapshotVersion: 1,
      targetSnapshotId: "target-b1",
      targetSnapshotVersion: 1,
      templates,
      compiledAt: COMPILED_AT,
    });
    expect(result).toMatchObject({ status: "UNRESOLVED", failureReason: "MISSING_REQUIRED_PARAMETER", stepId: "step-color" });
  });
});
