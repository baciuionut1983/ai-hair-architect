import { buildGuideRelationshipCapability, type GuideRelationshipCapability } from "@/lib/professional-skill-guide-relationship-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4.R1 --
// ONE-LENGTH GUIDE SEMANTIC CORRECTION, professional authority record.
// Pure, no I/O, no database, ZERO AI calls, ZERO registry writes.
//
// This is a narrow, additive, AUDITABLE record of Ionuț's final
// professional correction -- NOT a rewrite of any prior AI observation
// or professional decision. It corrects an ARCHITECTURAL interpretation
// bug this engagement introduced at Stage 8.5L5.R3.3 (a declarative
// bridge-table entry, professional-skill-guide-relationship-execution-
// unit-comparison.ts's own LEGACY_REFERENCE_MODE_TO_GUIDE_SEMANTICS
// table), never a claim from the L5.R2 video review itself -- so this is
// deliberately NOT represented as a ProfessionalReviewDecision (that
// type exists specifically for "AI claim + professional decision about
// THAT claim"; this correction has no corresponding AI claim to wrap,
// it corrects how THIS ENGAGEMENT'S OWN comparator interpreted an
// already-existing, already-approved skill's own parameters).
//
// PROVENANCE CHAIN preserved, never collapsed:
//   original L5.R2 evidence (unchanged)
//   -> original AI interpretation (unchanged)
//   -> professional review (L5.R3.2, unchanged)
//   -> L5.R3.4 proposed assimilation (11 mutations, git history preserved)
//   -> Ionuț's final One-Length semantic correction (THIS RECORD)
//   -> R1 corrected assimilation proposal (10 mutations, this commit)

export const IONUTS_ONE_LENGTH_GUIDE_CORRECTION = {
  stage: "8.5L5.R3.4.R1",
  professionalQuoteRomanian:
    "Șuviță tăiată anterior, logic, devine aceeași linie cu ultimele straturi tăiate și devine ghid interpretabil pentru următoarea care se taie la aceeași linie neschimbată.",
  professionalQuoteEnglish:
    "The previously cut strand, logically, becomes the same line as the last cut layers, and becomes an interpretable guide for the next one, which is cut to that same unchanged line.",
  // What was WRONG (Stage 8.5L5.R3.3's own bridge-table entry, before
  // this correction): `previous_subsection` unconditionally implied
  // `behavior: "TRAVELLING"`. This never actually affected Graduated
  // Cutting's own real matches (its `guideType: "traveling"` already
  // independently overrides behavior in legacySemanticsForUnit) -- but
  // it DID incorrectly let One-Length Perimeter's own
  // `guideReferenceMode: "previous_subsection"` execution units resolve
  // as TRAVELLING too, which is professionally false.
  rootCause:
    "professional-skill-guide-relationship-execution-unit-comparison.ts's LEGACY_REFERENCE_MODE_TO_GUIDE_SEMANTICS['previous_subsection'] mapped behavior to TRAVELLING unconditionally -- correct only for Graduated Cutting's genuinely different authority-travels case (asserted independently via its own guideType parameter), wrong as a DEFAULT for One-Length Perimeter / Continue Central Nape Construction, whose own 'previous_subsection' means the SAME established line is reproduced, never a new travelling target.",
  correction: {
    fieldChanged: "LEGACY_REFERENCE_MODE_TO_GUIDE_SEMANTICS['previous_subsection'].behavior",
    before: "TRAVELLING",
    after: "STATIONARY",
    additiveDimensionIntroduced: "referenceProgression (Section F, professional-skill-guide-relationship-contracts.ts) -- distinguishes whether the REFERENCE POINTER moves through execution from whether the GUIDE AUTHORITY itself moves; One-Length has REFERENCE_PROGRESSES_WITH_EXECUTION while guideBehavior stays STATIONARY, a combination the pre-R1 model could not express.",
  },
} as const;

// ---------------------------------------------------------------------
// Structural demonstration (report Section 5): Graduated Cutting's
// genuinely travelling guide vs. One-Length's fixed-line-authority +
// progressing-reference pattern, both independently representable,
// never colliding.
// ---------------------------------------------------------------------

export const GRADUATED_CUTTING_TRAVELLING_GUIDE_DEMONSTRATION: GuideRelationshipCapability = buildGuideRelationshipCapability({
  guideSource: "PREVIOUSLY_CUT_SECTION",
  guideRole: "CONTINUATION_GUIDE",
  guideBehavior: "TRAVELLING",
  currentSectionRelationship: "BECOMES_NEXT_GUIDE",
  progression: "PROGRESSES_EACH_UNIT",
  referenceProgression: "REFERENCE_PROGRESSES_WITH_EXECUTION",
  note: "Graduated Cutting: section N is cut, becomes the guide for N+1, and the GEOMETRIC AUTHORITY ITSELF progresses -- both the reference and the authority move together.",
});

export const ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION: GuideRelationshipCapability = buildGuideRelationshipCapability({
  guideSource: "PREVIOUSLY_CUT_SECTION",
  guideRole: "CONTINUATION_GUIDE",
  guideBehavior: "STATIONARY",
  currentSectionRelationship: "CUT_RELATIVE_TO_GUIDE",
  progression: "FIXED_THROUGHOUT",
  referenceProgression: "REFERENCE_PROGRESSES_WITH_EXECUTION",
  note: "One-Length: the established length/perimeter line is the geometric authority throughout. The previously cut strand is a visible/interpretable REFERENCE for the next section, and which concrete strand you look at changes each time (referenceProgression) -- but every section reproduces the SAME UNCHANGED LINE (guideBehavior stays STATIONARY, progression stays FIXED_THROUGHOUT). Execution progresses through sections; guide AUTHORITY does not.",
});
