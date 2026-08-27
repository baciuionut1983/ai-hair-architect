import type {
  AnalysisFieldSource,
  ProfessionalMemoryKind,
  ProfessionalMemoryScope,
} from "@prisma/client";

import type {
  CuttingStep,
  CuttingTechnique,
  StructuralTechnique,
  TechnicalCutDistribution,
  TechnicalCutElevation,
  TechnicalCutGuideline,
  TechnicalCutPlan,
  TechnicalCutSectioning,
  TexturizingTechnique,
} from "@/lib/contracts";

// AI Proposed Look (Phase 2), Stage 2 -- runtime validators for the
// AnalysisProposal domain. The analogous validators for Analysis live as
// private helpers inside analysis-repository.ts (contracts.ts is types-only
// in this codebase), and the codebase already has standalone
// `*-validator.ts` / `*-validation.ts` modules (webhook-envelope-validator.ts,
// image-upload-validation.ts); this file follows that precedent so the
// vocabulary can also be reused by later stages (e.g. the Consult AI
// "Use in Proposed Look" hook) without importing the repository.

// ---------------------------------------------------------------------------
// Vertical allowlist
// ---------------------------------------------------------------------------

// App-level allowlist, deliberately a small exported const array rather than a
// Postgres enum -- exactly how ANALYSIS_PHASES already gates Analysis.phase
// (see analysis-repository.ts). Adding a vertical later is a one-line change
// here, never a schema migration.
export const PROPOSAL_VERTICALS = ["cutting"] as const;
export type ProposalVertical = (typeof PROPOSAL_VERTICALS)[number];

export function isProposalVertical(value: unknown): value is ProposalVertical {
  return typeof value === "string" && (PROPOSAL_VERTICALS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Lifecycle statuses + legal transitions
// ---------------------------------------------------------------------------

// Plain strings, application-validated -- same reasoning as `vertical` above
// and Analysis.phase. The four architecture-locked states.
export const PROPOSAL_STATUSES = ["DRAFT", "CONFIRMED", "REJECTED", "SUPERSEDED"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export function isProposalStatus(value: unknown): value is ProposalStatus {
  return typeof value === "string" && (PROPOSAL_STATUSES as readonly string[]).includes(value);
}

// The ONLY legal status changes in the architecture:
//   DRAFT -> CONFIRMED      (confirmProposal)
//   DRAFT -> REJECTED       (rejectProposal)
//   CONFIRMED -> SUPERSEDED (only ever triggered internally by confirmProposal
//                            when a newer proposal is confirmed for the same
//                            owner+client+vertical)
// Editing a DRAFT is NOT a transition -- it keeps the row in DRAFT. There is
// no path back from REJECTED or SUPERSEDED to anything, ever.
const PROPOSAL_STATUS_TRANSITIONS: Record<ProposalStatus, readonly ProposalStatus[]> = {
  DRAFT: ["CONFIRMED", "REJECTED"],
  CONFIRMED: ["SUPERSEDED"],
  REJECTED: [],
  SUPERSEDED: [],
};

export function isLegalProposalStatusTransition(from: unknown, to: unknown): boolean {
  if (!isProposalStatus(from) || !isProposalStatus(to)) return false;
  return PROPOSAL_STATUS_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Payload structure (frozen deterministic-engine OUTPUT)
// ---------------------------------------------------------------------------

// These mirror the enum vocabularies used by analysis-repository.ts's own
// (private, non-exported) isTechnicalCutPlan / isCuttingStep guards. The
// TechnicalCutPlan *type* is imported and reused from contracts.ts rather than
// redefined; only the runtime guard is re-authored here because the original
// is not exported and analysis-repository.ts must not be modified in Stage 2.
// `satisfies` keeps these in lockstep with the contracts.ts unions at compile
// time.
const STRUCTURAL_TECHNIQUES = [
  "precision_layering",
  "graduation",
  "one_length",
  "internal_layering",
  "compact_graduation",
] as const satisfies readonly StructuralTechnique[];
const CUTTING_TECHNIQUES = [
  "blunt_line",
  "scissor_over_comb",
  "slice_cutting",
  "elevation_cutting",
] as const satisfies readonly CuttingTechnique[];
const TEXTURIZING_TECHNIQUES = [
  "point_cutting",
  "slice_and_slide",
  "razor_texturizing",
  "channel_cutting",
  "debulking",
] as const satisfies readonly TexturizingTechnique[];
const SECTIONING_OPTIONS = [
  "4_quadrant_profile_radial",
  "horseshoe_crown",
  "diagonal_back",
  "pivot_radial",
  "horseshoe_fringe",
] as const satisfies readonly TechnicalCutSectioning[];
const ELEVATION_OPTIONS = [
  "0_deg_blunt",
  "45_deg_graduation",
  "90_deg_uniform_layer",
  "135_deg_long_layer",
  "180_deg_overdirection",
] as const satisfies readonly TechnicalCutElevation[];
const DISTRIBUTION_OPTIONS = [
  "natural_fall",
  "perpendicular",
  "overdirected_back",
  "overdirected_forward",
  "shifting_line",
] as const satisfies readonly TechnicalCutDistribution[];
const GUIDELINE_OPTIONS = [
  "stationary",
  "traveling",
  "visual_perimeter",
  "multiple_reference",
] as const satisfies readonly TechnicalCutGuideline[];

function isCuttingStep(value: unknown): value is CuttingStep {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.stepNumber) &&
    (value.stepNumber as number) > 0 &&
    isNonEmptyString(value.zone) &&
    isNonEmptyString(value.action) &&
    isOneOf(value.elevationAngle, ELEVATION_OPTIONS) &&
    isNonEmptyString(value.toolRequired)
  );
}

// Structural validity check for a vertical='cutting' payload: it must be a
// real TechnicalCutPlan, not merely "an object". Mirrors
// analysis-repository.ts's isTechnicalCutPlan exactly.
export function isTechnicalCutPlanShape(value: unknown): value is TechnicalCutPlan {
  if (!isRecord(value)) return false;
  return (
    isOneOf(value.structuralTechnique, STRUCTURAL_TECHNIQUES) &&
    isOneOf(value.cuttingTechnique, CUTTING_TECHNIQUES) &&
    (value.texturizingTechnique === undefined || isOneOf(value.texturizingTechnique, TEXTURIZING_TECHNIQUES)) &&
    isOneOf(value.sectioning, SECTIONING_OPTIONS) &&
    isOneOf(value.elevation, ELEVATION_OPTIONS) &&
    isOneOf(value.distribution, DISTRIBUTION_OPTIONS) &&
    isOneOf(value.guideline, GUIDELINE_OPTIONS) &&
    Array.isArray(value.cuttingSteps) &&
    value.cuttingSteps.every(isCuttingStep) &&
    isNonEmptyString(value.stylistExplanation) &&
    isNonEmptyString(value.clientExplanation) &&
    isNonEmptyString(value.professionalReason) &&
    isStringArray(value.warnings) &&
    isStringArray(value.contraindications) &&
    isStringArray(value.assumptions) &&
    isStringArray(value.missingData) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    (value.notes === undefined || isStringArray(value.notes)) &&
    isNonEmptyString(value.stylistValidationDisclaimer) &&
    isNonEmptyString(value.version)
  );
}

// Single entry point: "is this payload structurally valid for this vertical?"
export function isValidProposalPayload(vertical: string, value: unknown): boolean {
  switch (vertical) {
    case "cutting":
      return isTechnicalCutPlanShape(value);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Provenance shapes (edits / consideredMemory / promotedConsultationSources)
// ---------------------------------------------------------------------------

// `edits` entries mirror AnalysisCorrection's own field vocabulary
// ({ field, previousValue, newValue, source, reason? }). `source` is the full
// AnalysisFieldSource enum -- an edit record layered on the frozen baseline
// can legitimately carry system-derived provenance for where the baseline
// value itself came from, unlike ApplyAnalysisCorrectionInput which restricts
// a live human caller to two of the five.
export const PROPOSAL_EDIT_SOURCES = [
  "visual_ai",
  "stylist_confirmed",
  "client_reported",
  "historical",
  "assumed",
] as const satisfies readonly AnalysisFieldSource[];
export type ProposalEditSource = (typeof PROPOSAL_EDIT_SOURCES)[number];

export function isProposalEditSource(value: unknown): value is ProposalEditSource {
  return typeof value === "string" && (PROPOSAL_EDIT_SOURCES as readonly string[]).includes(value);
}

export const PROFESSIONAL_MEMORY_KINDS = [
  "fact",
  "professional_rule",
  "preference",
  "outcome",
  "ai_observation",
] as const satisfies readonly ProfessionalMemoryKind[];

export const PROFESSIONAL_MEMORY_SCOPES = [
  "client_specific",
  "stylist_specific",
  "shared_knowledge",
] as const satisfies readonly ProfessionalMemoryScope[];

export interface ProposalEditEntry {
  field: string;
  previousValue: unknown;
  newValue: unknown;
  source: ProposalEditSource;
  reason?: string;
}

export interface ConsideredMemoryEntry {
  memoryId: string;
  content: string;
  kind: string;
  scope: string;
  confidence: number;
  snapshotAt: string;
}

export interface PromotedConsultationSourceEntry {
  consultationMessageId: string;
  snapshotContent: string;
  promotedAt: string;
}

export function isProposalEditEntry(value: unknown): value is ProposalEditEntry {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.field)) return false;
  // previousValue / newValue are required KEYS -- their value may be anything
  // (including null), but a correction record that omits either is malformed.
  if (!("previousValue" in value)) return false;
  if (!("newValue" in value)) return false;
  if (!isProposalEditSource(value.source)) return false;
  if (value.reason !== undefined && typeof value.reason !== "string") return false;
  return true;
}

export function isConsideredMemoryEntry(value: unknown): value is ConsideredMemoryEntry {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.memoryId) &&
    isNonEmptyString(value.content) &&
    isOneOf(value.kind, PROFESSIONAL_MEMORY_KINDS) &&
    isOneOf(value.scope, PROFESSIONAL_MEMORY_SCOPES) &&
    isFiniteUnitInterval(value.confidence) &&
    isIsoDateString(value.snapshotAt)
  );
}

export function isPromotedConsultationSourceEntry(value: unknown): value is PromotedConsultationSourceEntry {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.consultationMessageId) &&
    isNonEmptyString(value.snapshotContent) &&
    isIsoDateString(value.promotedAt)
  );
}

export function isProposalEditArray(value: unknown): value is ProposalEditEntry[] {
  return Array.isArray(value) && value.every(isProposalEditEntry);
}

export function isConsideredMemoryArray(value: unknown): value is ConsideredMemoryEntry[] {
  return Array.isArray(value) && value.every(isConsideredMemoryEntry);
}

export function isPromotedConsultationSourceArray(value: unknown): value is PromotedConsultationSourceEntry[] {
  return Array.isArray(value) && value.every(isPromotedConsultationSourceEntry);
}

// ---------------------------------------------------------------------------
// Shared low-level guards (also used by proposal-repository.ts)
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isFiniteUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}
