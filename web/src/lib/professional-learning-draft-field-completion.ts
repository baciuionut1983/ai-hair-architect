import {
  PROFESSIONAL_LEARNING_EXTRACTION_FIELD_NAMES,
  type ProfessionalLearningDiscernmentCategory,
  type ProfessionalLearningExtraction,
} from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R1.1 --
// EXPLICIT UNKNOWN NORMALIZATION. Closes the gap this stage's own task
// named precisely: L4.R1's real Gemini adapter (professional-learning-
// extractor-gemini.ts) only ever writes an extraction entry for a field
// the MODEL ITSELF chose to include in its own response array -- a field
// the model simply never mentioned is genuinely ABSENT from the resulting
// object, not an explicit `{value: null, source: "UNKNOWN"}` entry. This
// is not a bug in parsing, validation, or persistence -- each of those
// layers already, correctly, does nothing to a key that was never there.
// The gap is architectural: NO layer between validation and persistence
// ever asked "is there anything this discernment category considers
// reviewable that the extraction is silent about?" This file is that
// layer, and it is the ONLY place that ever performs this completion --
// deliberately NOT inside either extractor implementation (the mock
// extractor already emits some UNKNOWN entries manually, which is fine
// but was never guaranteed to be complete or provider-portable; the real
// Gemini adapter is explicitly NOT trusted to self-complete, per this
// stage's own Part 4: "The real AI provider must not be trusted to
// populate every UNKNOWN correctly. Server-side semantics are
// authoritative.").
//
// APPLICABLE FIELD SET (Part 5/Part 3's NOT_APPLICABLE boundary): rather
// than introduce a new, unmodeled NOT_APPLICABLE provenance value (which
// would require real domain-applicability logic this stage is not
// scoped to design -- Part 3 explicitly permits deferring this), this
// file uses a coarser, already-available signal that is still
// principled and testable: discernmentCategory. When discernment
// already concluded the material is NOT a professional procedure/rule/
// example at all (IRRELEVANT, INSUFFICIENT_EVIDENCE, RESULT_REFERENCE,
// TOOL_INFORMATION, PRODUCT_INFORMATION, BRAND_INFORMATION,
// TREND_INFORMATION), forcing all 32 procedural fields to UNKNOWN would
// be exactly the "manufactured UNKNOWN noise for genuinely inapplicable
// material" this stage's own absolute rule forbids -- a "Butterfly
// haircut" draft does not need an explicit UNKNOWN cuttingAngle. Only
// for the categories where the FULL technical vocabulary is a genuinely
// reviewable surface (a real technique, a variation, a rule, a
// correction, or a worked example) does this file complete every
// field the extraction did not already address.
//
// This function NEVER overwrites an already-present field (Part 9: known
// values remain known, exactly as extracted) -- it only ever ADDS an
// explicit UNKNOWN entry for a field name that was completely absent.

export const PROCEDURAL_DISCERNMENT_CATEGORIES: readonly ProfessionalLearningDiscernmentCategory[] = [
  "PROFESSIONAL_TECHNIQUE",
  "PROFESSIONAL_VARIATION",
  "PROFESSIONAL_RULE",
  "PROFESSIONAL_CORRECTION",
  "PROFESSIONAL_EXAMPLE",
];

export function isProceduralDiscernmentCategory(category: ProfessionalLearningDiscernmentCategory): boolean {
  return PROCEDURAL_DISCERNMENT_CATEGORIES.includes(category);
}

export function completeApplicableFieldsWithUnknown(
  extraction: ProfessionalLearningExtraction,
  discernmentCategory: ProfessionalLearningDiscernmentCategory,
): ProfessionalLearningExtraction {
  if (!isProceduralDiscernmentCategory(discernmentCategory)) {
    // Genuinely not applicable at the category level -- leave the
    // extraction exactly as produced (Part 3: UNKNOWN != NOT_APPLICABLE;
    // this material was never asked these questions in the first place).
    return extraction;
  }

  const completed: Record<string, ProfessionalLearningExtraction[keyof ProfessionalLearningExtraction]> = { ...extraction };
  for (const field of PROFESSIONAL_LEARNING_EXTRACTION_FIELD_NAMES) {
    if (!(field in completed)) {
      completed[field] = { value: null, source: "UNKNOWN" };
    }
  }
  return completed as ProfessionalLearningExtraction;
}
