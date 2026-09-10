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
import {
  CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL,
  CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE,
  CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS,
  isContinueCentralNapeConstructionFact,
} from "@/lib/cutting-skill-continue-central-nape-construction";
import { applyProfessionalParameterOverride, compileProfessionalExecutionPlan, rejectPlannedExecutionUnit, type ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import { validateProfessionalExecutionPlan } from "@/lib/professional-execution-plan-validator";
import { isValidProfessionalExecutionPlan } from "@/lib/professional-execution-plan-contracts";

// Professional Skill Engine, Stage 6 -- PROFESSIONAL EXECUTION PLAN, Part
// O compiler tests, INCLUDING the required end-to-end proof using ONLY
// the 3 real, already-authorized skills (Part N/O). Zero I/O, zero AI,
// zero paid provider call anywhere in this file.

const COMPILED_AT = "2026-09-12T00:00:00.000Z";

function realTemplates(): ExecutionPlanSkillTemplate<string>[] {
  return [
    {
      skillDefinition: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
      skillInstance: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      executionUnits: ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
      isValidFact: isEstablishCentralNapeGuideFact,
    },
    {
      skillDefinition: OCCIPITAL_TRANSITION_SKILL,
      skillInstance: OCCIPITAL_TRANSITION_SKILL_INSTANCE,
      executionUnits: OCCIPITAL_TRANSITION_EXECUTION_UNITS,
      isValidFact: isOccipitalTransitionFact,
    },
    {
      skillDefinition: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL,
      skillInstance: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE,
      executionUnits: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS,
      isValidFact: isContinueCentralNapeConstructionFact,
    },
  ];
}

// The canonical Stage 4/5 scenario reused across this engagement: nape
// length preserved (guide established, then continued), occipital
// transition connecting nape to occipital, and an HONEST, unresolved
// crown weight-reduction requirement -- no registered skill declares that
// capability, and this proof must never invent one.
function realProposal(): ProfessionalReasoningProposal {
  return {
    schemaVersion: "1.0.0-pr5",
    planSummary: "Establish the central nape guide, transition through the occipital curvature, and continue nape construction; crown weight reduction remains unsupported.",
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
        rationale: "SYNTHETIC (proof) -- establishes the central nape reference guide.",
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
        rationale: "SYNTHETIC (proof) -- connects nape and occipital across the anatomical threshold.",
      },
      {
        stepId: "step-3",
        skillDefinitionId: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.skillId,
        skillKey: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.skillId,
        skillVersion: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.version,
        zone: "nape",
        addressesDelta: { scope: "nape", field: "lengthIntent" },
        declaredCapabilityUsed: "PRESERVE_LENGTH",
        parameters: [],
        rationale: "SYNTHETIC (proof) -- continues nape construction subsection-by-subsection.",
      },
    ],
    proposedOrder: ["step-1", "step-2", "step-3"],
    preservationConstraints: [
      { scope: "nape", field: "lengthIntent", value: "preserve", description: "Preserve length at zone \"nape\"." },
      { scope: "occipital", field: "lengthIntent", value: "preserve", description: "Preserve length at zone \"occipital\"." },
    ],
    unresolvedRequirements: [{ scope: "crown", field: "weightIntent", reason: "No registered skill declares capability to reduce weight in the crown zone." }],
    clarifyingQuestions: [],
    reasoningStatus: "PARTIAL_PLAN",
  };
}

function compileRealProof() {
  return compileProfessionalExecutionPlan({
    proposal: realProposal(),
    reasoningProposalId: "reasoning-proposal-proof-1",
    reasoningProposalContextFingerprint: "b".repeat(64),
    currentSnapshotId: "current-proof-1",
    currentSnapshotVersion: 1,
    targetSnapshotId: "target-proof-1",
    targetSnapshotVersion: 1,
    templates: realTemplates(),
    compiledAt: COMPILED_AT,
  });
}

describe("PART O -- end-to-end proof, using ONLY the 3 real registered skills", () => {
  it("compiles successfully into a structurally valid ProfessionalExecutionPlan", () => {
    const result = compileRealProof();
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(isValidProfessionalExecutionPlan(result.plan, (c): c is string => typeof c === "string")).toBe(true);
  });

  it("EXECUTION UNIT 1 -- Establish Central Nape Guide: START (no established guide) -> ACTION (registered guide skill) -> EXPECTED EFFECT (guide established) -> VERIFY", () => {
    const result = compileRealProof();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const unit1 = result.plan.plannedUnits[0];
    expect(unit1.executionUnit.executionUnitId).toBe("executionunit-cutting-establish-central-nape-guide-1");
    expect(unit1.declaredCapabilityUsed).toBe("ESTABLISH_GUIDE");
    expect(unit1.atomicActions.some((a) => a.actionKind === "EXECUTE")).toBe(true);
    const verify = unit1.atomicActions.find((a) => a.actionKind === "VERIFY");
    expect(verify?.observationCriterion?.evidenceStatus).toBe("RUNTIME_PROFESSIONAL_OBSERVATION");
    expect(unit1.completionCriterion.fact).toBe("executionunit-cutting-establish-central-nape-guide-1.completed");
  });

  it("EXECUTION UNIT 2 -- Occipital Transition: requires Unit 1's own guide (order/dependency), progresses through the whole zone (2 sub-units, not one cut), completion is zone completion", () => {
    const result = compileRealProof();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const occipitalUnits = result.plan.plannedUnits.filter((u) => u.executionUnit.sourceSkillInstanceId === OCCIPITAL_TRANSITION_SKILL_INSTANCE.skillInstanceId);
    expect(occipitalUnits).toHaveLength(2);
    expect(occipitalUnits[0].executionUnit.executionUnitId).toBe("executionunit-cutting-occipital-transition-lower-1");
    expect(occipitalUnits[1].executionUnit.executionUnitId).toBe("executionunit-cutting-occipital-transition-upper-1");
    expect(occipitalUnits[1].executionUnit.prerequisiteExecutionUnitIds).toContain("executionunit-cutting-occipital-transition-lower-1");
    // The real controlMethod REQUIRED_FIXED rule resolves distinctly per
    // sub-unit (comb below, fingers above) via SKILL_DEFAULT provenance --
    // never a single, undifferentiated parameter for the whole zone.
    expect(occipitalUnits[0].resolvedParameters.find((p) => p.name === "controlMethod")).toEqual({ name: "controlMethod", value: "comb", source: "SKILL_DEFAULT" });
    expect(occipitalUnits[1].resolvedParameters.find((p) => p.name === "controlMethod")).toEqual({ name: "controlMethod", value: "fingers", source: "SKILL_DEFAULT" });
    for (const unit of occipitalUnits) expect(unit.declaredCapabilityUsed).toBe("CONNECT_ZONES");
  });

  it("Continue Central Nape Construction compiles with its own real bounded iteration policy (Part F) -- structural, never free-form-prose-only", () => {
    const result = compileRealProof();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const continueUnit = result.plan.plannedUnits.find((u) => u.executionUnit.sourceSkillInstanceId === CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE.skillInstanceId);
    expect(continueUnit).toBeDefined();
    const iteratedActions = continueUnit!.atomicActions.filter((a) => a.iteration !== undefined);
    expect(iteratedActions.length).toBeGreaterThan(0);
    for (const action of iteratedActions) {
      expect(action.iteration?.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    }
  });

  it("the crown weight-reduction delta remains unresolved -- no fake step is created for it, and the plan does not pretend completeness", () => {
    const result = compileRealProof();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(result.plan.unresolvedRequirements).toEqual([{ scope: "crown", field: "weightIntent", reason: "No registered skill declares capability to reduce weight in the crown zone." }]);
    expect(result.plan.plannedUnits.some((u) => u.addressesDelta.scope === "crown")).toBe(false);
    expect(result.plan.readiness).toBe("NEEDS_SKILL");
  });

  it("PIPELINE -- the compiled plan passes the deterministic validator with zero content failures, zero additional AI call, zero video call (nothing in this file imports a provider/video module)", () => {
    const result = compileRealProof();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const validation = validateProfessionalExecutionPlan({ plan: result.plan, proposal: realProposal(), templates: realTemplates() });
    expect(validation.valid).toBe(true);
    expect(validation.failures).toEqual([]);
  });

  it("plan remains DRAFT-equivalent (compilation alone never implies approval) -- the compiler never sets/returns a confirmed/approved flag", () => {
    const result = compileRealProof();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(result.plan).not.toHaveProperty("status");
    expect(result.plan).not.toHaveProperty("confirmedByUserId");
  });
});

describe("compileProfessionalExecutionPlan -- failure semantics", () => {
  it("SKILL_NOT_ALLOWED when a proposed step names a skill outside the given template registry", () => {
    const proposal = realProposal();
    const result = compileProfessionalExecutionPlan({
      proposal,
      reasoningProposalId: "r-1",
      reasoningProposalContextFingerprint: "c".repeat(64),
      currentSnapshotId: "c-1",
      currentSnapshotVersion: 1,
      targetSnapshotId: "t-1",
      targetSnapshotVersion: 1,
      templates: [],
      compiledAt: COMPILED_AT,
    });
    expect(result).toMatchObject({ status: "UNRESOLVED", failureReason: "SKILL_NOT_ALLOWED" });
  });

  it("CAPABILITY_MISMATCH when a step declares a capability the matched skill never declares", () => {
    const base = realProposal();
    const proposal = { ...base, proposedSkills: [{ ...base.proposedSkills[0], declaredCapabilityUsed: "REDUCE_WEIGHT" as const }, ...base.proposedSkills.slice(1)] };
    const result = compileProfessionalExecutionPlan({
      proposal,
      reasoningProposalId: "r-1",
      reasoningProposalContextFingerprint: "c".repeat(64),
      currentSnapshotId: "c-1",
      currentSnapshotVersion: 1,
      targetSnapshotId: "t-1",
      targetSnapshotVersion: 1,
      templates: [realTemplates()[0]],
      compiledAt: COMPILED_AT,
    });
    expect(result).toMatchObject({ status: "UNRESOLVED", failureReason: "CAPABILITY_MISMATCH" });
  });
});

describe("Part L -- minimal professional-authority operations (pure, never mutate input)", () => {
  it("applyProfessionalParameterOverride replaces one unit's parameter with PROFESSIONAL_OVERRIDE provenance, preserves the original plan value, and triggers revalidated readiness", () => {
    const result = compileRealProof();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const original = result.plan;
    const lowerUnitId = "executionunit-cutting-occipital-transition-lower-1";

    const edited = applyProfessionalParameterOverride(original, lowerUnitId, "controlMethod", "fingers");

    expect(edited).not.toBe(original);
    expect(original.plannedUnits.find((u) => u.executionUnit.executionUnitId === lowerUnitId)!.resolvedParameters.find((p) => p.name === "controlMethod")).toEqual({
      name: "controlMethod",
      value: "comb",
      source: "SKILL_DEFAULT",
    });
    expect(edited.plannedUnits.find((u) => u.executionUnit.executionUnitId === lowerUnitId)!.resolvedParameters.find((p) => p.name === "controlMethod")).toEqual({
      name: "controlMethod",
      value: "fingers",
      source: "PROFESSIONAL_OVERRIDE",
    });
  });

  it("rejectPlannedExecutionUnit removes one unit and produces a NEW plan, without touching the original plan -- readiness stays NEEDS_SKILL here since the crown delta is still unresolved (higher priority than the newly-dropped-step PARTIAL signal)", () => {
    const result = compileRealProof();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const original = result.plan;
    const continueUnitId = "executionunit-cutting-continue-central-nape-construction-1";

    const edited = rejectPlannedExecutionUnit(original, continueUnitId);

    expect(original.plannedUnits.some((u) => u.executionUnit.executionUnitId === continueUnitId)).toBe(true);
    expect(edited.plannedUnits.some((u) => u.executionUnit.executionUnitId === continueUnitId)).toBe(false);
    expect(edited.readiness).toBe("NEEDS_SKILL");
  });

  it("rejectPlannedExecutionUnit rolls up to PARTIAL when no other readiness signal outranks the dropped step (no unresolved requirements, no unit defects)", () => {
    const result = compileRealProof();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const noUnresolved = { ...result.plan, unresolvedRequirements: [] };
    const edited = rejectPlannedExecutionUnit(noUnresolved, "executionunit-cutting-continue-central-nape-construction-1");
    expect(edited.readiness).toBe("PARTIAL");
  });
});
