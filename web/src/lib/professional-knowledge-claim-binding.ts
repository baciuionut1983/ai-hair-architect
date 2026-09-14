import { createHash } from "crypto";

import type { ApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import type { ProcedureKnowledgeDecomposition } from "@/lib/professional-knowledge-decomposition";
import { isWithinCoreInterval } from "@/lib/professional-learning-video-long-window-planner";
import type { ProfessionalLearningExtractedField, ProfessionalLearningExtractionFieldName, ProfessionalLearningProvenanceSource } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.1 --
// PROFESSIONALLY VALIDATED CLAIM BINDING. Pure, no I/O, no database, ZERO
// AI calls, ZERO registry/review writes.
//
// THE GAP THIS FILE CLOSES: L5.R3's decomposition only ever read each raw
// window output's `actionCandidates`/`temporalObservations` -- it never
// touched the SAME window's own rich `extraction` field map (elevation,
// guideType, overdirection, sectioning, crossCheck, techniqueCandidate,
// ...), so every L5.R3 knowledge unit's `knownFields` stayed `{}`. This
// file binds those real frozen field claims to their owning knowledge
// unit, WITHOUT rewriting their original provenance and WITHOUT treating
// Ionuț's general L5.R2 review approval as if it were a field-level
// PROFESSIONAL_INPUT correction (Section 6-9's absolute distinction).
//
// REVIEW != CORRECTION (Section 8): a claim's `originalProvenance` is
// NEVER changed by this file. A separate, additive
// `reviewConfirmation` state records whether Ionuț's review SPECIFICALLY
// named a theme matching this exact claim -- never a blanket "he approved
// everything" inference (Section 12: "CONFIRMED THEMES ARE NOT FREE-FORM
// AUTHORITY").

export const CLAIM_REVIEW_CONFIRMATION_STATES = ["NOT_REVIEWED", "PROFESSIONALLY_CONFIRMED", "PROFESSIONALLY_CORRECTED", "PROFESSIONALLY_REJECTED"] as const;
export type ClaimReviewConfirmationState = (typeof CLAIM_REVIEW_CONFIRMATION_STATES)[number];

export const SUPPORT_MODALITIES = ["VISUAL", "AUDIO_NARRATION", "MIXED", "UNRESOLVED"] as const;
export type SupportModality = (typeof SUPPORT_MODALITIES)[number];

// Section 19/44: never inferred beyond what the frozen note text itself
// says. A narrow, replaceable phrase detector -- same discipline as every
// other candidate-mention heuristic in this lineage (REFERENCE_MENTION_
// PHRASES, RESULT_MENTION_PHRASES) -- never semantic authority, only a
// textual signal of which channel supported a claim.
const AUDIO_NARRATION_PHRASES = ["voiceover", "narrator", "narration", "spoken", "states", "mentions", "explains"];
const VISUAL_PHRASES = ["visible", "visually", "shown", "seen"];

export function detectSupportModality(note: string | undefined): SupportModality {
  if (!note) return "UNRESOLVED";
  const lower = note.toLowerCase();
  const hasAudio = AUDIO_NARRATION_PHRASES.some((p) => lower.includes(p));
  const hasVisual = VISUAL_PHRASES.some((p) => lower.includes(p));
  if (hasAudio && hasVisual) return "MIXED";
  if (hasAudio) return "AUDIO_NARRATION";
  if (hasVisual) return "VISUAL";
  return "UNRESOLVED";
}

// Section 12/13: ONE small, declarative theme->field table -- never a
// giant lexical rule farm. `requiredValueKeywords`, when present, are the
// DISTINGUISHING words that must appear in the field's own value text
// (case-insensitive substring) -- required whenever more than one theme
// maps to the same field name (e.g. mobile_guide/stationary_guide both
// map to guideType; without this, "guide" alone would match either
// value). Absent when the theme<->field mapping is already unambiguous.
interface ThemeFieldMapping {
  readonly fieldName: ProfessionalLearningExtractionFieldName;
  readonly requiredValueKeywords?: readonly string[];
}

export const CONFIRMED_THEME_FIELD_MAP: Readonly<Record<string, ThemeFieldMapping>> = {
  progressive_elevation: { fieldName: "elevation", requiredValueKeywords: ["progressiv"] },
  top_zone_elevation: { fieldName: "elevation", requiredValueKeywords: ["top", "zone", "upper"] },
  mobile_guide: { fieldName: "guideType", requiredValueKeywords: ["mobile"] },
  stationary_guide: { fieldName: "guideType", requiredValueKeywords: ["stationary"] },
  sectioning: { fieldName: "sectioning" },
  overdirection: { fieldName: "overdirection" },
  wet_to_dry_transition: { fieldName: "startingState", requiredValueKeywords: ["wet", "dry"] },
  point_cutting: { fieldName: "techniqueCandidate", requiredValueKeywords: ["point cutting", "point-cutting"] },
  texturizing: { fieldName: "techniqueCandidate", requiredValueKeywords: ["texturiz"] },
  graduated_bob_technique: { fieldName: "techniqueCandidate", requiredValueKeywords: ["graduated"] },
  repeated_actions_and_observed_validations: { fieldName: "crossCheck" },
  // final_styling is deliberately ABSENT here -- it confirms the
  // STYLING_ACTION action kind itself, never an extraction field (see
  // bindClaimsForKnowledgeUnit's own unit-level handling below).
};

function fieldConfirmedByTheme(fieldName: string, value: unknown, theme: string): boolean {
  const mapping = CONFIRMED_THEME_FIELD_MAP[theme];
  if (!mapping || mapping.fieldName !== fieldName) return false;
  if (!mapping.requiredValueKeywords) return true;
  if (typeof value !== "string") return false;
  const lower = value.toLowerCase();
  return mapping.requiredValueKeywords.some((k) => lower.includes(k));
}

export type BoundClaimType = "EXTRACTION_FIELD" | "ACTION_KIND" | "REFERENCE_CANDIDATE";

export interface BoundClaim {
  readonly claimId: string;
  readonly claimType: BoundClaimType;
  readonly fieldName?: ProfessionalLearningExtractionFieldName;
  readonly value: unknown;
  readonly originalProvenance: ProfessionalLearningProvenanceSource;
  readonly sourceIntervals: readonly { readonly timeStartSeconds: number; readonly timeEndSeconds: number }[];
  readonly reviewConfirmation: ClaimReviewConfirmationState;
  readonly confirmedByTheme: string | null;
  readonly supportModality: SupportModality;
  readonly note?: string;
}

function computeClaimId(sourceEvidenceId: string, approvedResultHash: string, claimType: BoundClaimType, discriminator: string): string {
  return createHash("sha256").update(`${sourceEvidenceId}|${approvedResultHash}|${claimType}|${discriminator}`, "utf8").digest("hex");
}

export interface ProfessionallyValidatedClaimBinding {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly reviewId: string;
  readonly approvedResultHash: string;
  readonly knowledgeUnitId: string;
  readonly assimilationVersion: string;
  readonly claims: readonly BoundClaim[];
}

function windowIndexForInterval(timeStartSeconds: number, source: ApprovedKnowledgeSource): number | null {
  const owning = source.windows.find((w) => isWithinCoreInterval(timeStartSeconds, w));
  return owning ? owning.index : null;
}

// Binds ALL real, non-UNKNOWN extraction fields from the owning window's
// raw output to this unit -- not only the ones a theme confirms. An
// unconfirmed real claim is still real evidence (NOT_REVIEWED, never
// discarded); a confirmed one additionally carries which named theme
// confirmed it. Section 11: a binding requires an ACTUAL frozen claim --
// this function never invents one because a theme name exists.
export function bindClaimsForKnowledgeUnit(
  unit: ProcedureKnowledgeDecomposition["knowledgeUnits"][number],
  source: ApprovedKnowledgeSource,
  confirmedThemes: readonly string[],
  assimilationVersion: string,
): ProfessionallyValidatedClaimBinding {
  const claims: BoundClaim[] = [];

  if (unit.type === "REFERENCE_RELATIONSHIP") {
    for (const relationship of source.reconciliation.referenceDependencyCandidates) {
      if (!unit.referenceRelationshipIds.includes(relationship.id)) continue;
      claims.push({
        claimId: computeClaimId(source.sourceEvidenceId, source.approvedResultHash, "REFERENCE_CANDIDATE", relationship.id),
        claimType: "REFERENCE_CANDIDATE",
        value: relationship.sourceEntity.label ?? relationship.sourceEntity.ref,
        originalProvenance: relationship.provenance,
        sourceIntervals: relationship.evidenceInterval ? [relationship.evidenceInterval] : [],
        // No confirmedTheme names a reference-dependency candidate
        // specifically (Section 12 audit) -- never inferred from Ionuț's
        // general "no false statements found" blanket statement alone.
        reviewConfirmation: "NOT_REVIEWED",
        confirmedByTheme: null,
        supportModality: "UNRESOLVED",
        note: `established=${relationship.established} -- the review confirms the OBSERVATION text is accurate; it does not itself establish the relationship (Section 20/26).`,
      });
    }
    return { id: computeClaimId(source.sourceEvidenceId, source.approvedResultHash, "REFERENCE_CANDIDATE", unit.id), sourceEvidenceId: source.sourceEvidenceId, reviewId: source.reviewId, approvedResultHash: source.approvedResultHash, knowledgeUnitId: unit.id, assimilationVersion, claims };
  }

  // EXECUTION_CAPABILITY / VALIDATION_RULE units: bind from the owning
  // window's own raw extraction field map.
  const firstInterval = unit.sourceIntervals[0];
  const windowIndex = firstInterval ? windowIndexForInterval(firstInterval.timeStartSeconds, source) : null;
  const window = windowIndex !== null ? source.windows.find((w) => w.index === windowIndex) : undefined;
  const raw = window ? source.rawResultsByWindowId.get(window.id) : undefined;

  if (raw) {
    for (const [fieldName, field] of Object.entries(raw.extraction) as [ProfessionalLearningExtractionFieldName, ProfessionalLearningExtractedField][]) {
      if (!field || field.source === "UNKNOWN" || field.value === null || field.value === undefined) continue;
      const matchingTheme = confirmedThemes.find((theme) => fieldConfirmedByTheme(fieldName, field.value, theme)) ?? null;
      claims.push({
        claimId: computeClaimId(source.sourceEvidenceId, source.approvedResultHash, "EXTRACTION_FIELD", `${unit.id}|${fieldName}`),
        claimType: "EXTRACTION_FIELD",
        fieldName,
        value: field.value,
        originalProvenance: field.source,
        sourceIntervals: (field.segments ?? []).map((s) => ({ timeStartSeconds: s.timeStartSeconds, timeEndSeconds: s.timeEndSeconds })),
        reviewConfirmation: matchingTheme ? "PROFESSIONALLY_CONFIRMED" : "NOT_REVIEWED",
        confirmedByTheme: matchingTheme,
        supportModality: detectSupportModality(field.note),
        note: field.note,
      });
    }
  }

  // Unit-level theme confirmations that do not correspond to any single
  // extraction field (Section 41/44): final_styling names the
  // STYLING_ACTION action kind itself; repeated_actions_and_observed_
  // validations additionally confirms the repetition PATTERN (occurrenceCount
  // > 1), on top of any crossCheck field claim already bound above.
  const kindFromLabel = unit.label.split(" ")[0];
  if (kindFromLabel === "STYLING_ACTION" && confirmedThemes.includes("final_styling")) {
    claims.push({
      claimId: computeClaimId(source.sourceEvidenceId, source.approvedResultHash, "ACTION_KIND", `${unit.id}|final_styling`),
      claimType: "ACTION_KIND",
      value: "STYLING_ACTION",
      originalProvenance: "OBSERVED",
      sourceIntervals: unit.sourceIntervals,
      reviewConfirmation: "PROFESSIONALLY_CONFIRMED",
      confirmedByTheme: "final_styling",
      supportModality: "UNRESOLVED",
      note: "The final-styling action itself was named as a confirmed theme -- this does not by itself make styling a reusable skill (Section 41).",
    });
  }
  if (unit.occurrenceCount > 1 && confirmedThemes.includes("repeated_actions_and_observed_validations")) {
    claims.push({
      claimId: computeClaimId(source.sourceEvidenceId, source.approvedResultHash, "ACTION_KIND", `${unit.id}|repetition`),
      claimType: "ACTION_KIND",
      value: `repeated ${unit.occurrenceCount}x`,
      originalProvenance: "OBSERVED",
      sourceIntervals: unit.sourceIntervals,
      reviewConfirmation: "PROFESSIONALLY_CONFIRMED",
      confirmedByTheme: "repeated_actions_and_observed_validations",
      supportModality: "UNRESOLVED",
      note: "Repetition itself was reviewed -- this is support for the action PATTERN, never a new-skill multiplier (Section 19).",
    });
  }

  return { id: computeClaimId(source.sourceEvidenceId, source.approvedResultHash, "EXTRACTION_FIELD", unit.id), sourceEvidenceId: source.sourceEvidenceId, reviewId: source.reviewId, approvedResultHash: source.approvedResultHash, knowledgeUnitId: unit.id, assimilationVersion, claims };
}

export function bindClaimsForApprovedSource(
  source: ApprovedKnowledgeSource,
  decomposition: ProcedureKnowledgeDecomposition,
  confirmedThemes: readonly string[],
  assimilationVersion: string,
): readonly ProfessionallyValidatedClaimBinding[] {
  return decomposition.knowledgeUnits.map((unit) => bindClaimsForKnowledgeUnit(unit, source, confirmedThemes, assimilationVersion));
}
