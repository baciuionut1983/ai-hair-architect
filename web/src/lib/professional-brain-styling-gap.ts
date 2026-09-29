// AI Hair Architect -- Professional Brain STYLING gap report.
// "CORECȚIE B2.2 ÎNAINTE DE RELEASE", requirement 2. Pure, static,
// zero I/O -- a truthful inventory of what does not exist yet for the
// STYLING domain, so a caller that stops on it can report EXACTLY what is
// missing instead of a vague "not supported." Never invents a fake
// contract name or a placeholder capability -- every line below names a
// REAL sibling module/contract that CUT or COLOR already has and STYLING
// does not.

export interface ProfessionalBrainStylingGapReport {
  readonly domain: "styling";
  readonly missingContracts: readonly string[];
  readonly missingFacts: readonly string[];
}

export const PROFESSIONAL_BRAIN_STYLING_GAP: ProfessionalBrainStylingGapReport = {
  domain: "styling",
  missingContracts: [
    "No styling state contract exists -- CUT has HairZoneStateEntry and COLOR has HairStateColorEntry (hair-state-snapshot-validators.ts); styling has no equivalent CURRENT/TARGET fact shape at all.",
    "No styling delta function exists -- CUT has computeHairStateDelta (hair-state-delta.ts) and COLOR has computeColorStateDelta (hair-state-color-delta.ts); no computeStylingStateDelta has ever been authored.",
    "No styling capability vocabulary exists -- COLOR has exactly one real capability kind, EVALUATE_COLOR_SERVICE (professional-skill-contracts.ts's own SKILL_CAPABILITY_KINDS); no styling-domain capability kind has ever been added to that closed union.",
    "No styling skill registry exists -- CUT has buildCanonicalCandidateSkillRegistry and COLOR has buildCanonicalColorCandidateSkillRegistry (professional-brain-skill-templates.ts); no styling registry builder exists, and zero styling SkillDefinition rows have ever been authored.",
    "No styling candidate-skill selector exists -- CUT has selectCandidateSkillsForDelta and COLOR has selectColorCandidateSkillsForDelta (hair-state-delta-skill-candidate-selector.ts / hair-state-color-delta-skill-candidate-selector.ts); no styling equivalent exists to compose.",
  ],
  missingFacts: [
    "No product/finish intent (e.g. volume, hold, shine, texture finish) has any CURRENT or TARGET representation anywhere in HairStateSnapshotPayload.",
    "No styling tool/technique vocabulary (e.g. blow-dry, iron, diffuser, product application) has ever been modeled.",
    "No professional has authored real styling content for this engine yet -- unlike CUT/COLOR, there is no source professional determination to encode even if the contracts above existed.",
  ],
};
