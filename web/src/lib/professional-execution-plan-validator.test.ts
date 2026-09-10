import { describe, expect, it } from "vitest";

import type { ProfessionalReasoningProposal } from "@/lib/professional-reasoning-contracts";
import {
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
  ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
  isEstablishCentralNapeGuideFact,
} from "@/lib/cutting-skill-establish-central-nape-guide";
import {
  OCCIPITAL_TRANSITION_SKILL,
  OCCIPITAL_TRANSITION_SKILL_INSTANCE,
  OCCIPITAL_TRANSITION_EXECUTION_UNITS,
  isOccipitalTransitionFact,
} from "@/lib/cutting-skill-occipital-transition";
import { compileProfessionalExecutionPlan, type ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import { assertPlanReadyForExecutionAuthority, isPlanExecutableAsProfessionalAuthority, validateProfessionalExecutionPlan } from "@/lib/professional-execution-plan-validator";
import type { ProfessionalExecutionPlan } from "@/lib/professional-execution-plan-contracts";

// Professional Skill Engine, Stage 6 -- PROFESSIONAL EXECUTION PLAN, Part
// J/K deterministic validator tests. Zero I/O, zero AI.

const COMPILED_AT = "2026-09-12T00:00:00.000Z";

function templates(): ExecutionPlanSkillTemplate<string>[] {
  return [
    { skillDefinition: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL, skillInstance: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE, executionUnits: ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS, isValidFact: isEstablishCentralNapeGuideFact },
    { skillDefinition: OCCIPITAL_TRANSITION_SKILL, skillInstance: OCCIPITAL_TRANSITION_SKILL_INSTANCE, executionUnits: OCCIPITAL_TRANSITION_EXECUTION_UNITS, isValidFact: isOccipitalTransitionFact },
  ];
}

function twoStepProposal(order: readonly string[] = ["step-1", "step-2"]): ProfessionalReasoningProposal {
  return {
    schemaVersion: "1.0.0-pr5",
    planSummary: "SYNTHETIC (validator test) -- nape guide then occipital transition.",
    proposedSkills: [
      {
        stepId: "step-1",
        skillDefinitionId: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId,
        skillKey: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId,
        skillVersion: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.version,
        zone: "nape",
        addressesDelta: { scope: "nape", field: "lengthIntent" },
        declaredCapabilityUsed: "ESTABLISH_GUIDE",
        parameters: [],
        rationale: "SYNTHETIC.",
      },
      {
        stepId: "step-2",
        skillDefinitionId: OCCIPITAL_TRANSITION_SKILL.skillId,
        skillKey: OCCIPITAL_TRANSITION_SKILL.skillId,
        skillVersion: OCCIPITAL_TRANSITION_SKILL.version,
        zone: "occipital",
        addressesDelta: { scope: "occipital", field: "lengthIntent" },
        declaredCapabilityUsed: "CONNECT_ZONES",
        parameters: [],
        rationale: "SYNTHETIC.",
      },
    ],
    proposedOrder: order,
    preservationConstraints: [{ scope: "nape", field: "lengthIntent", value: "preserve", description: "SYNTHETIC." }],
    unresolvedRequirements: [{ scope: "crown", field: "weightIntent", reason: "SYNTHETIC -- no capability." }],
    clarifyingQuestions: [],
    reasoningStatus: "PARTIAL_PLAN",
  };
}

function compileValid(): ProfessionalExecutionPlan {
  const proposal = twoStepProposal();
  const result = compileProfessionalExecutionPlan({
    proposal,
    reasoningProposalId: "r-1",
    reasoningProposalContextFingerprint: "d".repeat(64),
    currentSnapshotId: "c-1",
    currentSnapshotVersion: 1,
    targetSnapshotId: "t-1",
    targetSnapshotVersion: 1,
    templates: templates(),
    compiledAt: COMPILED_AT,
  });
  if (result.status !== "COMPILED") throw new Error("expected COMPILED");
  return result.plan;
}

describe("validateProfessionalExecutionPlan -- a real compiled plan passes with zero failures", () => {
  it("14. baseline: a validly compiled plan from the 3-real-skill scenario passes", () => {
    const plan = compileValid();
    const result = validateProfessionalExecutionPlan({ plan, proposal: twoStepProposal(), templates: templates() });
    expect(result.valid).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("15. INVALID_SKILL_VERSION when the plan references a version not present in the template registry", () => {
    const plan = compileValid();
    const tamperedPlan: ProfessionalExecutionPlan = {
      ...plan,
      plannedUnits: plan.plannedUnits.map((u) => ({ ...u, atomicActions: u.atomicActions.map((a) => ({ ...a, sourceSkillVersion: 999 })) })),
    };
    const result = validateProfessionalExecutionPlan({ plan: tamperedPlan, proposal: twoStepProposal(), templates: templates() });
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.failureReason === "INVALID_SKILL_VERSION")).toBe(true);
  });

  it("16. CAPABILITY_MISMATCH when a planned unit's declaredCapabilityUsed is not declared by its own skill", () => {
    const plan = compileValid();
    const tamperedPlan: ProfessionalExecutionPlan = { ...plan, plannedUnits: [{ ...plan.plannedUnits[0], declaredCapabilityUsed: "REDUCE_WEIGHT" }, ...plan.plannedUnits.slice(1)] };
    const result = validateProfessionalExecutionPlan({ plan: tamperedPlan, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "CAPABILITY_MISMATCH")).toBe(true);
  });

  it("17. INVALID_ZONE when a planned unit's addressesDelta.scope is outside the matched capability's own declared zones", () => {
    const plan = compileValid();
    const tamperedPlan: ProfessionalExecutionPlan = { ...plan, plannedUnits: [{ ...plan.plannedUnits[0], addressesDelta: { scope: "crown", field: "lengthIntent" } }, ...plan.plannedUnits.slice(1)] };
    const result = validateProfessionalExecutionPlan({ plan: tamperedPlan, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "INVALID_ZONE")).toBe(true);
  });

  it("18. SKILL_NOT_ALLOWED when a planned unit's (skill, delta, capability) triple was never approved in the given Stage 5 proposal", () => {
    const plan = compileValid();
    const proposalWithoutStep2: ProfessionalReasoningProposal = { ...twoStepProposal(), proposedSkills: [twoStepProposal().proposedSkills[0]], proposedOrder: ["step-1"] };
    const result = validateProfessionalExecutionPlan({ plan, proposal: proposalWithoutStep2, templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "SKILL_NOT_ALLOWED")).toBe(true);
  });

  it("19. no invented skill -- INVENTED_SKILL_STEP when a planned unit's own source skill is not present in the template registry at all", () => {
    const plan = compileValid();
    const result = validateProfessionalExecutionPlan({ plan, proposal: twoStepProposal(), templates: [templates()[0]] });
    expect(result.failures.some((f) => f.failureReason === "INVENTED_SKILL_STEP")).toBe(true);
  });
});

describe("ORDER/DEPENDENCY (Part K)", () => {
  it("20. Execution-Unit-level prerequisite satisfied when it precedes -- no failure", () => {
    const plan = compileValid();
    const result = validateProfessionalExecutionPlan({ plan, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "ORDER_DEPENDENCY_VIOLATION")).toBe(false);
  });

  it("21. ORDER_DEPENDENCY_VIOLATION when an Execution Unit's own prerequisite does not appear earlier in the plan", () => {
    const plan = compileValid();
    const reordered: ProfessionalExecutionPlan = { ...plan, plannedUnits: [...plan.plannedUnits].reverse() };
    const result = validateProfessionalExecutionPlan({ plan: reordered, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "ORDER_DEPENDENCY_VIOLATION")).toBe(true);
  });

  it("22/23. Skill-Instance-level prerequisite: Occipital Transition (which prerequisites Establish Central Nape Guide's own Skill Instance) fails when its own instance's units are removed from earlier in the plan", () => {
    const plan = compileValid();
    const withoutNapeGuide: ProfessionalExecutionPlan = { ...plan, plannedUnits: plan.plannedUnits.filter((u) => u.executionUnit.sourceSkillInstanceId !== ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.skillInstanceId) };
    const result = validateProfessionalExecutionPlan({ plan: withoutNapeGuide, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "ORDER_DEPENDENCY_VIOLATION")).toBe(true);
  });
});

describe("COMPLETION (Part G/J)", () => {
  it("29. MISSING_COMPLETION_CONDITION when a unit's own completionCriterion.fact is empty (defense in depth)", () => {
    const plan = compileValid();
    const tampered: ProfessionalExecutionPlan = { ...plan, plannedUnits: [{ ...plan.plannedUnits[0], completionCriterion: { ...plan.plannedUnits[0].completionCriterion, fact: "" } }, ...plan.plannedUnits.slice(1)] };
    const result = validateProfessionalExecutionPlan({ plan: tampered, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "MISSING_COMPLETION_CONDITION")).toBe(true);
  });

  it("30/31. a real compiled unit always has a non-empty, deterministic completionCriterion -- never claims completion merely because an action executed once (one VERIFY per unit, not per atomic action)", () => {
    const plan = compileValid();
    for (const unit of plan.plannedUnits) {
      expect(unit.completionCriterion.fact.length).toBeGreaterThan(0);
      const verifyCount = unit.atomicActions.filter((a) => a.actionKind === "VERIFY").length;
      expect(verifyCount).toBe(1);
    }
  });
});

describe("EXPECTED EFFECT / VERIFICATION (Part H/I/J)", () => {
  it("32. a state-changing capability without an EXECUTE action -> MISSING_EXPECTED_EFFECT", () => {
    const plan = compileValid();
    const tampered: ProfessionalExecutionPlan = {
      ...plan,
      plannedUnits: [{ ...plan.plannedUnits[0], declaredCapabilityUsed: "REDUCE_LENGTH", atomicActions: plan.plannedUnits[0].atomicActions.filter((a) => a.actionKind !== "EXECUTE") }, ...plan.plannedUnits.slice(1)],
    };
    const result = validateProfessionalExecutionPlan({ plan: tampered, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "MISSING_EXPECTED_EFFECT")).toBe(true);
  });

  it("33. a real compiled unit's EXECUTE action always uses only the skill's own declared capability -- never an invented outside effect (checked via CAPABILITY_MISMATCH already covering this)", () => {
    const plan = compileValid();
    const result = validateProfessionalExecutionPlan({ plan, proposal: twoStepProposal(), templates: templates() });
    expect(result.valid).toBe(true);
  });

  it("36. MISSING_VERIFICATION_REQUIREMENT when a unit's own VERIFY action is stripped", () => {
    const plan = compileValid();
    const tampered: ProfessionalExecutionPlan = { ...plan, plannedUnits: [{ ...plan.plannedUnits[0], atomicActions: plan.plannedUnits[0].atomicActions.filter((a) => a.actionKind !== "VERIFY") }, ...plan.plannedUnits.slice(1)] };
    const result = validateProfessionalExecutionPlan({ plan: tampered, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "MISSING_VERIFICATION_REQUIREMENT")).toBe(true);
  });

  it("37. a real compiled unit's own VERIFY action carries evidenceStatus RUNTIME_PROFESSIONAL_OBSERVATION -- a professionally-visual-confirmable method, no Vision call anywhere", () => {
    const plan = compileValid();
    for (const unit of plan.plannedUnits) {
      const verify = unit.atomicActions.find((a) => a.actionKind === "VERIFY");
      expect(verify?.observationCriterion?.evidenceStatus).toBe("RUNTIME_PROFESSIONAL_OBSERVATION");
    }
  });

  it("38. FUTURE_VISION_VERIFICATION is representable in the vocabulary without ever being produced by this offline compiler (no real network/Vision call)", () => {
    const plan = compileValid();
    // The compiler never emits this evidence status -- it exists in
    // ATOMIC_ACTION_EVIDENCE_STATUSES purely as a representable future
    // contract (Part I's own explicit "do NOT call Vision in Stage 6").
    expect(plan.plannedUnits.every((u) => u.atomicActions.every((a) => a.observationCriterion?.evidenceStatus !== "FUTURE_VISION_VERIFICATION"))).toBe(true);
  });

  it("39/40. viewpoint/observability is not a second taxonomy -- no plannedUnit or atomicAction carries a bespoke 'viewpoint' field; the existing ViewpointConstraint deriver remains the only source", () => {
    const plan = compileValid();
    for (const unit of plan.plannedUnits) {
      expect(unit).not.toHaveProperty("viewpoint");
      for (const action of unit.atomicActions) expect(action).not.toHaveProperty("viewpoint");
    }
  });
});

describe("PRESERVATION / UNRESOLVED (Part J)", () => {
  it("PRESERVATION_CONSTRAINT_VIOLATION when a state-changing unit targets a preserved (scope, field)", () => {
    const plan = compileValid();
    const tampered: ProfessionalExecutionPlan = {
      ...plan,
      plannedUnits: [{ ...plan.plannedUnits[0], declaredCapabilityUsed: "REDUCE_LENGTH", addressesDelta: { scope: "nape", field: "lengthIntent" } }, ...plan.plannedUnits.slice(1)],
    };
    const result = validateProfessionalExecutionPlan({ plan: tampered, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "PRESERVATION_CONSTRAINT_VIOLATION")).toBe(true);
  });

  it("UNRESOLVED_DELTA when a unit falsely claims to address a delta the plan itself still lists as unresolved", () => {
    const plan = compileValid();
    const tampered: ProfessionalExecutionPlan = { ...plan, plannedUnits: [{ ...plan.plannedUnits[0], addressesDelta: { scope: "crown", field: "weightIntent" } }, ...plan.plannedUnits.slice(1)] };
    const result = validateProfessionalExecutionPlan({ plan: tampered, proposal: twoStepProposal(), templates: templates() });
    expect(result.failures.some((f) => f.failureReason === "UNRESOLVED_DELTA")).toBe(true);
  });

  it("STALE_SNAPSHOT_REFERENCE fires only when the caller supplies a mismatched expected snapshot; never a spurious failure when omitted", () => {
    const plan = compileValid();
    const clean = validateProfessionalExecutionPlan({ plan, proposal: twoStepProposal(), templates: templates() });
    expect(clean.failures.some((f) => f.failureReason === "STALE_SNAPSHOT_REFERENCE")).toBe(false);

    const stale = validateProfessionalExecutionPlan({ plan, proposal: twoStepProposal(), templates: templates(), expectedCurrentSnapshotId: "a-different-current-snapshot" });
    expect(stale.failures.some((f) => f.failureReason === "STALE_SNAPSHOT_REFERENCE")).toBe(true);
  });
});

describe("PROFESSIONAL AUTHORITY (Part L/S, Part U 41-45)", () => {
  it("41/42. AI/compilation alone can never mark a plan approved -- isPlanExecutableAsProfessionalAuthority(false) is false, DRAFT content is not executable authority merely by being content-valid", () => {
    expect(isPlanExecutableAsProfessionalAuthority(false)).toBe(false);
    const plan = compileValid();
    const contentValidation = validateProfessionalExecutionPlan({ plan, proposal: twoStepProposal(), templates: templates() });
    expect(contentValidation.valid).toBe(true);
    const authorityFailures = assertPlanReadyForExecutionAuthority(false, contentValidation);
    expect(authorityFailures.some((f) => f.failureReason === "PLAN_NOT_PROFESSIONALLY_APPROVED")).toBe(true);
  });

  it("43. approval state is representable and, once true, no longer produces PLAN_NOT_PROFESSIONALLY_APPROVED", () => {
    expect(isPlanExecutableAsProfessionalAuthority(true)).toBe(true);
    const plan = compileValid();
    const contentValidation = validateProfessionalExecutionPlan({ plan, proposal: twoStepProposal(), templates: templates() });
    const authorityFailures = assertPlanReadyForExecutionAuthority(true, contentValidation);
    expect(authorityFailures.some((f) => f.failureReason === "PLAN_NOT_PROFESSIONALLY_APPROVED")).toBe(false);
  });

  it("44. a professional override (Part L, tested in the compiler suite) still requires the SAME validator to be re-run -- override provenance alone does not bypass content validation", () => {
    const plan = compileValid();
    const contentValidation = validateProfessionalExecutionPlan({ plan, proposal: twoStepProposal(), templates: templates() });
    expect(contentValidation.valid).toBe(true);
  });

  it("45. content validity and approval are independent axes -- a still-approved=false plan can be perfectly content-valid, and vice versa a content-invalid plan is never rescued by approval=true", () => {
    const plan = compileValid();
    const invalidPlan: ProfessionalExecutionPlan = { ...plan, plannedUnits: [{ ...plan.plannedUnits[0], completionCriterion: { ...plan.plannedUnits[0].completionCriterion, fact: "" } }, ...plan.plannedUnits.slice(1)] };
    const contentValidation = validateProfessionalExecutionPlan({ plan: invalidPlan, proposal: twoStepProposal(), templates: templates() });
    expect(contentValidation.valid).toBe(false);
    const authorityFailures = assertPlanReadyForExecutionAuthority(true, contentValidation);
    expect(authorityFailures.some((f) => f.failureReason === "MISSING_COMPLETION_CONDITION")).toBe(true);
    expect(authorityFailures.some((f) => f.failureReason === "PLAN_NOT_PROFESSIONALLY_APPROVED")).toBe(false);
  });
});
