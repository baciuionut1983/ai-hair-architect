import { isValidVideoTimeInterval } from "@/lib/professional-learning-video-temporal";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.2 -- TEMPORAL
// EVIDENCE PRESERVATION. Pure, no I/O, no database, ZERO AI calls.
//
// WHY THIS FILE EXISTS: professional-learning-extractor.ts's
// ProfessionalLearningExtractorOutput ALREADY carries temporalObservations/
// actionCandidates/notableEditsOrCuts for VIDEO evidence -- the real
// Gemini adapter (professional-learning-extractor-gemini.ts) already
// returns them today, under the EXISTING, unmodified prompt/schema. Until
// this stage, professional-learning-draft-service.ts never read any of
// these three fields after extract() returned them -- they were
// evaluated, arrived over the wire, and then simply never referenced
// again by anything before the draft was persisted. This file is the
// ONE place that turns that already-arriving, already-typed provider
// output into a small, canonical, PERSISTABLE evidence layer -- it adds
// no new provider capability, asks for nothing new, and does not touch
// the prompt/schema/model/timeout/sampling in any way.
//
// EVIDENCE, NOT PROFESSIONAL TRUTH (the task's own absolute rule): this
// layer coexists ALONGSIDE the existing scalar `extraction` fields --
// it never flattens into them, and nothing here ever overwrites a
// scalar field's own value/source. A professional reviewing a draft
// sees both: the existing scalar summary, and (new) the raw temporal
// evidence that summary was drawn from.
//
// PROVENANCE, SERVER-ASSIGNED, NEVER MODEL-CONTROLLED: the raw provider
// shapes carry no explicit provenance field at all (unlike
// `extractedFields`, which does). Rather than invent one out of nothing,
// this file assigns a FIXED authority per STRUCTURAL KIND, matching the
// real-video system prompt's own explicit framing of what each kind is:
//   - temporalObservations: the prompt requires these to be "raw,
//     literal" descriptions ("describe only what a non-expert would
//     literally see or hear") -- the closest existing authority class is
//     OBSERVED.
//   - actionCandidates: the prompt frames these as the provider's OWN
//     coarse, chosen grouping/interpretation of observations ("you MAY
//     propose... using a SHORT GENERIC LABEL you choose yourself") --
//     the closest existing authority class is INFERRED.
//   - notableEditsOrCuts: a literal structural claim about the video
//     itself (a cut/edit point), not a professional-technique reading --
//     treated as OBSERVED, the same as a temporal observation.
// NEVER PROFESSIONAL_INPUT (only an explicit professional statement can
// ever be that) and NEVER UNKNOWN (an entry that does not exist is
// simply absent from its array -- UNKNOWN is reserved for this stage's
// existing scalar-field semantics, not for a variable-length evidence
// list). This is a considered architectural choice, not a guess -- see
// T1.2's own audit report for the full reasoning.

const MAX_TEMPORAL_ENTRIES_PER_ARRAY = 200;
const MAX_TEMPORAL_TEXT_LENGTH = 2000;

export interface ProfessionalLearningTemporalObservationEvidence {
  readonly timeStartSeconds: number;
  readonly timeEndSeconds: number;
  readonly observation: string;
  readonly source: "OBSERVED";
}

export interface ProfessionalLearningTemporalActionEvidence {
  readonly timeStartSeconds: number;
  readonly timeEndSeconds: number;
  readonly kind: string;
  readonly source: "INFERRED";
}

export interface ProfessionalLearningTemporalEditGapEvidence {
  readonly beforeTimeSeconds: number;
  readonly afterTimeSeconds: number;
  readonly source: "OBSERVED";
}

export interface ProfessionalLearningTemporalEvidence {
  readonly observations: readonly ProfessionalLearningTemporalObservationEvidence[];
  readonly actions: readonly ProfessionalLearningTemporalActionEvidence[];
  readonly editGaps: readonly ProfessionalLearningTemporalEditGapEvidence[];
}

function isNonEmptyBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEMPORAL_TEXT_LENGTH;
}

function isValidEditGapShape(value: unknown): value is { beforeTimeSeconds: number; afterTimeSeconds: number } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const { beforeTimeSeconds, afterTimeSeconds } = record;
  return (
    typeof beforeTimeSeconds === "number" &&
    Number.isFinite(beforeTimeSeconds) &&
    beforeTimeSeconds >= 0 &&
    typeof afterTimeSeconds === "number" &&
    Number.isFinite(afterTimeSeconds) &&
    afterTimeSeconds >= beforeTimeSeconds
  );
}

// Builds the canonical, persistable temporal evidence layer from the
// extractor's own raw output. Untrusted input, exactly like `extraction`
// itself -- every entry is independently, structurally validated
// (reusing professional-learning-video-temporal.ts's own
// isValidVideoTimeInterval verbatim for the interval portion, never a
// second interval-validation implementation). A single malformed entry
// is silently DROPPED, never fabricated and never enough to reject the
// whole draft (matching buildExtractionFromRawFields's own established
// "drop the invalid one, keep the rest" discipline). Returns null when
// there is nothing valid to preserve (including for every non-VIDEO
// evidence type, where these fields are simply absent) -- never an
// empty-but-present object, so a reviewer/API consumer can tell "no
// temporal evidence for this draft" apart from "temporal evidence
// existed but every entry happened to be invalid" only by the latter
// being a practically-unreachable edge case, not by inventing a
// three-state signal this stage does not need.
export function buildProfessionalLearningTemporalEvidence(
  output: Pick<ProfessionalLearningExtractorOutput, "temporalObservations" | "actionCandidates" | "notableEditsOrCuts">,
): ProfessionalLearningTemporalEvidence | null {
  const observations: ProfessionalLearningTemporalObservationEvidence[] = [];
  for (const raw of output.temporalObservations ?? []) {
    if (observations.length >= MAX_TEMPORAL_ENTRIES_PER_ARRAY) break;
    if (!isValidVideoTimeInterval(raw) || !isNonEmptyBoundedText(raw.observation)) continue;
    observations.push({ timeStartSeconds: raw.timeStartSeconds, timeEndSeconds: raw.timeEndSeconds, observation: raw.observation.trim(), source: "OBSERVED" });
  }

  const actions: ProfessionalLearningTemporalActionEvidence[] = [];
  for (const raw of output.actionCandidates ?? []) {
    if (actions.length >= MAX_TEMPORAL_ENTRIES_PER_ARRAY) break;
    if (!isValidVideoTimeInterval(raw) || !isNonEmptyBoundedText(raw.kind)) continue;
    actions.push({ timeStartSeconds: raw.timeStartSeconds, timeEndSeconds: raw.timeEndSeconds, kind: raw.kind.trim(), source: "INFERRED" });
  }

  const editGaps: ProfessionalLearningTemporalEditGapEvidence[] = [];
  for (const raw of output.notableEditsOrCuts ?? []) {
    if (editGaps.length >= MAX_TEMPORAL_ENTRIES_PER_ARRAY) break;
    if (!isValidEditGapShape(raw)) continue;
    editGaps.push({ beforeTimeSeconds: raw.beforeTimeSeconds, afterTimeSeconds: raw.afterTimeSeconds, source: "OBSERVED" });
  }

  if (observations.length === 0 && actions.length === 0 && editGaps.length === 0) return null;
  return { observations, actions, editGaps };
}

function isValidObservationEntry(value: unknown): value is ProfessionalLearningTemporalObservationEvidence {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isValidVideoTimeInterval(record) && isNonEmptyBoundedText(record.observation) && record.source === "OBSERVED";
}

function isValidActionEntry(value: unknown): value is ProfessionalLearningTemporalActionEvidence {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isValidVideoTimeInterval(record) && isNonEmptyBoundedText(record.kind) && record.source === "INFERRED";
}

function isValidEditGapEntry(value: unknown): value is ProfessionalLearningTemporalEditGapEvidence {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.source !== "OBSERVED") return false;
  return isValidEditGapShape(record);
}

// Defensive read-side check -- mirrors this codebase's own "frozen Json
// payload, validated by a pure function, never trusted verbatim" pattern
// (see ProfessionalLearningDraft.extraction's own schema comment). Used
// wherever a caller wants to confirm a persisted value still matches
// this exact shape rather than casting blindly.
export function isValidProfessionalLearningTemporalEvidence(value: unknown): value is ProfessionalLearningTemporalEvidence {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.observations) &&
    record.observations.every(isValidObservationEntry) &&
    Array.isArray(record.actions) &&
    record.actions.every(isValidActionEntry) &&
    Array.isArray(record.editGaps) &&
    record.editGaps.every(isValidEditGapEntry)
  );
}
