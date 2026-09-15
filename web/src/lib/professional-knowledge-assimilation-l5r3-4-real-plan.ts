import { buildProfessionalKnowledgeAssimilationPlan, type GuideReplayInput, type TechniqueDecisionInput } from "@/lib/professional-knowledge-assimilation-plan";
import { L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS } from "@/lib/professional-knowledge-review-l5r3-2-real-decisions";
import { L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY } from "@/lib/professional-skill-guide-relationship-l5r3-3-real-replay";
import { compareGuideRelationshipAgainstExecutionUnits, type ComparableExecutionUnit } from "@/lib/professional-skill-guide-relationship-execution-unit-comparison";
import { GRADUATED_CUTTING_EXECUTION_UNITS, GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { ONE_LENGTH_PERIMETER_EXECUTION_UNITS, ONE_LENGTH_PERIMETER_SKILL } from "@/lib/cutting-skill-one-length-perimeter";
import { CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS, CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL } from "@/lib/cutting-skill-continue-central-nape-construction";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import type { ProfessionalKnowledgeAssimilationPlan } from "@/lib/professional-knowledge-assimilation-plan";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4 -- THE
// REAL PROFESSIONAL KNOWLEDGE ASSIMILATION PLAN. Pure, ZERO database,
// ZERO AI calls, ZERO video access, ZERO network. Applies the generic
// planner (professional-knowledge-assimilation-plan.ts) to the REAL 13
// professional review decisions (L5.R3.2) and the REAL guide-relationship
// replay (L5.R3.3) -- never re-derives or re-classifies them.

function findDecision(label: string) {
  const decision = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === label);
  if (!decision) throw new Error(`missing real decision ${label}`);
  return decision;
}

function toComparable(units: readonly { executionUnitId: string; parameterRules?: readonly { parameterName: string; semantic: string; fixedValue?: string | boolean | number }[] }[], skillId: string): ComparableExecutionUnit[] {
  return units.map((u) => ({ executionUnitId: u.executionUnitId, skillId, parameterRules: u.parameterRules }));
}

const ALL_REAL_EXECUTION_UNITS: readonly ComparableExecutionUnit[] = [
  ...toComparable(GRADUATED_CUTTING_EXECUTION_UNITS, GRADUATED_CUTTING_SKILL.skillId),
  ...toComparable(ONE_LENGTH_PERIMETER_EXECUTION_UNITS, ONE_LENGTH_PERIMETER_SKILL.skillId),
  ...toComparable(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS, CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.skillId),
];

const SOURCE_EVIDENCE_ID = "66b5e27a-bb9b-4e8d-a777-a4f8eb211720";
const REVIEW_ID = "0452ffd9-af59-418f-a2dd-9f2b2c4ee779";
const APPROVED_RESULT_HASH = "2381fdf110c87ca8a6dbc52bdf56eb16a9ecf883f7983615bb0499ec87f82190";
const PLAN_VERSION = "l5r3-4-plan-v1";

function buildGuideInputs(): readonly GuideReplayInput[] {
  const map: Record<"#2" | "#4" | "#9" | "#10", string> = { "#2": "#2-guide", "#4": "#4-guide", "#9": "#9", "#10": "#10" };
  return (Object.keys(L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY) as ("#2" | "#4" | "#9" | "#10")[]).map((key) => {
    const capability = L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY[key];
    const decision = findDecision(map[key]);
    return { reviewItemLabel: decision.reviewItemLabel, decision, capability, comparison: compareGuideRelationshipAgainstExecutionUnits(capability, ALL_REAL_EXECUTION_UNITS) };
  });
}

function buildTechniqueInputs(): readonly TechniqueDecisionInput[] {
  return [
    { decision: findDecision("#7"), outcome: "PROPOSE_TECHNIQUE_VARIANT", purpose: "TEXTURIZATION_WEIGHT_REDUCTION" },
    { decision: findDecision("#11"), outcome: "PROPOSE_TECHNIQUE_VARIANT", purpose: "ALIGNMENT_CORRECTION" },
    { decision: findDecision("#12A"), outcome: "PROPOSE_TECHNIQUE_VARIANT", purpose: "ALIGNMENT_CORRECTION" },
    { decision: findDecision("#12B"), outcome: "PROPOSE_TECHNIQUE_VARIANT", purpose: "TEXTURIZATION_WEIGHT_REDUCTION" },
    { decision: findDecision("#13"), outcome: "PROFESSIONAL_ADDITION_PENDING_REVIEW", purpose: "SUPERFICIAL_LIGHTENING_SURFACE_REFINEMENT" },
  ];
}

export function buildRealAssimilationPlan(): ProfessionalKnowledgeAssimilationPlan {
  const registry = buildCanonicalCandidateSkillRegistry();
  return buildProfessionalKnowledgeAssimilationPlan({
    sourceEvidenceId: SOURCE_EVIDENCE_ID,
    reviewId: REVIEW_ID,
    approvedResultHash: APPROVED_RESULT_HASH,
    planVersion: PLAN_VERSION,
    registry,
    guideInputs: buildGuideInputs(),
    techniqueInputs: buildTechniqueInputs(),
    directionGapDecision: findDecision("#6a-direction"),
    workflowDecision: findDecision("#6b-wet-to-dry"),
    workflowTransition: { fact: "hairWorkflowPhase", fromValue: "wet_structural_work", toValue: "dry_refinement_check_finishing" },
    effectTargetEffect: "REDUCE_SOFTEN_TEXTURIZE_TERMINAL_MASS",
    effectRelatedTechniqueIds: ["deep-point-cut", "channel-cut", "skill-cutting-slice-and-slide-refinement"],
  });
}
