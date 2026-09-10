import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import type { ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
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

// AI Hair Architect, Professional Skill Engine Stage 8.5A -- CANONICAL
// PROFESSIONAL SKILL TEMPLATE REGISTRY. Pure, deterministic, no I/O, no
// AI. The Stage 6/7 compilers need, per skill, a triple the DB skill
// registry cannot hold: SkillDefinition + SkillInstance + ExecutionUnit[].
// The SkillInstance and ExecutionUnit[] are compile-time professional
// authority authored directly in the cutting-skill-*.ts production files
// (Stage 2.5.i.6/i.7, marked "REAL PROFESSIONAL AUTHORITY CONTENT, NOT a
// synthetic fixture"). This module COLLECTS those already-authored
// constants into the registry shape the compilers consume -- it authors
// NO professional content of its own (no new skill, no Butterfly/Bob/
// Pixie, Part J).
//
// The registry is intentionally exactly these three skills. A real client
// whose target needs a capability none of them provides correctly yields
// UNRESOLVED (Part AG) -- this module never widens the registry to reach
// RENDER_READY.

export const PROFESSIONAL_BRAIN_SKILL_TEMPLATES: readonly ExecutionPlanSkillTemplate<string>[] = [
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

// Stage 4's deterministic candidate selector takes ProfessionalSkillDefinitionRecord[].
// The DB registry table is empty in this repository, so the canonical
// candidate registry is derived deterministically from the same three
// real SkillDefinition constants -- their own `status: "ACTIVE"` +
// `authorityType: "PROFESSIONALLY_AUTHORED"` make them eligible authority
// (isSkillEligibleForAuthority), exactly as the Stage 4/5/6 tests already
// rely on. Wiring the orchestrator to ALSO read the DB registry
// (professional-skill-registry-repository.listSkillDefinitions) once the
// three skills are seeded is a purely additive follow-up.
function toRecord(skill: SkillDefinition): ProfessionalSkillDefinitionRecord {
  return {
    id: `registry-${skill.skillId}-v${skill.version}`,
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

export function buildCanonicalCandidateSkillRegistry(): readonly ProfessionalSkillDefinitionRecord[] {
  return [
    toRecord(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL),
    toRecord(OCCIPITAL_TRANSITION_SKILL),
    toRecord(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL),
  ];
}
