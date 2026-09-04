import { createHash } from "crypto";

import { isRecord } from "@/lib/technical-visual-map-validators";

// Technical Demonstration, Stage 1 ("cutting plan foundation only") --
// types-only + pure validators, no I/O, no database, no AI. Mirrors
// technical-visual-map-validators.ts's own established convention
// (small exported allowlist arrays, `is*` type guards) exactly.
//
// This file holds the SHARED, vertical-agnostic vocabulary and record
// shapes (Decision Lock: "vertical engines must remain independently
// executable... share plan lifecycle, provenance, ... professional
// approval"). Vertical-specific step payloads (Stage 1: cutting only)
// live in their own sibling file --
// technical-demonstration-cutting-contracts.ts -- so a future vertical
// never has to touch this one.

// ---------------------------------------------------------------------------
// Vertical allowlist -- deliberately plain strings, mirrors
// PROPOSAL_VERTICALS (proposal-validators.ts) exactly. Stage 1 only ever
// writes "cutting"; a future vertical is a one-line addition here, never a
// schema migration (TechnicalDemonstrationPlan.vertical/
// TechnicalDemonstrationStep.vertical are both plain, unconstrained
// Postgres TEXT columns).
// ---------------------------------------------------------------------------

export const TECHNICAL_DEMONSTRATION_VERTICALS = ["cutting"] as const;
export type TechnicalDemonstrationVertical = (typeof TECHNICAL_DEMONSTRATION_VERTICALS)[number];

export function isTechnicalDemonstrationVertical(value: unknown): value is TechnicalDemonstrationVertical {
  return typeof value === "string" && (TECHNICAL_DEMONSTRATION_VERTICALS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Plan lifecycle -- mirrors TechnicalVisualMap's own DRAFT|CONFIRMED|
// SUPERSEDED exactly (no REJECTED -- a plan is a derived artifact of an
// already-CONFIRMED AnalysisProposal, not an independently-evaluated
// option with its own accept/decline decision, same reasoning
// TechnicalVisualMap's own header comment already gives).
// ---------------------------------------------------------------------------

export const TECHNICAL_DEMONSTRATION_PLAN_STATUSES = ["DRAFT", "CONFIRMED", "SUPERSEDED"] as const;
export type TechnicalDemonstrationPlanStatus = (typeof TECHNICAL_DEMONSTRATION_PLAN_STATUSES)[number];

export function isTechnicalDemonstrationPlanStatus(value: unknown): value is TechnicalDemonstrationPlanStatus {
  return typeof value === "string" && (TECHNICAL_DEMONSTRATION_PLAN_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Field-level provenance -- Decision Lock's own locked vocabulary.
// OBSERVED: copied directly, verbatim, from the confirmed proposal's own
//   structured data (never re-derived).
// INFERRED: computed deterministically FROM confirmed structured data via
//   a fixed, documented rule (e.g. a plan-level field propagated to every
//   step, or one closed enum mapped to another) -- never a guess, never an
//   AI call.
// UNKNOWN: Stage 1 genuinely has no source data for this field -- honestly
//   represented as absent, never fabricated (Decision Lock's own explicit
//   "represent missing information honestly" rule).
// PROFESSIONAL_OVERRIDE: the value came from a real professional edit on
//   the confirmed AnalysisProposal (AnalysisProposal.edits, merged via
//   technical-visual-map-assembler.ts's own computeEffectiveTechnicalCutPlan
//   -- see technical-demonstration-derivation.ts's own header comment),
//   OR (Stage 2.5.b) from a real professional adjustment on the
//   TechnicalDemonstrationPlan itself (professionalOverrides, resolved via
//   technical-demonstration-cutting-overrides.ts's own
//   resolveEffectiveCuttingStepPayload) -- never a generic engine-derived
//   INFERRED value either way, so a later reader can always tell "a human
//   specifically approved/supplied this exact value" apart from "the
//   deterministic engine's own untouched suggestion".
// NOT_APPLICABLE (Stage 2.5.b): a real professional decision that this
//   field genuinely does not apply to this specific step's own action --
//   deliberately DISTINCT from UNKNOWN ("we don't have this information
//   yet", a gap that may still be filled) and from PROFESSIONAL_OVERRIDE
//   ("here is the real value") -- e.g. a professional reviewing a
//   sectioning-phase step may correctly determine crossCheck simply has no
//   meaning for that specific action. The deterministic derivation
//   (technical-demonstration-derivation.ts) never produces this tag itself
//   -- like PROFESSIONAL_OVERRIDE, only a real professional decision ever
//   does.
// ---------------------------------------------------------------------------

export const TECHNICAL_DEMONSTRATION_VALUE_PROVENANCES = ["OBSERVED", "INFERRED", "UNKNOWN", "PROFESSIONAL_OVERRIDE", "NOT_APPLICABLE"] as const;
export type TechnicalDemonstrationValueProvenance = (typeof TECHNICAL_DEMONSTRATION_VALUE_PROVENANCES)[number];

export function isTechnicalDemonstrationValueProvenance(value: unknown): value is TechnicalDemonstrationValueProvenance {
  return typeof value === "string" && (TECHNICAL_DEMONSTRATION_VALUE_PROVENANCES as readonly string[]).includes(value);
}

// A single technical field, tagged with where its value actually came
// from. `value` is null whenever `provenance` is "UNKNOWN" or
// "NOT_APPLICABLE" (this codebase never pairs a real value with an honest
// "we don't know this" / "this doesn't apply" tag) -- enforced by
// isProvenanceValue below, not just by convention.
export interface TechnicalDemonstrationProvenanceValue<T> {
  value: T | null;
  provenance: TechnicalDemonstrationValueProvenance;
}

// Shared runtime guard factory -- reused by every vertical-specific step
// validator (Stage 1: technical-demonstration-cutting-contracts.ts) so the
// "value is null iff provenance is UNKNOWN/NOT_APPLICABLE" invariant is
// enforced in exactly one place, never re-implemented per field.
export function isProvenanceValue<T>(value: unknown, isInner: (candidate: unknown) => candidate is T): value is TechnicalDemonstrationProvenanceValue<T> {
  if (!isRecord(value)) return false;
  if (!isTechnicalDemonstrationValueProvenance(value.provenance)) return false;
  if (value.provenance === "UNKNOWN" || value.provenance === "NOT_APPLICABLE") return value.value === null;
  return isInner(value.value);
}

// Stage 2.5.c -- relocated here (from the proposed-look page's own
// technical-demonstration-plan-logic.ts, which still re-exports both for
// backward compatibility with every existing import site) because the new
// server-side Technical Execution Video readiness evaluator
// (technical-demonstration-cutting-video-readiness.ts) needs these same
// two predicates and lives in src/lib -- it must never import from a
// route's own colocated UI logic file (wrong architectural layering
// direction, same rule this codebase already enforces everywhere else).
// These are generic, vertical-agnostic provenance predicates (operate on
// the bare `{provenance: string}` shape), so this shared file is their
// correct home, exactly like isProvenanceValue above.

// Only OBSERVED/INFERRED/PROFESSIONAL_OVERRIDE ever carry a real value --
// UNKNOWN and NOT_APPLICABLE always pair with `value: null` (enforced by
// isProvenanceValue above). This is the single predicate every call site
// (UI rendering AND readiness evaluation) uses to decide "does this field
// have a real value to show/count at all".
export function isProvenancePopulated(entry: { provenance: string } | undefined | null): boolean {
  return !!entry && entry.provenance !== "UNKNOWN" && entry.provenance !== "NOT_APPLICABLE";
}

// Distinguishes an honest "not applicable" decision from an honest "we
// don't know yet" gap (isProvenancePopulated's own false case covers
// both) -- used both to render a distinct UI bucket and, since Stage
// 2.5.c, to let a professional's explicit NOT_APPLICABLE decision satisfy
// a readiness rule exactly like a real value would.
export function isProvenanceNotApplicable(entry: { provenance: string } | undefined | null): boolean {
  return !!entry && entry.provenance === "NOT_APPLICABLE";
}

// ---------------------------------------------------------------------------
// Persisted record shapes -- returned by technical-demonstration-repository.ts.
// Mirrors TechnicalVisualMapRecord's own shape/field-naming exactly.
// ---------------------------------------------------------------------------

export interface TechnicalDemonstrationPlanRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  analysisProposalId: string;
  analysisProposalConfirmedAt: string;
  vertical: TechnicalDemonstrationVertical;
  status: TechnicalDemonstrationPlanStatus;
  planVersion: number;
  schemaVersion: string;
  generatorVersion: string;
  requestFingerprint: string;
  // Stage 2.5.b -- vertical-specific shape, `unknown[]` here deliberately,
  // same reasoning as TechnicalDemonstrationStepRecord.payload below: this
  // file has no notion of what a cutting/color/... override entry looks
  // like. Callers narrow it with the matching vertical's own validator
  // (Stage 1/2.5.b: isCuttingStepOverrideEntryArray,
  // technical-demonstration-cutting-overrides.ts). Always `[]` for a plan
  // with no professional overrides yet, never `null` at this record layer
  // (the repository normalizes a NULL database column to `[]`).
  professionalOverrides: unknown[];
  supersededByPlanId: string | null;
  confirmedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// DB-level idempotency backstop -- mirrors
// computePhotoPreviewRequestFingerprint (photo-preview-contracts.ts)
// exactly, including its own canonical-join + sha256-hex approach. Scoped
// to (ownerUserId, clientId, analysisProposalId, analysisProposalConfirmedAt,
// vertical, generatorVersion): the same confirmed proposal, re-derived by
// the same generation logic, always produces the same fingerprint, so a
// repeated create request resolves to the existing plan instead of a
// duplicate (Stage 1's own explicit idempotency requirement).
export function computeTechnicalDemonstrationPlanRequestFingerprint(input: {
  ownerUserId: string;
  clientId: string;
  analysisProposalId: string;
  analysisProposalConfirmedAt: string;
  vertical: string;
  generatorVersion: string;
}): string {
  const canonical = [
    input.ownerUserId,
    input.clientId,
    input.analysisProposalId,
    input.analysisProposalConfirmedAt,
    input.vertical,
    input.generatorVersion,
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export interface TechnicalDemonstrationStepRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  planId: string;
  vertical: TechnicalDemonstrationVertical;
  stepNumber: number;
  stepSchemaVersion: string;
  // Vertical-specific shape -- `unknown` here deliberately (this file has
  // no notion of what a cutting/color/... payload looks like); callers
  // narrow it with the matching vertical's own validator, e.g.
  // isValidCuttingDemonstrationStepPayload.
  payload: Record<string, unknown>;
  explanation: string | null;
  createdAt: string;
  updatedAt: string;
}
