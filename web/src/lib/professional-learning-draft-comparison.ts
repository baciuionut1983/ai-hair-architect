import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";

import type { ProfessionalLearningComparisonOutcome, ProfessionalLearningDiscernmentCategory } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- COMPARE
// BEFORE CREATE (Part 10). Pure, deterministic, registry-driven --
// mirrors hair-state-delta-skill-candidate-selector.ts's own "never by
// name/description keyword matching, only by a skill's own DECLARED
// facts" discipline: this function never invents a conflict or a match
// that isn't backed by something the skill registry itself already
// declares (e.g. SkillDefinition.incompatibleSkillIds). The extractor's
// own free-text pattern matching (professional-learning-mock-extractor.ts)
// is what's mock/throwaway in this stage -- this comparator is real,
// reusable logic a future real extractor plugs into unchanged.
//
// A new skill is NEVER created here, regardless of outcome (Part 4/12):
// POSSIBLE_NEW_SKILL is a signal for a LATER, separately-authorized
// stage, not an action this function (or anything that calls it) ever
// takes.

export interface DraftConflictDetail {
  readonly existingClaim: string;
  readonly newClaim: string;
  readonly existingAuthority: { readonly skillId: string; readonly version: number; readonly name: string };
  readonly newEvidenceId: string;
  readonly reason: string;
  readonly reviewRequired: true;
}

export interface DraftComparisonResult {
  readonly outcome: ProfessionalLearningComparisonOutcome;
  readonly comparedSkillId: string | null;
  readonly conflictDetail: DraftConflictDetail | null;
}

function findRegistryRecord(skillId: string, registry: readonly ProfessionalSkillDefinitionRecord[]): ProfessionalSkillDefinitionRecord | null {
  return registry.find((record) => record.skillId === skillId) ?? null;
}

// Discernment categories that, by definition, carry no comparable
// procedural claim -- comparison never proceeds past this for them (Part
// 8: "THIS MATERIAL DOES NOT CONTAIN REUSABLE PROFESSIONAL KNOWLEDGE").
const NON_COMPARABLE_CATEGORIES: readonly ProfessionalLearningDiscernmentCategory[] = [
  "IRRELEVANT",
  "INSUFFICIENT_EVIDENCE",
  "RESULT_REFERENCE",
  "TOOL_INFORMATION",
  "PRODUCT_INFORMATION",
  "BRAND_INFORMATION",
  "TREND_INFORMATION",
];

export function compareExtractionAgainstRegistry(
  discernmentCategory: ProfessionalLearningDiscernmentCategory,
  relatedSkillIdHints: readonly string[],
  registry: readonly ProfessionalSkillDefinitionRecord[],
  evidenceId: string,
): DraftComparisonResult {
  if (NON_COMPARABLE_CATEGORIES.includes(discernmentCategory)) {
    return { outcome: "INSUFFICIENT_INFORMATION", comparedSkillId: null, conflictDetail: null };
  }

  const [primarySkillId, ...otherSkillIds] = relatedSkillIdHints;

  if (!primarySkillId) {
    // Real procedural content, but nothing the registry already names --
    // never a fabricated match, and never auto-created here either (Part
    // 4/12): this is only ever a SIGNAL for a later stage.
    return { outcome: "POSSIBLE_NEW_SKILL", comparedSkillId: null, conflictDetail: null };
  }

  const primaryRecord = findRegistryRecord(primarySkillId, registry);
  if (!primaryRecord) {
    // The hint does not resolve to any real registry entry -- treated
    // identically to "nothing recognized" rather than trusting an
    // unverifiable reference (Part 21: never reference a nonexistent
    // skill as though it were real).
    return { outcome: "POSSIBLE_NEW_SKILL", comparedSkillId: null, conflictDetail: null };
  }

  for (const otherSkillId of otherSkillIds) {
    const otherRecord = findRegistryRecord(otherSkillId, registry);
    const declaredIncompatible = primaryRecord.payload.incompatibleSkillIds?.includes(otherSkillId) ?? false;
    if (declaredIncompatible) {
      return {
        outcome: "POSSIBLE_CONFLICT",
        comparedSkillId: primarySkillId,
        conflictDetail: {
          existingClaim: `${primaryRecord.name} (v${primaryRecord.version}) is professionally authored as INCOMPATIBLE with ${otherRecord?.name ?? otherSkillId} -- see its own declared incompatibleSkillIds.`,
          newClaim: `New evidence appears to describe using ${primaryRecord.name} together with ${otherRecord?.name ?? otherSkillId}.`,
          existingAuthority: { skillId: primaryRecord.skillId, version: primaryRecord.version, name: primaryRecord.name },
          newEvidenceId: evidenceId,
          reason: "Extracted evidence contradicts an existing professionally-authored incompatibility rule. The approved rule is left unchanged; a professional must review this conflict explicitly.",
          reviewRequired: true,
        },
      };
    }
  }

  if (otherSkillIds.length > 0) {
    // Multiple named techniques, no declared conflict between them --
    // treated as supporting evidence for the primary candidate, same as
    // the single-mention case below.
    return { outcome: "EVIDENCE_FOR_EXISTING", comparedSkillId: primarySkillId, conflictDetail: null };
  }

  return { outcome: "EVIDENCE_FOR_EXISTING", comparedSkillId: primarySkillId, conflictDetail: null };
}
