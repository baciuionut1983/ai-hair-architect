import { isRecord } from "@/lib/technical-visual-map-validators";
import { SKILL_CAPABILITY_KINDS, type SkillCapabilityKind } from "@/lib/professional-skill-contracts";
import { isValidExecutionUnit, type ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";
import {
  isAtomicActionEvidenceStatus,
  isValidAtomicActionSequence,
  type AtomicAction,
  type AtomicActionObservationCriterion,
} from "@/lib/professional-skill-atomic-action-contracts";

// AI Hair Architect, Professional Skill Engine Stage 6 -- PROFESSIONAL
// EXECUTION PLAN, contract/foundation layer. Types + pure structural
// validators, no I/O, no AI. UNIFIES, never duplicates, the dormant Skill
// Engine (Stage 2.5.i.1-i.12): ExecutionUnit and AtomicAction are REUSED
// VERBATIM, unchanged, from professional-skill-execution-unit-contracts.ts
// / professional-skill-atomic-action-contracts.ts -- this file adds ONLY
// the facts those two files structurally cannot express (WHY a unit
// exists relative to a HairStateDelta, and a whole-unit completion
// signal), by WRAPPING them, never by re-declaring or forking their own
// shape.
//
// AUTHORITY DECISION (Part A audit): TechnicalDemonstrationPlan (System
// A, technical-demonstration-contracts.ts) remains its own, separate,
// unmodified authority for the AnalysisProposal/TechnicalCutPlan-rooted
// deterministic cutting engine -- Stage 1's own Decision Lock already
// settled that System A and System B (the Skill Engine) are two parallel
// chains, never merged. ProfessionalExecutionPlan is rooted in System B's
// OWN chain (HairStateSnapshot -> HairStateDelta -> Stage 5's
// ProfessionalReasoningProposal), never in AnalysisProposal -- it does
// NOT compete with TechnicalDemonstrationPlan because it answers a
// genuinely different question, for a genuinely different root authority.
// Neither the Prisma model nor the TypeScript contract below imports from
// or is compatible with technical-demonstration-contracts.ts's own shape.
//
// WHY <-> WHAT (Part C): a PlannedExecutionUnit wraps a real ExecutionUnit
// with `addressesDelta`/`declaredCapabilityUsed` -- the EXACT SAME two
// fields Stage 5's own ProposedSkillStep already carries
// (professional-reasoning-contracts.ts), so the Stage 5 -> Stage 6 bridge
// is a direct, lossless carry-forward, never a re-derivation.
//
// COMPLETION (Part G) reuses AtomicActionObservationCriterion's own exact
// shape (fact/expectedValue/evidenceStatus) rather than inventing a
// second "is this done" concept -- a completion criterion IS an
// observation criterion, scoped to the whole unit instead of one atomic
// action.
//
// VERIFICATION (Part I) is deliberately NOT a new field here at all: it
// is satisfied by requiring at least one VERIFY-kind AtomicAction (the
// existing AtomicActionKind, unchanged) within a unit's own
// atomicActions, carrying a real observationCriterion -- see
// professional-execution-plan-validator.ts's own check #14. This is the
// clearest possible instance of "reuse existing ExecutionUnit/AtomicAction
// semantics wherever possible" (Part C's own explicit instruction):
// nothing new is added, an EXISTING mechanism is simply required to be
// present.
//
// ITERATION/PROGRESSION (Part F) needs ZERO new contract code: it is
// AtomicAction.iteration, already real, already activated end-to-end
// (Stage 2.5.i.25), reused as-is inside each unit's own atomicActions.
//
// REQUIRED/CONDITIONAL/OPTIONAL (Part D) needs ZERO new contract code
// either: it is ExecutionUnit.parameterRules's own existing
// ExecutionUnitParameterSemantic (REQUIRED_FIXED/REQUIRED_CONDITIONAL/
// PROFESSIONAL_CHOICE/NOT_APPLICABLE/CLIENT_DERIVED/UNDEFINED) -- see
// professional-execution-plan-readiness.ts, which evaluates it.

export const PROFESSIONAL_EXECUTION_PLAN_SCHEMA_VERSION = "1.0.0-pep6";

// ---------------------------------------------------------------------------
// Part E -- parameter provenance. Independently named (the task's own
// explicit 6-value list matches no single existing vocabulary exactly,
// though every individual value's MEANING mirrors an existing precedent:
// OBSERVED/INFERRED/CLIENT_REPORTED/AI_PROPOSED all mirror
// HairStateValueSource's own identical meanings; PROFESSIONAL_OVERRIDE
// mirrors TechnicalDemonstrationValueProvenance's/SkillInstanceParameter
// BindingState's own identical meaning -- reused as a value NAME, even
// though this is a new enum, for that reason). SKILL_DEFAULT is genuinely
// usable, and is exactly how all 3 real skills' own SkillInstance.
// parameterBindings resolve today: every one of their bindings uses
// bindingState "FIXED_FROM_AUTHORITY" (professional-skill-instance-
// contracts.ts) -- a real, professionally-authored, version-pinned fixed
// value declared directly on that exact Skill Instance, never invented by
// this stage's own code. The compiler
// (professional-execution-plan-compiler.ts) maps
// FIXED_FROM_AUTHORITY -> SKILL_DEFAULT one-for-one. What this stage does
// NOT do is invent a NEW default where none was declared: a plain
// ExecutionUnitParameterRule with semantic REQUIRED_FIXED that carries no
// matching SkillInstance binding is a genuine gap (MISSING_REQUIRED_
// PARAMETER), never silently backfilled with SKILL_DEFAULT.
// ---------------------------------------------------------------------------

export const EXECUTION_PLAN_PARAMETER_SOURCES = ["OBSERVED", "INFERRED", "AI_PROPOSED", "PROFESSIONAL_OVERRIDE", "CLIENT_REPORTED", "SKILL_DEFAULT"] as const;
export type ExecutionPlanParameterSource = (typeof EXECUTION_PLAN_PARAMETER_SOURCES)[number];

export function isExecutionPlanParameterSource(value: unknown): value is ExecutionPlanParameterSource {
  return typeof value === "string" && (EXECUTION_PLAN_PARAMETER_SOURCES as readonly string[]).includes(value);
}

function isParameterLiteral(value: unknown): value is string | boolean | number {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

export interface PlannedExecutionParameter {
  name: string;
  value: string | boolean | number;
  source: ExecutionPlanParameterSource;
}

function isValidPlannedExecutionParameter(value: unknown): value is PlannedExecutionParameter {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string" || value.name.length === 0) return false;
  if (!("value" in value) || value.value === undefined || !isParameterLiteral(value.value)) return false;
  return isExecutionPlanParameterSource(value.source);
}

// ---------------------------------------------------------------------------
// Part T -- failure reasons. Closed, new vocabulary (Stage 6's own). The
// first 14 values are the task's own literal list, verbatim. FOUR
// additional values were found genuinely necessary while implementing
// the Part J validator, each covering a real check that list itself
// names but that none of the 14 literal values honestly fits:
//   NOT_APPLICABLE_PARAMETER_SUPPLIED -- Part D's own "NOT_APPLICABLE-but-
//     supplied rejected" rule needs a reason distinct from
//     INVALID_SKILL_VERSION/CAPABILITY_MISMATCH/etc.
//   INVALID_PARAMETER_VALUE -- "parameter values allowed" (Part J) needs a
//     reason for a value present but outside its own declared set/fixed
//     value -- distinct from MISSING_REQUIRED_PARAMETER (absent) and
//     UNKNOWN_CONDITIONAL_PARAMETER (applicability unknown).
//   INVENTED_SKILL_STEP -- "no undeclared capability... no hidden
//     haircut-template step" (Part J) needs a reason for a planned unit
//     whose underlying skill is not recognized at all, distinct from
//     SKILL_NOT_ALLOWED (recognized, but not approved for this plan).
//   STALE_SNAPSHOT_REFERENCE -- "source snapshots remain exact" (Part J)
//     / Part S's own immutability rule needs a reason for a plan whose
//     pinned snapshot id/version no longer matches the live snapshot a
//     caller is re-checking against.
// ---------------------------------------------------------------------------

export const EXECUTION_PLAN_FAILURE_REASONS = [
  "MISSING_REQUIRED_PARAMETER",
  "UNKNOWN_CONDITIONAL_PARAMETER",
  "INVALID_SKILL_VERSION",
  "SKILL_NOT_ALLOWED",
  "CAPABILITY_MISMATCH",
  "INVALID_ZONE",
  "UNSATISFIED_PRECONDITION",
  "ORDER_DEPENDENCY_VIOLATION",
  "PRESERVATION_CONSTRAINT_VIOLATION",
  "MISSING_COMPLETION_CONDITION",
  "MISSING_EXPECTED_EFFECT",
  "MISSING_VERIFICATION_REQUIREMENT",
  "UNRESOLVED_DELTA",
  "PLAN_NOT_PROFESSIONALLY_APPROVED",
  "NOT_APPLICABLE_PARAMETER_SUPPLIED",
  "INVALID_PARAMETER_VALUE",
  "INVENTED_SKILL_STEP",
  "STALE_SNAPSHOT_REFERENCE",
] as const;
export type ExecutionPlanFailureReason = (typeof EXECUTION_PLAN_FAILURE_REASONS)[number];

export function isExecutionPlanFailureReason(value: unknown): value is ExecutionPlanFailureReason {
  return typeof value === "string" && (EXECUTION_PLAN_FAILURE_REASONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Part C/G/H/I -- Planned Execution Unit: a real ExecutionUnit + its
// compiled AtomicAction sequence (BOTH reused, unmodified), plus the
// Stage-6-specific WHY/completion/parameter-resolution facts those two
// contracts have no field for.
// ---------------------------------------------------------------------------

export interface PlannedExecutionUnit<TFact extends string = string> {
  executionUnit: ExecutionUnit<TFact>;
  // Real AtomicAction[] -- validated as a sequence via
  // isValidAtomicActionSequence (unchanged). Must include at least one
  // VERIFY-kind action with a real observationCriterion -- Part I's own
  // verification requirement, enforced by the plan validator, never by a
  // new field here.
  atomicActions: readonly AtomicAction<TFact>[];
  // WHY (Part C) -- identical shape to Stage 5's own ProposedSkillStep.
  addressesDelta: { scope: string; field: string };
  declaredCapabilityUsed: SkillCapabilityKind;
  // Completion (Part G) -- reuses AtomicActionObservationCriterion's own
  // shape verbatim; see file header.
  completionCriterion: AtomicActionObservationCriterion;
  // The parameters actually resolved for this unit, each with its own
  // provenance (Part E).
  resolvedParameters: readonly PlannedExecutionParameter[];
}

export function isValidPlannedExecutionUnit<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is PlannedExecutionUnit<TFact> {
  if (!isRecord(value)) return false;
  if (!isValidExecutionUnit(value.executionUnit, isValidFact)) return false;
  if (!Array.isArray(value.atomicActions) || !isValidAtomicActionSequence(value.atomicActions as AtomicAction<TFact>[])) return false;
  if (!isRecord(value.addressesDelta) || typeof value.addressesDelta.scope !== "string" || typeof value.addressesDelta.field !== "string") return false;
  if (!(SKILL_CAPABILITY_KINDS as readonly string[]).includes(value.declaredCapabilityUsed as string)) return false;
  if (!isValidObservationCriterionShape(value.completionCriterion)) return false;
  if (!Array.isArray(value.resolvedParameters) || !value.resolvedParameters.every(isValidPlannedExecutionParameter)) return false;
  return true;
}

// Local structural check mirroring AtomicActionObservationCriterion's own
// exact validator (professional-skill-atomic-action-contracts.ts does not
// export a standalone guard for it -- only as an inline check inside
// isValidAtomicAction -- so this reproduces the identical three-field
// check rather than importing a private function; the TYPE and the
// closed evidenceStatus vocabulary guard (isAtomicActionEvidenceStatus)
// are both still imported and reused, never redeclared).
function isValidObservationCriterionShape(value: unknown): value is AtomicActionObservationCriterion {
  if (!isRecord(value)) return false;
  if (typeof value.fact !== "string" || value.fact.length === 0) return false;
  if (!("expectedValue" in value) || value.expectedValue === undefined || !isParameterLiteral(value.expectedValue)) return false;
  return isAtomicActionEvidenceStatus(value.evidenceStatus);
}

// ---------------------------------------------------------------------------
// Part B/M -- readiness (a completeness signal DISTINCT from the
// persistence lifecycle status -- mirrors Stage 5's own "reasoningStatus
// separate from DRAFT/CONFIRMED/REJECTED" split exactly).
// ---------------------------------------------------------------------------

export const PROFESSIONAL_EXECUTION_PLAN_READINESS_STATES = ["READY_FOR_PROFESSIONAL_REVIEW", "PARTIAL", "NEEDS_SKILL", "NEEDS_INPUT", "BLOCKED"] as const;
export type ProfessionalExecutionPlanReadiness = (typeof PROFESSIONAL_EXECUTION_PLAN_READINESS_STATES)[number];

export function isProfessionalExecutionPlanReadiness(value: unknown): value is ProfessionalExecutionPlanReadiness {
  return typeof value === "string" && (PROFESSIONAL_EXECUTION_PLAN_READINESS_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Part B -- the plan itself. Binds exactly to its own source authority
// chain, historically reproducible (Part S): an old plan never silently
// starts using a newer snapshot/skill version/reasoning proposal.
// ---------------------------------------------------------------------------

export interface ProfessionalExecutionPlanPreserveConstraint {
  scope: string;
  field: string;
  value: string;
  description: string;
}

export interface ProfessionalExecutionPlanUnresolvedRequirement {
  scope: string;
  field: string;
  reason: string;
}

export interface ProfessionalExecutionPlan<TFact extends string = string> {
  schemaVersion: string;
  currentSnapshotId: string;
  currentSnapshotVersion: number;
  targetSnapshotId: string;
  targetSnapshotVersion: number;
  // Exact Stage 5 provenance -- never silently rebased onto a newer
  // proposal.
  reasoningProposalId: string;
  reasoningProposalContextFingerprint: string;
  plannedUnits: readonly PlannedExecutionUnit<TFact>[];
  // Carried forward VERBATIM from the Stage 5 proposal -- never
  // re-derived, never silently dropped (Part M/Part L).
  preservationConstraints: readonly ProfessionalExecutionPlanPreserveConstraint[];
  unresolvedRequirements: readonly ProfessionalExecutionPlanUnresolvedRequirement[];
  readiness: ProfessionalExecutionPlanReadiness;
}

export function isValidProfessionalExecutionPlan<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is ProfessionalExecutionPlan<TFact> {
  if (!isRecord(value)) return false;
  if (typeof value.schemaVersion !== "string" || value.schemaVersion.length === 0) return false;
  if (typeof value.currentSnapshotId !== "string" || value.currentSnapshotId.length === 0) return false;
  if (typeof value.currentSnapshotVersion !== "number" || !Number.isInteger(value.currentSnapshotVersion) || value.currentSnapshotVersion < 1) return false;
  if (typeof value.targetSnapshotId !== "string" || value.targetSnapshotId.length === 0) return false;
  if (typeof value.targetSnapshotVersion !== "number" || !Number.isInteger(value.targetSnapshotVersion) || value.targetSnapshotVersion < 1) return false;
  if (typeof value.reasoningProposalId !== "string" || value.reasoningProposalId.length === 0) return false;
  if (typeof value.reasoningProposalContextFingerprint !== "string" || value.reasoningProposalContextFingerprint.length === 0) return false;

  if (!Array.isArray(value.plannedUnits) || !value.plannedUnits.every((u) => isValidPlannedExecutionUnit(u, isValidFact))) return false;

  if (!Array.isArray(value.preservationConstraints)) return false;
  if (
    !value.preservationConstraints.every(
      (c) => isRecord(c) && typeof c.scope === "string" && typeof c.field === "string" && typeof c.value === "string" && typeof c.description === "string",
    )
  ) {
    return false;
  }
  if (!Array.isArray(value.unresolvedRequirements)) return false;
  if (!value.unresolvedRequirements.every((r) => isRecord(r) && typeof r.scope === "string" && typeof r.field === "string" && typeof r.reason === "string")) return false;

  if (!isProfessionalExecutionPlanReadiness(value.readiness)) return false;

  return true;
}

// Re-exported so a caller of this file never needs a second import purely
// to reference the reused type.
export type { AtomicActionObservationCriterion };
