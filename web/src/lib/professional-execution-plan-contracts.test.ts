import { describe, expect, it } from "vitest";

import {
  EXECUTION_PLAN_PARAMETER_SOURCES,
  PROFESSIONAL_EXECUTION_PLAN_READINESS_STATES,
  PROFESSIONAL_EXECUTION_PLAN_SCHEMA_VERSION,
  isExecutionPlanFailureReason,
  isExecutionPlanParameterSource,
  isProfessionalExecutionPlanReadiness,
  isValidPlannedExecutionUnit,
  isValidProfessionalExecutionPlan,
  type PlannedExecutionUnit,
  type ProfessionalExecutionPlan,
} from "@/lib/professional-execution-plan-contracts";
import type { ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";
import type { AtomicAction } from "@/lib/professional-skill-atomic-action-contracts";

// Professional Skill Engine, Stage 6 -- PROFESSIONAL EXECUTION PLAN,
// contract/foundation tests. SYNTHETIC TEST FIXTURE -- not real
// professional authority. Pure, zero I/O, zero AI.

type Fact = "someFact";
const isFact = (v: unknown): v is Fact => v === "someFact";

function syntheticExecutionUnit(overrides: Partial<ExecutionUnit<Fact>> = {}): ExecutionUnit<Fact> {
  return {
    executionUnitId: "eu-1",
    vertical: "cutting",
    order: 1,
    label: "SYNTHETIC unit",
    sourceSkillInstanceId: "skillinstance-synthetic",
    createdAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

function syntheticAtomicAction(overrides: Partial<AtomicAction<Fact>> = {}): AtomicAction<Fact> {
  return {
    atomicActionId: "eu-1#control",
    vertical: "cutting",
    order: 1,
    actionKind: "CONTROL",
    sourceExecutionUnitId: "eu-1",
    sourceSkillId: "skill-synthetic",
    sourceSkillVersion: 1,
    presentationSummary: "SYNTHETIC action.",
    compiledAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

function syntheticVerifyAction(): AtomicAction<Fact> {
  return syntheticAtomicAction({
    atomicActionId: "eu-1#verify",
    order: 2,
    actionKind: "VERIFY",
    observationCriterion: { fact: "eu-1.completed", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" },
  });
}

function syntheticPlannedUnit(overrides: Partial<PlannedExecutionUnit<Fact>> = {}): PlannedExecutionUnit<Fact> {
  return {
    executionUnit: syntheticExecutionUnit(),
    atomicActions: [syntheticAtomicAction(), syntheticVerifyAction()],
    addressesDelta: { scope: "nape", field: "lengthIntent" },
    declaredCapabilityUsed: "ESTABLISH_GUIDE",
    completionCriterion: { fact: "eu-1.completed", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" },
    resolvedParameters: [{ name: "controlMethod", value: "comb", source: "SKILL_DEFAULT" }],
    ...overrides,
  };
}

function syntheticPlan(overrides: Partial<ProfessionalExecutionPlan<Fact>> = {}): ProfessionalExecutionPlan<Fact> {
  return {
    schemaVersion: PROFESSIONAL_EXECUTION_PLAN_SCHEMA_VERSION,
    currentSnapshotId: "current-1",
    currentSnapshotVersion: 1,
    targetSnapshotId: "target-1",
    targetSnapshotVersion: 1,
    reasoningProposalId: "proposal-1",
    reasoningProposalContextFingerprint: "a".repeat(64),
    plannedUnits: [syntheticPlannedUnit()],
    preservationConstraints: [{ scope: "nape", field: "lengthIntent", value: "preserve", description: "SYNTHETIC." }],
    unresolvedRequirements: [{ scope: "crown", field: "weightIntent", reason: "SYNTHETIC -- no capability." }],
    readiness: "NEEDS_SKILL",
    ...overrides,
  };
}

describe("professional-execution-plan-contracts", () => {
  it("1. EXECUTION_PLAN_PARAMETER_SOURCES is the exact 6-value closed set from the task's own Part E", () => {
    expect([...EXECUTION_PLAN_PARAMETER_SOURCES]).toEqual(["OBSERVED", "INFERRED", "AI_PROPOSED", "PROFESSIONAL_OVERRIDE", "CLIENT_REPORTED", "SKILL_DEFAULT"]);
    for (const v of EXECUTION_PLAN_PARAMETER_SOURCES) expect(isExecutionPlanParameterSource(v)).toBe(true);
    expect(isExecutionPlanParameterSource("INVENTED")).toBe(false);
  });

  it("2. PROFESSIONAL_EXECUTION_PLAN_READINESS_STATES is the exact 5-value closed set", () => {
    expect([...PROFESSIONAL_EXECUTION_PLAN_READINESS_STATES]).toEqual(["READY_FOR_PROFESSIONAL_REVIEW", "PARTIAL", "NEEDS_SKILL", "NEEDS_INPUT", "BLOCKED"]);
    for (const v of PROFESSIONAL_EXECUTION_PLAN_READINESS_STATES) expect(isProfessionalExecutionPlanReadiness(v)).toBe(true);
  });

  it("3. EXECUTION_PLAN_FAILURE_REASONS includes the task's own literal 14-value Part T list", () => {
    const required = [
      "MISSING_REQUIRED_PARAMETER",
      "UNKNOWN_CONDITIONAL_PARAMETER",
      "INVALID_SKILL_VERSION",
      "SKILL_NOT_ALLOWED",
      "CAPABILITY_MISMATCH",
      "INVALID_ZONE",
      "UNSATISFIED_PRECONDITION",
      "ORDER_DEPENDENCY_VIOLATION",
      "PRESERVATION_CONSTRAINT_VIOLATION",
      "MISSING_COMPLETION_CONDITION",
      "MISSING_EXPECTED_EFFECT",
      "MISSING_VERIFICATION_REQUIREMENT",
      "UNRESOLVED_DELTA",
      "PLAN_NOT_PROFESSIONALLY_APPROVED",
    ];
    for (const reason of required) expect(isExecutionPlanFailureReason(reason)).toBe(true);
    expect(isExecutionPlanFailureReason("NOT_A_REAL_REASON")).toBe(false);
  });

  it("4. a structurally valid PlannedExecutionUnit passes isValidPlannedExecutionUnit", () => {
    expect(isValidPlannedExecutionUnit(syntheticPlannedUnit(), isFact)).toBe(true);
  });

  it("5. a PlannedExecutionUnit with an invalid declaredCapabilityUsed is rejected", () => {
    expect(isValidPlannedExecutionUnit({ ...syntheticPlannedUnit(), declaredCapabilityUsed: "INVENTED_CAPABILITY" }, isFact)).toBe(false);
  });

  it("6. a PlannedExecutionUnit whose atomicActions is not a valid sequence is rejected", () => {
    expect(isValidPlannedExecutionUnit({ ...syntheticPlannedUnit(), atomicActions: [syntheticAtomicAction({ order: 2 })] }, isFact)).toBe(false);
  });

  it("7. a PlannedExecutionUnit whose completionCriterion has an invalid evidenceStatus is rejected", () => {
    expect(isValidPlannedExecutionUnit({ ...syntheticPlannedUnit(), completionCriterion: { fact: "x", expectedValue: true, evidenceStatus: "INVENTED_STATUS" } }, isFact)).toBe(false);
  });

  it("8. a resolvedParameters entry with an invalid source is rejected", () => {
    expect(isValidPlannedExecutionUnit({ ...syntheticPlannedUnit(), resolvedParameters: [{ name: "x", value: "y", source: "INVENTED_SOURCE" }] }, isFact)).toBe(false);
  });

  it("9/10. a structurally valid ProfessionalExecutionPlan passes isValidProfessionalExecutionPlan; binds exact snapshot/proposal identity", () => {
    const plan = syntheticPlan();
    expect(isValidProfessionalExecutionPlan(plan, isFact)).toBe(true);
    expect(plan.currentSnapshotId).toBe("current-1");
    expect(plan.currentSnapshotVersion).toBe(1);
    expect(plan.targetSnapshotId).toBe("target-1");
    expect(plan.reasoningProposalId).toBe("proposal-1");
  });

  it("11. a plan with a non-integer/zero snapshot version is rejected -- fails closed", () => {
    expect(isValidProfessionalExecutionPlan({ ...syntheticPlan(), currentSnapshotVersion: 0 }, isFact)).toBe(false);
    expect(isValidProfessionalExecutionPlan({ ...syntheticPlan(), targetSnapshotVersion: 1.5 }, isFact)).toBe(false);
  });

  it("12. a plan with an invalid readiness value is rejected", () => {
    expect(isValidProfessionalExecutionPlan({ ...syntheticPlan(), readiness: "INVENTED_READINESS" }, isFact)).toBe(false);
  });

  it("13. unresolvedRequirements/preservationConstraints are preserved verbatim on a valid plan -- never silently dropped", () => {
    const plan = syntheticPlan();
    expect(plan.unresolvedRequirements).toEqual([{ scope: "crown", field: "weightIntent", reason: "SYNTHETIC -- no capability." }]);
    expect(plan.preservationConstraints).toEqual([{ scope: "nape", field: "lengthIntent", value: "preserve", description: "SYNTHETIC." }]);
  });

  it("14. a plan with a malformed preservationConstraints entry is rejected", () => {
    expect(isValidProfessionalExecutionPlan({ ...syntheticPlan(), preservationConstraints: [{ scope: "nape" }] }, isFact)).toBe(false);
  });

  it("15. a plan with a malformed unresolvedRequirements entry is rejected", () => {
    expect(isValidProfessionalExecutionPlan({ ...syntheticPlan(), unresolvedRequirements: [{ scope: "crown" }] }, isFact)).toBe(false);
  });
});
