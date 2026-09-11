import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { PROFESSIONAL_BRAIN_SKILL_TEMPLATES, buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { isSkillEligibleForAuthority } from "@/lib/professional-skill-contracts";
import { compileProfessionalExecutionPlan, type ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import { compileProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-compiler";
import { compileAllVisualInstructionPackages } from "@/lib/professional-visual-instruction-compiler";
import { evaluateRenderReadiness } from "@/lib/professional-visual-instruction-readiness";
import type { ProfessionalReasoningProposal } from "@/lib/professional-reasoning-contracts";
import type { ProfessionalExecutionPlan } from "@/lib/professional-execution-plan-contracts";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import { unassessedFact, buildUnassessedZoneEntry } from "@/lib/hair-state-snapshot-validators";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import type { HairStateSnapshotDeltaInput } from "@/lib/hair-state-delta";
import type { PreserveConstraintEntry } from "@/lib/technical-visual-map-validators";

// Byte-unchanged existing-3 constants, imported directly -- used to prove
// Stage 8.5S1B did not mutate them.
import { ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL } from "@/lib/cutting-skill-establish-central-nape-guide";
import { OCCIPITAL_TRANSITION_SKILL } from "@/lib/cutting-skill-occipital-transition";
import { CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL } from "@/lib/cutting-skill-continue-central-nape-construction";
import { GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { ONE_LENGTH_PERIMETER_SKILL } from "@/lib/cutting-skill-one-length-perimeter";
import { SLICE_AND_SLIDE_REFINEMENT_SKILL } from "@/lib/cutting-skill-slice-and-slide-refinement";

const COMPILED_AT = "2026-09-11T00:00:00.000Z";

describe("A. Registry integrity -- Stage 8.5S1B additive registration, zero disruption", () => {
  it("1. exactly 6 templates registered -- the original 3 plus the 3 new approved skills", () => {
    expect(PROFESSIONAL_BRAIN_SKILL_TEMPLATES.length).toBe(6);
    expect(buildCanonicalCandidateSkillRegistry().length).toBe(6);
  });

  it("2. no duplicate skillId+version pairs anywhere in the registry", () => {
    const keys = PROFESSIONAL_BRAIN_SKILL_TEMPLATES.map((t) => `${t.skillDefinition.skillId}@${t.skillDefinition.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("3. every registered skill is eligible authority (ACTIVE, PROFESSIONALLY_AUTHORED)", () => {
    for (const t of PROFESSIONAL_BRAIN_SKILL_TEMPLATES) {
      expect(isSkillEligibleForAuthority(t.skillDefinition)).toBe(true);
    }
  });

  it("4. the original three skills are present, byte-identical to their own direct exports -- never mutated by this stage", () => {
    const byKey = new Map(PROFESSIONAL_BRAIN_SKILL_TEMPLATES.map((t) => [t.skillDefinition.skillId, t.skillDefinition]));
    expect(byKey.get(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId)).toBe(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL);
    expect(byKey.get(OCCIPITAL_TRANSITION_SKILL.skillId)).toBe(OCCIPITAL_TRANSITION_SKILL);
    expect(byKey.get(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.skillId)).toBe(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL);
  });

  it("5. the three new skills are present with version 1, PROFESSIONALLY_AUTHORED, ACTIVE", () => {
    const byKey = new Map(PROFESSIONAL_BRAIN_SKILL_TEMPLATES.map((t) => [t.skillDefinition.skillId, t.skillDefinition]));
    for (const skill of [GRADUATED_CUTTING_SKILL, ONE_LENGTH_PERIMETER_SKILL, SLICE_AND_SLIDE_REFINEMENT_SKILL]) {
      const registered = byKey.get(skill.skillId);
      expect(registered).toBe(skill);
      expect(registered!.version).toBe(1);
      expect(registered!.status).toBe("ACTIVE");
      expect(registered!.authorityType).toBe("PROFESSIONALLY_AUTHORED");
    }
  });
});

function proposalFor(step: ProfessionalReasoningProposal["proposedSkills"][number]): ProfessionalReasoningProposal {
  return {
    schemaVersion: "1.0.0-pr5",
    planSummary: "SYNTHETIC (proof) -- Stage 8.5S1B new-skill Stage 6/7/8 pass-through.",
    proposedSkills: [step],
    proposedOrder: [step.stepId],
    preservationConstraints: [],
    unresolvedRequirements: [],
    clarifyingQuestions: [],
    reasoningStatus: "PARTIAL_PLAN",
  };
}

function compilePlan(proposal: ProfessionalReasoningProposal): ProfessionalExecutionPlan {
  const result = compileProfessionalExecutionPlan({
    proposal,
    reasoningProposalId: "reasoning-proposal-proof-8.5s1b",
    reasoningProposalContextFingerprint: "c".repeat(64),
    currentSnapshotId: "current-proof-8.5s1b",
    currentSnapshotVersion: 1,
    targetSnapshotId: "target-proof-8.5s1b",
    targetSnapshotVersion: 1,
    templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES,
    compiledAt: COMPILED_AT,
  });
  if (result.status !== "COMPILED") throw new Error(`Stage 6 did not compile: ${JSON.stringify(result)}`);
  return result.plan;
}

// One shared harness per new skill: Stage 6 -> Stage 7 -> Stage 8, all
// deterministic, ZERO AI/provider calls anywhere in this file.
function runStage678(skillId: string, skillVersion: number, zone: string, capability: ExecutionPlanSkillTemplate<string>["skillDefinition"]["capabilities"] extends readonly (infer C)[] | undefined ? (C extends { kind: infer K } ? K : never) : never) {
  const proposal = proposalFor({
    stepId: "step-1",
    skillDefinitionId: skillId,
    skillKey: skillId,
    skillVersion,
    zone,
    addressesDelta: { scope: zone, field: "lengthIntent" },
    declaredCapabilityUsed: capability,
    parameters: [],
    rationale: "SYNTHETIC (proof) -- Stage 8.5S1B pass-through.",
  });
  const plan = compilePlan(proposal);
  const sceneResult = compileProfessionalExecutionScenePlan({
    plan,
    sourceExecutionPlanId: `execution-plan-row-proof-8.5s1b-${skillId}`,
    templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES,
    compiledAt: COMPILED_AT,
  });
  return { plan, sceneResult };
}

describe("B. Graduated Cutting -- real Stage 6/7/8 pass-through, zero AI", () => {
  it("6. [Stage 8.5S1B.R1: 3, not 4, Execution Units -- the generalized model] compiles through Stage 6 into a real ProfessionalExecutionPlan with every Execution Unit represented", () => {
    const { plan } = runStage678(GRADUATED_CUTTING_SKILL.skillId, GRADUATED_CUTTING_SKILL.version, "crown", "MODIFY_PERIMETER_RELATIONSHIP");
    expect(plan.plannedUnits.length).toBe(3);
    for (const unit of plan.plannedUnits) {
      // Stage 6's own automatic VERIFY action is always appended.
      expect(unit.atomicActions.some((a) => a.actionKind === "VERIFY")).toBe(true);
      expect(unit.completionCriterion.fact).toBe(`${unit.executionUnit.executionUnitId}.completed`);
    }
  });

  it("7. Stage 6 preserves the real iteration policy on the generalized graduated execution-zone Execution Unit -- one-cut-prevention survives compilation", () => {
    const { plan } = runStage678(GRADUATED_CUTTING_SKILL.skillId, GRADUATED_CUTTING_SKILL.version, "crown", "MODIFY_PERIMETER_RELATIONSHIP");
    const executionZone = plan.plannedUnits.find((u) => u.executionUnit.executionUnitId === "executionunit-cutting-graduated-execution-zone")!;
    const executeAction = executionZone.atomicActions.find((a) => a.actionKind === "EXECUTE")!;
    expect(executeAction.iteration?.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
  });

  it("8. Stage 5 cannot invent this skill/version -- an unregistered skillId or wrong version is refused (SKILL_NOT_ALLOWED), never silently substituted", () => {
    const proposal = proposalFor({
      stepId: "step-1",
      skillDefinitionId: "skill-cutting-graduated",
      skillKey: "skill-cutting-graduated",
      skillVersion: 99,
      zone: "crown",
      addressesDelta: { scope: "crown", field: "lengthIntent" },
      declaredCapabilityUsed: "MODIFY_PERIMETER_RELATIONSHIP",
      parameters: [],
      rationale: "SYNTHETIC (proof) -- wrong version must be refused.",
    });
    const result = compileProfessionalExecutionPlan({
      proposal,
      reasoningProposalId: "r",
      reasoningProposalContextFingerprint: "d".repeat(64),
      currentSnapshotId: "c",
      currentSnapshotVersion: 1,
      targetSnapshotId: "t",
      targetSnapshotVersion: 1,
      templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES,
      compiledAt: COMPILED_AT,
    });
    expect(result.status).toBe("UNRESOLVED");
    if (result.status === "UNRESOLVED") expect(result.failureReason).toBe("SKILL_NOT_ALLOWED");
  });

  it("9. compiles through Stage 7 into a real ScenePlan -- scenes preserve progression, never collapsed to one isolated cut", () => {
    const { sceneResult } = runStage678(GRADUATED_CUTTING_SKILL.skillId, GRADUATED_CUTTING_SKILL.version, "crown", "MODIFY_PERIMETER_RELATIONSHIP");
    expect(sceneResult.status).toBe("COMPILED");
    if (sceneResult.status === "COMPILED") {
      expect(sceneResult.scenePlan.scenes.length).toBeGreaterThan(0);
    }
  });

  it("10. compiles through Stage 8 into VisualInstructionPackages -- professional params (elevation, structuralTechnique) survive to the package, no structural gap blocks this skill", () => {
    const { plan, sceneResult } = runStage678(GRADUATED_CUTTING_SKILL.skillId, GRADUATED_CUTTING_SKILL.version, "crown", "MODIFY_PERIMETER_RELATIONSHIP");
    expect(sceneResult.status).toBe("COMPILED");
    if (sceneResult.status !== "COMPILED") return;
    const { packages, failures } = compileAllVisualInstructionPackages({ scenePlan: sceneResult.scenePlan, executionPlan: plan, templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES });
    expect(failures.length).toBe(0);
    expect(packages.length).toBeGreaterThan(0);
    const readiness = packages.map((pkg) => evaluateRenderReadiness({ package: pkg, scenePlan: sceneResult.scenePlan, executionPlan: plan, templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES }));
    // No real evidence bound in this proof -- readiness is honestly NOT
    // RENDER_READY, but crucially never UNRESOLVED (which would mean a
    // structural/capability gap, not merely missing evidence).
    for (const r of readiness) expect(r.status).not.toBe("UNRESOLVED");
  });
});

describe("C. Construct One-Length Perimeter -- real Stage 6/7/8 pass-through, zero AI", () => {
  it("11. [Stage 8.5S1B.R1: 5, not 6, Execution Units -- posterior below/above-occipital merged] compiles through Stage 6 into a real ProfessionalExecutionPlan with all 5 Execution Units, including left/right laterality", () => {
    const { plan } = runStage678(ONE_LENGTH_PERIMETER_SKILL.skillId, ONE_LENGTH_PERIMETER_SKILL.version, "nape", "PRESERVE_PERIMETER");
    expect(plan.plannedUnits.length).toBe(5);
    const lateralities = plan.plannedUnits.map((u) => u.executionUnit.laterality);
    expect(lateralities).toContain("LEFT");
    expect(lateralities).toContain("RIGHT");
  });

  it("12. compiles through Stage 7 into a real ScenePlan", () => {
    const { sceneResult } = runStage678(ONE_LENGTH_PERIMETER_SKILL.skillId, ONE_LENGTH_PERIMETER_SKILL.version, "nape", "PRESERVE_PERIMETER");
    expect(sceneResult.status).toBe("COMPILED");
  });

  it("13. compiles through Stage 8 with no structural gap", () => {
    const { plan, sceneResult } = runStage678(ONE_LENGTH_PERIMETER_SKILL.skillId, ONE_LENGTH_PERIMETER_SKILL.version, "nape", "PRESERVE_PERIMETER");
    expect(sceneResult.status).toBe("COMPILED");
    if (sceneResult.status !== "COMPILED") return;
    const { packages, failures } = compileAllVisualInstructionPackages({ scenePlan: sceneResult.scenePlan, executionPlan: plan, templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES });
    expect(failures.length).toBe(0);
    for (const pkg of packages) {
      const r = evaluateRenderReadiness({ package: pkg, scenePlan: sceneResult.scenePlan, executionPlan: plan, templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES });
      expect(r.status).not.toBe("UNRESOLVED");
    }
  });
});

describe("D. Slice-and-Slide Refinement -- real Stage 6/7/8 pass-through as a composed step, zero AI", () => {
  it("14. compiles through Stage 6 as its own step (Stage 6 only checks the proposal names a registered, capable skill -- it does not require Stage-4 selectability)", () => {
    const { plan } = runStage678(SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId, SLICE_AND_SLIDE_REFINEMENT_SKILL.version, "crown", "REFINE_ENDS");
    expect(plan.plannedUnits.length).toBe(1);
  });

  it("15. compiles through Stage 7 and Stage 8 with no structural gap", () => {
    const { plan, sceneResult } = runStage678(SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId, SLICE_AND_SLIDE_REFINEMENT_SKILL.version, "crown", "REFINE_ENDS");
    expect(sceneResult.status).toBe("COMPILED");
    if (sceneResult.status !== "COMPILED") return;
    const { packages, failures } = compileAllVisualInstructionPackages({ scenePlan: sceneResult.scenePlan, executionPlan: plan, templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES });
    expect(failures.length).toBe(0);
    for (const pkg of packages) {
      const r = evaluateRenderReadiness({ package: pkg, scenePlan: sceneResult.scenePlan, executionPlan: plan, templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES });
      expect(r.status).not.toBe("UNRESOLVED");
    }
  });
});

describe("E. Preservation gate -- Stage 8.5S1B small, additive follow-up (Stage 6 remains the final authoritative validator)", () => {
  function deltaWithCrownReduceWeight(): { current: HairStateSnapshotDeltaInput; target: HairStateSnapshotDeltaInput } {
    const globalEntry = { relativeLength: unassessedFact("unspecified" as const), fiberThickness: unassessedFact("unspecified" as const), density: unassessedFact("unspecified" as const), texture: unassessedFact("unspecified" as const), condition: unassessedFact("unspecified" as const) };
    const zones = HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z));
    const targetZones = HEAD_ZONES.map((z) => {
      const entry = buildUnassessedZoneEntry(z);
      if (z === "crown") return { ...entry, weightIntent: { value: "reduce" as const, source: "professional_input" as const } };
      return entry;
    });
    return {
      current: { id: "current-1", snapshotVersion: 1, payload: { globalState: globalEntry, zones } },
      target: { id: "target-1", snapshotVersion: 1, payload: { globalState: globalEntry, zones: targetZones } },
    };
  }

  // SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY. None of the
  // 6 real registered skills declares an OUTCOME capability scoped to
  // canonical "crown" (by design -- Graduated Cutting's own REDUCE_WEIGHT/
  // BUILD_WEIGHT are scoped to its own vertical-specific applicableZones,
  // never canonical HeadZone labels; crown weight-reduction is honestly
  // UNRESOLVED with the real registry, proven separately in professional-
  // brain-orchestrator.test.ts). Testing the preservation-gate MECHANISM
  // itself therefore needs one small, clearly-synthetic, unscoped
  // REDUCE_WEIGHT skill alongside the real 6 -- exactly the same
  // synthetic-fixture discipline hair-state-delta-skill-candidate-
  // selector.test.ts already uses for its own capability-matching proofs.
  const SYNTHETIC_REDUCE_WEIGHT_SKILL = {
    id: "registry-synthetic-reduce-weight-1",
    skillId: "skill-synthetic-reduce-weight-fixture",
    version: 1,
    vertical: "cutting",
    name: "SYNTHETIC Reduce Weight Fixture -- NOT REAL PROFESSIONAL AUTHORITY",
    status: "ACTIVE" as const,
    authorityType: "PROFESSIONALLY_AUTHORED" as const,
    payload: {
      skillId: "skill-synthetic-reduce-weight-fixture",
      version: 1,
      vertical: "cutting",
      name: "SYNTHETIC Reduce Weight Fixture",
      description: "SYNTHETIC -- exists only to exercise the preservation-gate mechanism in isolation.",
      status: "ACTIVE" as const,
      authorityType: "PROFESSIONALLY_AUTHORED" as const,
      rationale: "SYNTHETIC fixture.",
      parameters: [],
      procedure: [
        { order: 1, instruction: "SYNTHETIC step one, twenty characters." },
        { order: 2, instruction: "SYNTHETIC step two, twenty characters." },
      ],
      capabilities: [{ kind: "REDUCE_WEIGHT" as const }],
      createdAt: "2026-09-11T00:00:00.000Z",
    },
    reviewedByUserId: null,
    reviewedAt: null,
    supersededBySkillDefinitionId: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  };

  it("16. omitting activePreserveConstraints changes nothing -- byte-identical behavior for every pre-existing caller (backward compatible)", () => {
    const { current, target } = deltaWithCrownReduceWeight();
    const registry = buildCanonicalCandidateSkillRegistry();
    const withoutArg = selectCandidateSkillsForDelta(current, target, registry);
    const withEmptyArg = selectCandidateSkillsForDelta(current, target, registry, []);
    expect(withoutArg.candidateMatches.length).toBe(withEmptyArg.candidateMatches.length);
    expect(withoutArg.rejectedMatches.length).toBe(withEmptyArg.rejectedMatches.length);
  });

  it("17. a REDUCE_WEIGHT candidate for a zone under an active preserve_density_sensitive_area constraint is moved to rejectedMatches, with the conflict reason recorded -- never silently offered", () => {
    const { current, target } = deltaWithCrownReduceWeight();
    const registry = [...buildCanonicalCandidateSkillRegistry(), SYNTHETIC_REDUCE_WEIGHT_SKILL];
    const withoutConstraint = selectCandidateSkillsForDelta(current, target, registry);
    const crownReduceWeightCandidate = withoutConstraint.candidateMatches.find((m) => m.deltaEntry.scope === "crown" && m.matchedCapability === "REDUCE_WEIGHT");
    // Establish there IS such a candidate before the constraint is applied
    // (otherwise this test would prove nothing).
    expect(crownReduceWeightCandidate).toBeTruthy();

    const constraints: readonly PreserveConstraintEntry[] = [{ type: "preserve_density_sensitive_area", zone: "crown", source: "professional_adjustment" }];
    const withConstraint = selectCandidateSkillsForDelta(current, target, registry, constraints);
    expect(withConstraint.candidateMatches.some((m) => m.deltaEntry.scope === "crown" && m.matchedCapability === "REDUCE_WEIGHT")).toBe(false);
    const rejected = withConstraint.rejectedMatches.find((m) => m.deltaEntry.scope === "crown" && m.matchedCapability === "REDUCE_WEIGHT");
    expect(rejected).toBeTruthy();
    expect(rejected!.preserveConstraintConflict).toBeTruthy();
  });

  it("18. a preserve constraint for a DIFFERENT zone never rejects a candidate -- no false-positive conflict", () => {
    const { current, target } = deltaWithCrownReduceWeight();
    const registry = [...buildCanonicalCandidateSkillRegistry(), SYNTHETIC_REDUCE_WEIGHT_SKILL];
    const constraints: readonly PreserveConstraintEntry[] = [{ type: "preserve_density_sensitive_area", zone: "sides", source: "professional_adjustment" }];
    const withConstraint = selectCandidateSkillsForDelta(current, target, registry, constraints);
    const withoutConstraint = selectCandidateSkillsForDelta(current, target, registry);
    expect(withConstraint.candidateMatches.length).toBe(withoutConstraint.candidateMatches.length);
  });

  it("19. STATIC PROOF -- the candidate selector never imports the Stage 6 plan validator; this follow-up is a coarse pre-filter only, never a duplicate of the full authoritative validator", () => {
    const src = readFileSync(join(process.cwd(), "src", "lib", "hair-state-delta-skill-candidate-selector.ts"), "utf8");
    expect(src).not.toMatch(/professional-execution-plan-validator/);
    expect(src).not.toMatch(/validateProfessionalExecutionPlan/);
  });
});
