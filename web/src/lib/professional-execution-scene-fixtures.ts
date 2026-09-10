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
import { compileProfessionalExecutionPlan, type ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import { compileProfessionalExecutionScenePlan, type ScenePlanCompilationResult } from "@/lib/professional-execution-scene-compiler";
import type { ProfessionalExecutionPlan } from "@/lib/professional-execution-plan-contracts";

// AI Hair Architect, Professional Skill Engine Stage 7 -- SHARED TEST
// FIXTURES for the Scene Compiler proof. NOT a test file (no `.test.ts`
// suffix -> never picked up by the vitest runner, never double-executed).
// Pure, deterministic, zero I/O, zero AI. Builds the canonical
// Stage 4/5/6 scenario -- the 3 real skills, nape/occipital preserved,
// crown weight-reduction honestly unresolved -- reused verbatim across
// every Stage 7 test file.

export const SCENE_COMPILED_AT = "2026-09-13T00:00:00.000Z";

export function realTemplates(): ExecutionPlanSkillTemplate<string>[] {
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

export function realProposal(): ProfessionalReasoningProposal {
  return {
    schemaVersion: "1.0.0-pr5",
    planSummary: "Establish the central nape guide, transition through the occipital curvature, and continue nape construction; crown weight reduction unsupported.",
    proposedSkills: [
      {
        stepId: "step-1",
        skillDefinitionId: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId,
        skillKey: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId,
        skillVersion: 1,
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
        skillVersion: 1,
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
        skillVersion: 1,
        zone: "nape",
        addressesDelta: { scope: "nape", field: "lengthIntent" },
        declaredCapabilityUsed: "PRESERVE_LENGTH",
        parameters: [],
        rationale: "SYNTHETIC (proof) -- continues nape construction subsection-by-subsection.",
      },
    ],
    proposedOrder: ["step-1", "step-2", "step-3"],
    preservationConstraints: [
      { scope: "nape", field: "lengthIntent", value: "preserve", description: 'Preserve length at zone "nape".' },
      { scope: "occipital", field: "lengthIntent", value: "preserve", description: 'Preserve length at zone "occipital".' },
    ],
    unresolvedRequirements: [{ scope: "crown", field: "weightIntent", reason: "No registered skill declares capability to reduce weight in the crown zone." }],
    clarifyingQuestions: [],
    reasoningStatus: "PARTIAL_PLAN",
  };
}

export function compileRealExecutionPlan(): ProfessionalExecutionPlan {
  const result = compileProfessionalExecutionPlan({
    proposal: realProposal(),
    reasoningProposalId: "reasoning-proposal-proof-1",
    reasoningProposalContextFingerprint: "b".repeat(64),
    currentSnapshotId: "current-proof-1",
    currentSnapshotVersion: 1,
    targetSnapshotId: "target-proof-1",
    targetSnapshotVersion: 1,
    templates: realTemplates(),
    compiledAt: "2026-09-12T00:00:00.000Z",
  });
  if (result.status !== "COMPILED") throw new Error("Stage 6 execution plan did not compile in the Stage 7 fixture");
  return result.plan;
}

export const REAL_SCENE_SOURCE_PLAN_ROW_ID = "execution-plan-row-proof-1";

export function compileRealScenePlan(): ScenePlanCompilationResult {
  return compileProfessionalExecutionScenePlan({
    plan: compileRealExecutionPlan(),
    sourceExecutionPlanId: REAL_SCENE_SOURCE_PLAN_ROW_ID,
    templates: realTemplates(),
    compiledAt: SCENE_COMPILED_AT,
  });
}
