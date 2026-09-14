import { buildGuideRelationshipCapability, type GuideRelationshipCapability } from "@/lib/professional-skill-guide-relationship-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.3 -- REAL
// REPLAY of L5.R3.2's review items #2/#4/#9/#10 against the new guide-
// relationship model. Committed, real professional input (the same
// review items already captured in
// professional-knowledge-review-l5r3-2-real-decisions.ts) -- re-expressed
// through the new vocabulary, never re-derived from raw video.
//
// Field choices below follow this stage's own task text EXACTLY (its own
// "EXPECTED CASE REPRESENTATION" Known/Unknown lists per case) --
// deliberately MORE CONSERVATIVE for #9/#10 than #2 (guideBehavior stays
// UNKNOWN for both, per the task's own explicit "do not infer more than
// professionally confirmed" instruction for #9), matching the real,
// uneven strength of the professional confirmations.

// #2 -- mobile/travelling guide. Elevation/sectioning are DELIBERATELY
// absent: they are separate dimensions this model never carries.
export const GUIDE_CAPABILITY_2: GuideRelationshipCapability = buildGuideRelationshipCapability({
  guideSource: "PREVIOUSLY_CUT_SECTION",
  guideRole: "CONTINUATION_GUIDE",
  guideBehavior: "TRAVELLING",
  currentSectionRelationship: "BECOMES_NEXT_GUIDE",
  overdirectionRelationship: "UNKNOWN",
  progression: "PROGRESSES_EACH_UNIT",
  unknownNumericFields: [],
  note: "Review item #2 -- previously cut strand becomes the guide/reference for the next strand; the guide progresses through the haircut.",
});

// #4 -- stationary guide + overdirection. Source is honestly UNKNOWN:
// Ionuț confirmed the guide is fixed, never its physical origin.
export const GUIDE_CAPABILITY_4: GuideRelationshipCapability = buildGuideRelationshipCapability({
  guideSource: "UNKNOWN",
  guideRole: "UNKNOWN",
  guideBehavior: "STATIONARY",
  currentSectionRelationship: "CUT_RELATIVE_TO_GUIDE",
  overdirectionRelationship: "TOWARD_GUIDE",
  progression: "FIXED_THROUGHOUT",
  unknownNumericFields: ["exactOverdirectionAngle"],
  note: "Review item #4 -- a stationary/fixed guide; following sections overdirected toward it and cut relative to it.",
});

// #9 -- previously cut strand as guide, DELIBERATELY PARTIAL. Behavior
// and role stay UNKNOWN -- the task's own case description: "Do not
// infer more than professionally confirmed. If guide behavior cannot
// safely be established beyond that, leave it partial."
export const GUIDE_CAPABILITY_9: GuideRelationshipCapability = buildGuideRelationshipCapability({
  guideSource: "PREVIOUSLY_CUT_SECTION",
  guideRole: "UNKNOWN",
  guideBehavior: "UNKNOWN",
  currentSectionRelationship: "REFERENCES_GUIDE",
  overdirectionRelationship: "UNKNOWN",
  progression: "UNKNOWN",
  unknownNumericFields: [],
  note: "Review item #9 -- the previously cut strand/edge genuinely acts as the guide for the following section; not merely a visible previously cut strand. Deliberately partial: behavior/role beyond this are not established.",
});

// #10 -- guide + overdirection + continuation of form.
export const GUIDE_CAPABILITY_10: GuideRelationshipCapability = buildGuideRelationshipCapability({
  guideSource: "PREVIOUSLY_CUT_SECTION",
  guideRole: "CONTINUATION_GUIDE",
  guideBehavior: "UNKNOWN",
  currentSectionRelationship: "CUT_RELATIVE_TO_GUIDE",
  overdirectionRelationship: "TOWARD_GUIDE",
  progression: "PROGRESSES_EACH_UNIT",
  unknownNumericFields: ["exactOverdirectionAngle"],
  note: "Review item #10 -- the previously cut section functions as the guide; subsequent parallel sections are directed/overdirected back toward it and cut relative to the guide line; continuation of form.",
});

export const L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY: Readonly<Record<"#2" | "#4" | "#9" | "#10", GuideRelationshipCapability>> = {
  "#2": GUIDE_CAPABILITY_2,
  "#4": GUIDE_CAPABILITY_4,
  "#9": GUIDE_CAPABILITY_9,
  "#10": GUIDE_CAPABILITY_10,
};
