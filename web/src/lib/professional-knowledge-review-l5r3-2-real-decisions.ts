import { buildProfessionalReviewDecision, type ProfessionalReviewDecision } from "@/lib/professional-knowledge-review-decision";
import type { BoundClaim } from "@/lib/professional-knowledge-claim-binding";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.2 -- THE
// REAL PROFESSIONAL REVIEW DECISIONS from Ionuț's manual review of the
// L5.R2 source video against the frozen extraction + L5.R3.1 claim
// bindings. This is committed, real professional input -- not a synthetic
// fixture. `boundClaimId`/`originalAIClaim` values below are copied
// VERBATIM from the real captured L5.R3.1 result
// (scratch-l5r3-1-real-claim-binding-result.json, unit ids
// f9e49b2769/881256e8ba/77b7c92765/a7b2e7bbb6/b4439db096/010a74985f/
// 46710ba0a1/327f327d76) -- never re-derived, never reworded.
//
// sourceEvidenceId/reviewId/approvedResultHash are the same real L5.R2/
// L5.R2-review identity used throughout L5.R3/L5.R3.1.

const SOURCE_EVIDENCE_ID = "66b5e27a-bb9b-4e8d-a777-a4f8eb211720";
const REVIEW_ID = "0452ffd9-af59-418f-a2dd-9f2b2c4ee779";
const APPROVED_RESULT_HASH = "2381fdf110c87ca8a6dbc52bdf56eb16a9ecf883f7983615bb0499ec87f82190";

function claim(claimId: string, value: unknown, provenance: BoundClaim["originalProvenance"]): BoundClaim {
  return { claimId, claimType: "EXTRACTION_FIELD", value, originalProvenance: provenance, sourceIntervals: [], reviewConfirmation: "NOT_REVIEWED", confirmedByTheme: null, supportModality: "UNRESOLVED" };
}

function referenceClaim(claimId: string, value: unknown): BoundClaim {
  return { claimId, claimType: "REFERENCE_CANDIDATE", value, originalProvenance: "INFERRED", sourceIntervals: [], reviewConfirmation: "NOT_REVIEWED", confirmedByTheme: null, supportModality: "UNRESOLVED" };
}

function build(input: Omit<Parameters<typeof buildProfessionalReviewDecision>[0], "sourceEvidenceId" | "reviewId" | "approvedResultHash">): ProfessionalReviewDecision {
  return buildProfessionalReviewDecision({ sourceEvidenceId: SOURCE_EVIDENCE_ID, reviewId: REVIEW_ID, approvedResultHash: APPROVED_RESULT_HASH, ...input });
}

// #2 -- mobile guide / progressive elevation (window 0, unit f9e49b2769).
const decision2Guide = build({
  reviewItemLabel: "#2-guide",
  decisionType: "CONFIRMATION",
  boundClaim: claim("f9e49b2769|guideType", "mobile guide", "INFERRED"),
  professionalValue: "The previously cut strand becomes the guide/reference for the next strand -- the guide progresses through the haircut.",
  professionalNote: "Confirmed by Ionuț: consistent with the previously approved Graduated Cutting professional knowledge.",
  technique: { techniqueId: "traveling-guide", label: "Traveling (mobile) guide", relatedTechniqueIds: ["skill-cutting-graduated"] },
  knownFields: ["guide is the previously cut strand", "guide progresses through the haircut", "central/profile sectioning progressing toward the back"],
  unknownFields: ["exact numeric elevation degrees"],
});
const decision2Elevation = build({
  reviewItemLabel: "#2-elevation",
  decisionType: "CONFIRMATION",
  boundClaim: claim("f9e49b2769|elevation", "low to progressively higher elevation", "INFERRED"),
  professionalValue: "Progressive elevation is present.",
  professionalNote: "Confirmed by Ionuț -- exact degrees not established, never invented.",
  knownFields: ["elevation increases progressively through the sequence"],
  unknownFields: ["exact numeric elevation degrees at any point"],
});

// #4 -- stationary guide + overdirection (window 1, unit 881256e8ba).
const decision4Guide = build({
  reviewItemLabel: "#4-guide",
  decisionType: "CONFIRMATION",
  boundClaim: claim("881256e8ba|guideType", "Stationary guideline", "OBSERVED"),
  professionalValue: "A stationary/fixed guide is used; following sections are overdirected toward it and cut relative to it.",
  professionalNote: "Confirmed by Ionuț.",
  knownFields: ["guide is stationary/fixed", "following sections overdirected toward the guide", "diagonal sectioning present"],
  unknownFields: ["exact overdirection angle", "exact diagonal geometry"],
});
const decision4Overdirection = build({
  reviewItemLabel: "#4-overdirection",
  decisionType: "CONFIRMATION",
  boundClaim: claim("881256e8ba|overdirection", "Overdirected backward onto initial temple guideline", "OBSERVED"),
  professionalValue: "Overdirection toward the stationary guide, confirmed.",
  professionalNote: "Confirmed by Ionuț; exact angle not established.",
  knownFields: ["overdirection occurs toward the stationary guide"],
  unknownFields: ["exact overdirection angle"],
});

// #6 -- overdirection direction + wet->dry transition (window 3, unit 77b7c92765).
// Deliberately WORKFLOW/STATE knowledge, not a capability/technique claim
// -- see professional-knowledge-review-l5r3-2-acceptance.test.ts's own
// comment on why no impliedCapability is supplied for these two.
const decision6Direction = build({
  reviewItemLabel: "#6a-direction",
  decisionType: "CONFIRMATION",
  boundClaim: claim("77b7c92765|overdirection", "drawn forward and outward relative to original growth plane", "INFERRED"),
  professionalValue: "forward and outward",
  professionalNote: "The reviewed claim authorizes ONLY 'forward + outward' -- never rewritten to an anatomical target (e.g. 'toward the eye') unless separately established.",
  knownFields: ["direction: forward and outward"],
  unknownFields: ["any anatomical target beyond forward/outward"],
});
const decision6WetDry = build({
  reviewItemLabel: "#6b-wet-to-dry",
  decisionType: "CONFIRMATION",
  boundClaim: claim("77b7c92765|startingState", "wet hair in first segment, dry hair in second segment", "OBSERVED"),
  professionalValue: "Execution transitions from wet structural work to dry refinement/check/finishing.",
  professionalNote: "Confirmed by Ionuț -- represented as workflow/state-transition knowledge, never as a cutting technique in its own right.",
  knownFields: ["wet phase precedes dry phase", "dry phase is refinement/check/finishing relative to wet structural work"],
  unknownFields: ["exact timing of the transition"],
});

// #7 -- Deep Point Cut correction (window 4, unit a7b2e7bbb6).
const decision7 = build({
  reviewItemLabel: "#7",
  decisionType: "CORRECTION",
  boundClaim: claim("a7b2e7bbb6|techniqueCandidate", "Point cutting and slicing for texturizing a bob", "INFERRED"),
  professionalValue: "DEEP_POINT_CUT",
  professionalNote: "More precisely Deep Point Cut, not merely generic point cutting -- scissors penetrate deeper into the ends. Purpose: texturize/reduce thickness/finer ends/pointed terminal effect.",
  technique: {
    techniqueId: "deep-point-cut",
    label: "Deep Point Cut",
    familyId: "point-cutting-family",
    relatedTechniqueIds: ["point-cut"],
    distinctFrom: ["skill-cutting-slice-and-slide-refinement"],
  },
  knownFields: ["deeper scissor penetration into the ends", "purpose: texturize / reduce weight / finer ends"],
  unknownFields: ["exact depth measurement", "exact weight reduction amount"],
  contextualKnowledge: [
    { relation: "COMMONLY_USED_FOR", subject: "SHORTER_HAIR", note: "Deep Point Cut is commonly used more in shorter hair/haircuts -- not a strict rule; adaptable by preference, structure, density, desired effect, geometry, working method." },
    { relation: "ALTERNATIVE_TO", subject: "SLICE_AND_SLIDE", note: "Both may target reducing/softening/texturizing terminal mass, but are different execution techniques -- never aliased." },
  ],
});

// #9 -- previously cut strand as guide (reference candidate, unit b4439db096).
const decision9 = build({
  reviewItemLabel: "#9",
  decisionType: "CONFIRMATION",
  boundClaim: referenceClaim("f2afc375f8", "Operator continues taking higher sections along the side/back, lifting hair out from head and cutting along the previously cut edge."),
  professionalValue: "The previously cut strand/edge is genuinely used as the guide/reference for the following strand/section -- not merely visual continuation.",
  professionalNote: "Confirmed by Ionuț as a real guide dependency, not just temporal adjacency.",
  technique: { techniqueId: "traveling-guide", label: "Traveling (mobile) guide", relatedTechniqueIds: ["skill-cutting-graduated"] },
  knownFields: ["guide relationship exists between consecutive sections"],
  unknownFields: ["exact geometry of the guide relationship"],
});

// #10 -- guide + overdirection toward guide (reference candidate, unit 010a74985f).
const decision10 = build({
  reviewItemLabel: "#10",
  decisionType: "CONFIRMATION",
  boundClaim: referenceClaim("1aa4308241", "Operator pulls subsequent parallel sections back toward the previously cut section and cuts the ends parallel to the guide line."),
  professionalValue: "The previously cut section functions as the guide; subsequent parallel sections are overdirected back toward it and cut relative to it (guide relationship + overdirection toward guide + continuation of form).",
  professionalNote: "Confirmed by Ionuț -- richer than 'previous strand visible.'",
  technique: { techniqueId: "traveling-guide", label: "Traveling (mobile) guide", relatedTechniqueIds: ["skill-cutting-graduated"] },
  knownFields: ["guide relationship", "overdirection toward guide", "continuation of form"],
  unknownFields: ["exact overdirection angle"],
});

// #11 -- Point Cut for termination/perimeter correction (reference candidate, unit 46710ba0a1).
const decision11 = build({
  reviewItemLabel: "#11",
  decisionType: "CONFIRMATION",
  boundClaim: referenceClaim("d4df741b17", "Video transitions to model with dry hair. Operator holds hair flat against the nape with fingers and cuts vertically into the bottom perimeter line with scissors."),
  professionalValue: "POINT_CUT (correction/alignment use) -- vertically oriented scissors, used to correct lower terminations remaining after the earlier elevated cutting; equalize/align terminations, bring the perimeter to the intended length.",
  professionalNote: "The original detector was NOT wrong -- confirmed correct by Ionuț. This is Point Cut used for CORRECTION/ALIGNMENT, never automatically classified as texturizing.",
  technique: { techniqueId: "point-cut", label: "Point Cut (correction/alignment)", familyId: "point-cutting-family", relatedTechniqueIds: ["deep-point-cut"], distinctFrom: ["skill-cutting-slice-and-slide-refinement"] },
  knownFields: ["vertical scissor orientation", "purpose: correction/alignment of lower termination/perimeter"],
  unknownFields: ["exact correction amount"],
});

// #12 -- TWO separate actions from one observation (reference candidate, unit 327f327d76).
const decision12Alignment = build({
  reviewItemLabel: "#12A",
  decisionType: "CORRECTION",
  boundClaim: referenceClaim("434f4e42f4", "Hair near the ear is comb-held against the neck and clipped at the ends using point cuts."),
  professionalValue: "POINT_CUT (connection/alignment use) -- lateral zones comb-controlled, point cut used to align/connect the lateral parts with the back, maintaining continuity of form.",
  professionalNote: "Action A of two distinct actions Ionuț identified in this one observation -- comb control, alignment purpose.",
  technique: { techniqueId: "point-cut", label: "Point Cut (correction/alignment)", familyId: "point-cutting-family", relatedTechniqueIds: ["deep-point-cut"], distinctFrom: ["skill-cutting-slice-and-slide-refinement"] },
  knownFields: ["control method: comb", "purpose: connect lateral shape to posterior shape"],
  unknownFields: ["exact alignment amount"],
});
const decision12Texturizing = build({
  reviewItemLabel: "#12B",
  decisionType: "CORRECTION",
  boundClaim: referenceClaim("434f4e42f4", "Hair near the ear is comb-held against the neck and clipped at the ends using point cuts."),
  professionalValue: "DEEP_POINT_CUT (texturizing use) -- after alignment, strands progressively elevated, deep point cut performed with deeper penetration to thin/lighten terminal area.",
  professionalNote: "Action B of the same observation -- distinct control method (progressive elevation, not comb-held), distinct depth, distinct purpose. Never collapsed with Action A into one generic 'point cutting' observation.",
  technique: { techniqueId: "deep-point-cut", label: "Deep Point Cut", familyId: "point-cutting-family", relatedTechniqueIds: ["point-cut"], distinctFrom: ["skill-cutting-slice-and-slide-refinement"] },
  knownFields: ["progressive elevation before this cut", "purpose: thin/lighten terminal area"],
  unknownFields: ["exact depth", "exact weight reduction"],
});

// #13 -- Channel Cut: PROFESSIONAL ADDITION, no AI claim existed at all.
// sourceIntervals is a professional-estimated approximation (posterior
// zone, after the main point-cutting work in windows 3/4) -- never
// presented as AI-detected.
const decision13ChannelCut = build({
  reviewItemLabel: "#13",
  decisionType: "ADDITION",
  professionalValue: "CHANNEL_CUT",
  professionalNote:
    "AI extraction did NOT identify this technique -- identified manually by Ionuț while reviewing the source video. In the posterior/back area, after Deep Point Cut/Point Cut refinement, hair hangs in natural fall (not finger-held), scissors tip downward, working lightly/superficially over the visible terminal area via controlled sliding and/or small partial open/close movements -- scissors do not need to close fully. Purpose: thin/lighten the visible surface of the ends, reduce visible terminal mass, refine the surface, lighter final result.",
  technique: { techniqueId: "channel-cut", label: "Channel Cut", familyId: "point-cutting-family", relatedTechniqueIds: ["deep-point-cut"], distinctFrom: ["skill-cutting-slice-and-slide-refinement"] },
  knownFields: [
    "hair control: natural fall, NOT held between fingers (structurally distinct from Slice-and-Slide's own fixed fingers-held control)",
    "scissor orientation: tip downward",
    "execution: controlled sliding and/or small partial open/close movements, scissors need not close fully",
    "works superficially over the visible terminal surface (distinct from Deep Point Cut's deeper penetration)",
    "purpose: thin/lighten visible surface, reduce visible terminal mass",
  ],
  unknownFields: ["exact numeric depth", "exact numeric tension", "precise time interval (professional-estimated only)"],
  contextualKnowledge: [{ relation: "COMMONLY_USED_FOR", subject: "SHORT_HAIR_SIDEBURNS_FRINGE_NAPE", note: "Commonly used, in many cases, for thinning/lightening short-hair areas (sideburns, fringe, nape) -- common professional practice, not a strict universal rule." }],
  sourceIntervals: [{ timeStartSeconds: 557, timeEndSeconds: 571, estimatedByProfessional: true }],
});

export const L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS: readonly ProfessionalReviewDecision[] = [
  decision2Guide,
  decision2Elevation,
  decision4Guide,
  decision4Overdirection,
  decision6Direction,
  decision6WetDry,
  decision7,
  decision9,
  decision10,
  decision11,
  decision12Alignment,
  decision12Texturizing,
  decision13ChannelCut,
];
