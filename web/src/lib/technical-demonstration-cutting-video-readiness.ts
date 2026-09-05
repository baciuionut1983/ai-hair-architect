import {
  isProvenanceNotApplicable,
  isProvenancePopulated,
  type TechnicalDemonstrationPlanRecord,
  type TechnicalDemonstrationStepRecord,
} from "@/lib/technical-demonstration-contracts";
import { CUTTING_EXECUTION_PHASES, type CuttingDemonstrationStepPayload, type CuttingExecutionActionType, type CuttingExecutionPhase } from "@/lib/technical-demonstration-cutting-contracts";
import type { CuttingStepOverrideFieldName } from "@/lib/technical-demonstration-cutting-overrides";
import { resolveEffectiveActionType } from "@/lib/technical-demonstration-derivation";

// Technical Demonstration, Stage 2.5.c -- the Technical Execution Video
// READINESS GATE. Pure, deterministic, server-only domain logic: no I/O, no
// database, no provider call, no AI. Answers exactly one question, per the
// Stage 2.5.c professional decision lock: "does a CONFIRMED Technical
// Demonstration Plan (and each of its steps) contain enough approved
// structured information to be reproduced/represented visually without the
// video system having to invent a materially important technical action?"
//
// CORE SEMANTIC LOCK (never to be violated by this file): CONFIRMED !=
// VIDEO_READY. Readiness is a COMPUTED property, never persisted as a new
// TechnicalDemonstrationPlan.status value -- evaluatePlanReadiness is a
// pure function of (plan, effective steps), always safe to call repeatedly,
// never a second source of truth for plan lifecycle.
//
// Every rule below encodes ONLY what the Stage 2.5.c professional domain
// review actually decided (see the Stage 2.5.c task's own "PROFESSIONAL
// DECISION LOCK" section) -- this file does not invent hairstyling
// judgment. Where the professional's own condition ("required WHEN X
// materially affects Y") cannot be computed deterministically from
// anything in the payload, the resolution mechanism is the professional's
// OWN explicit choice: either supply a real value, or mark the field
// NOT_APPLICABLE. UNKNOWN is what blocks -- never an automatic system
// guess about materiality.

// ---------------------------------------------------------------------------
// Field readiness rules -- the single source of truth for "which fields
// matter, on which phases, at what strength". REQUIRED and
// CONDITIONALLY_REQUIRED are evaluated IDENTICALLY at runtime (a field must
// not be UNKNOWN on a phase where it's listed as applicable; NOT_APPLICABLE
// always satisfies) -- the two labels exist only so a future UI can explain
// WHY a field was asked for ("core to this phase" vs "you haven't yet told
// us whether this applies"), never a behavioral difference.
// ---------------------------------------------------------------------------

export type FieldReadinessClass = "REQUIRED" | "CONDITIONALLY_REQUIRED";

export interface FieldReadinessRule {
  field: CuttingStepOverrideFieldName;
  // The phases on which this field is evaluated for blocking at all. A
  // field is implicitly OPTIONAL (never evaluated, never blocks) on any
  // phase not listed here -- this is what lets FINAL_CHECK skip cutting-
  // geometry fields entirely by default, per the Stage 2.5.c decision lock,
  // without inventing a "has correction" flag that does not exist.
  applicablePhases: readonly CuttingExecutionPhase[];
  requirementClass: FieldReadinessClass;
  note: string;
}

const ALL_PHASES: readonly CuttingExecutionPhase[] = CUTTING_EXECUTION_PHASES;

// Stage 2.5.d note: both phase lists below are now FALLBACK DEFAULTS only,
// used exclusively when a step's own effective actionType is UNKNOWN/
// NOT_APPLICABLE (see resolveEffectiveActionType/isRuleApplicableForStep
// further down, which check actionType FIRST and only consult these lists
// when actionType gives no definitive verdict). They remain exactly as the
// readiness relevance audit left them -- this is what guarantees byte-
// identical behavior for any plan whose payload predates actionType
// entirely (current production V2, still missing this field).

// The four phases that involve an actual cutting/technical action, as
// opposed to CROSS_CHECK_AND_FINISH's own pure-observation default. Used
// only to scope the 5 explicitly FINAL_CHECK-exempted cutting-geometry
// fields per the Stage 2.5.c decision lock's own named list.
//
// Kept for `clientHeadPosition` (still evaluated on PREPARATION_AND_SECTIONING,
// and NOT one of the ACTION_SENSITIVE_FIELDS the actionType layer governs --
// an explicitly open question per the Stage 2.5.d audit, not resolved by
// this fix). `fingerPosition`/`toolOrientation` are ALSO listed here as
// their own fallback default (still relevant when actionType is UNKNOWN),
// but ARE part of ACTION_SENSITIVE_FIELDS -- once a step's effective
// actionType resolves to a real value, that verdict takes priority over
// this array for those two fields specifically.
const CUTTING_ACTION_PHASES: readonly CuttingExecutionPhase[] = [
  "PREPARATION_AND_SECTIONING",
  "GUIDE_AND_STRUCTURE",
  "STRUCTURAL_CUTTING",
  "REFINEMENT_TEXTURIZING",
];

// Readiness relevance audit fix -- `cuttingAngle`, `cuttingLine`, and
// `fingerAngle` describe the geometry of an actual BLADE CUTTING ACTION.
// Unlike `clientHeadPosition` above, there IS a deterministic, structural
// guarantee that excludes PREPARATION_AND_SECTIONING for these three
// specifically: FIELD_APPLICABLE_PHASES (technical-demonstration-
// derivation.ts, unmodified) never attaches a `structuralTechnique`/
// `cuttingTechnique` value to a sectioning-phase step -- the deterministic
// derivation itself proves no real cutting technique is EVER represented
// there. This remains the array's own fallback shape (still correct for
// actionType-UNKNOWN legacy data); GUIDE_AND_STRUCTURE and
// REFINEMENT_TEXTURIZING are kept in this list as the conservative
// default for the same reason as CUTTING_ACTION_PHASES above -- the
// actionType layer is what actually resolves them precisely now.
const PHASES_WITH_PROVEN_CUTTING_GEOMETRY: readonly CuttingExecutionPhase[] = [
  "GUIDE_AND_STRUCTURE",
  "STRUCTURAL_CUTTING",
  "REFINEMENT_TEXTURIZING",
];

// Technique-VALUE-conditioned relevance -- a second, orthogonal layer on
// top of the phase-level table above. Where the plan's own structured
// technique identity (already real, deterministic, closed-vocabulary data
// -- e.g. TEXTURIZING_TECHNIQUES) is specific enough to know a field is
// NOT relevant for one particular technique value, that exclusion is
// expressed here instead of broadening the phase-level rule for every
// technique that phase can ever carry. Each entry encodes ONLY an
// explicit, professionally-supplied decision (never an invented one) --
// this table is deliberately short; a technique with no entry here simply
// falls back to its field's own phase-level rule (fail-closed, unchanged).
export interface CuttingStepTechniqueRelevanceExclusion {
  field: CuttingStepOverrideFieldName;
  // Which of the plan's own technique-identity fields this exclusion keys
  // off of -- always one of the five real, closed-enum technique fields
  // (never a free-text field, never a description).
  techniqueField: "sectioning" | "guideType" | "structuralTechnique" | "cuttingTechnique" | "texturizingTechnique";
  excludedForValues: readonly string[];
  note: string;
}

export const CUTTING_STEP_TECHNIQUE_RELEVANCE_EXCLUSIONS: readonly CuttingStepTechniqueRelevanceExclusion[] = [
  {
    field: "cuttingLine",
    techniqueField: "texturizingTechnique",
    excludedForValues: ["slice_and_slide"],
    note: "Professional decision lock (readiness relevance audit): slice-and-slide does not inherently follow or create a defined geometric cutting line the way a structural cut does -- never automatically relevant for this specific technique. toolOrientation/cuttingAngle/fingerPosition/fingerAngle remain independently CONDITIONALLY_REQUIRED for this technique (professional resolves each on its own merits).",
  },
  // Every other named technique (point_cutting, razor_texturizing,
  // channel_cutting, debulking, and every STRUCTURAL_TECHNIQUES/
  // CUTTING_TECHNIQUES value) has NO explicit professional relevance
  // profile supplied yet -- deliberately absent rather than guessed. See
  // this file's own header comment / the Stage 2.5.c relevance-fix report
  // for the exact list of techniques still pending professional
  // classification.
];

function isTechniqueExcludedForStep(field: CuttingStepOverrideFieldName, payload: CuttingDemonstrationStepPayload): boolean {
  return CUTTING_STEP_TECHNIQUE_RELEVANCE_EXCLUSIONS.some((exclusion) => {
    if (exclusion.field !== field) return false;
    const techniqueEntry = payload[exclusion.techniqueField] as { value: unknown; provenance: string };
    return isProvenancePopulated(techniqueEntry) && exclusion.excludedForValues.includes(techniqueEntry.value as string);
  });
}

// ---------------------------------------------------------------------------
// Stage 2.5.d -- actionType as an AUTHORITATIVE relevance input. A real,
// populated actionType value (professionally overridden, or deterministically
// derived) settles relevance for the 5 blade-cutting-geometry fields
// DEFINITIVELY, taking priority over the phase-based fallback tables above
// -- in EITHER direction: it can newly EXCLUDE a field a phase-only rule
// would have required (e.g. GUIDE_OBSERVATION on a GUIDE_AND_STRUCTURE
// step), or newly REQUIRE one a phase-only rule would never have asked for
// at all (e.g. CORRECTIVE_CUTTING on a CROSS_CHECK_AND_FINISH step -- the
// ONE mechanism that can ever make a FINAL_CHECK step require cutting
// geometry, exactly as the original Stage 2.5.c decision lock always said
// was possible but had no way to express).
//
// Deliberately excludes `clientHeadPosition` -- the Stage 2.5.d audit left
// its own sectioning/guide/final-check relevance as an explicitly open
// question, not resolved by this fix; it continues to be governed purely
// by its own phase-level rule, unaffected by actionType.
// ---------------------------------------------------------------------------

const ACTION_SENSITIVE_FIELDS: ReadonlySet<CuttingStepOverrideFieldName> = new Set([
  "fingerPosition",
  "fingerAngle",
  "cuttingAngle",
  "cuttingLine",
  "toolOrientation",
]);

const ACTION_TYPES_REQUIRING_CUTTING_GEOMETRY: ReadonlySet<CuttingExecutionActionType> = new Set([
  "STRUCTURAL_CUTTING",
  "GUIDE_CUTTING",
  "TEXTURIZING_ACTION",
  "CORRECTIVE_CUTTING",
]);

const ACTION_TYPES_EXCLUDING_CUTTING_GEOMETRY: ReadonlySet<CuttingExecutionActionType> = new Set([
  "SECTIONING_ACTION",
  "GUIDE_OBSERVATION",
  "FINAL_OBSERVATION",
]);

function isRuleApplicableForStep(rule: FieldReadinessRule, phase: CuttingExecutionPhase, effectiveActionType: CuttingExecutionActionType | null): boolean {
  if (effectiveActionType && ACTION_SENSITIVE_FIELDS.has(rule.field)) {
    if (ACTION_TYPES_REQUIRING_CUTTING_GEOMETRY.has(effectiveActionType)) return true;
    if (ACTION_TYPES_EXCLUDING_CUTTING_GEOMETRY.has(effectiveActionType)) return false;
  }
  // No definitive actionType verdict for this field -- fall back to
  // exactly the phase-based default, unchanged.
  return rule.applicablePhases.includes(phase);
}

export const CUTTING_EXECUTION_VIDEO_READINESS_RULES: readonly FieldReadinessRule[] = [
  // --- Plan-level technique facts, code-backed REQUIRED on their own
  // single applicable phase (FIELD_APPLICABLE_PHASES, technical-
  // demonstration-derivation.ts) -- already reliably populated by
  // construction in the ordinary case; these rarely actually block. ---
  { field: "sectioning", applicablePhases: ["PREPARATION_AND_SECTIONING"], requirementClass: "REQUIRED", note: "Defines the sectioning-phase step's own content." },
  { field: "guideType", applicablePhases: ["GUIDE_AND_STRUCTURE"], requirementClass: "REQUIRED", note: "Defines the guide-phase step's own content." },
  { field: "structuralTechnique", applicablePhases: ["STRUCTURAL_CUTTING"], requirementClass: "REQUIRED", note: "Defines the structural-cutting action itself." },
  { field: "cuttingTechnique", applicablePhases: ["STRUCTURAL_CUTTING"], requirementClass: "REQUIRED", note: "Defines the structural-cutting action itself." },
  { field: "combingDirection", applicablePhases: ["STRUCTURAL_CUTTING"], requirementClass: "REQUIRED", note: "Core to the structural-cutting action." },
  { field: "overdirection", applicablePhases: ["STRUCTURAL_CUTTING"], requirementClass: "REQUIRED", note: "Core to the structural-cutting action; always resolvable once distribution exists." },
  { field: "elevation", applicablePhases: ["STRUCTURAL_CUTTING"], requirementClass: "REQUIRED", note: "The geometry of the structural cut itself (Stage 2.5.a's own release-blocker fix)." },
  { field: "texturizingTechnique", applicablePhases: ["REFINEMENT_TEXTURIZING"], requirementClass: "REQUIRED", note: "Defines the texturizing-phase step's own content." },

  // --- Genuinely step-sourced, always populated by the real engine --
  // never actually blocks in practice, kept REQUIRED for completeness. ---
  { field: "tool", applicablePhases: ALL_PHASES, requirementClass: "REQUIRED", note: "Read from the step's own record; genuinely varies per step, always populated in real production." },

  // --- STATE BEFORE -> ACTION -> STATE AFTER -- architecturally required
  // on every video-eligible phase (a video needs to know what changed
  // across the segment, regardless of what kind of step it is). ---
  { field: "stateBefore", applicablePhases: ALL_PHASES, requirementClass: "REQUIRED", note: "Without a starting state, no segment can be represented without inventing one." },
  { field: "stateAfter", applicablePhases: ALL_PHASES, requirementClass: "REQUIRED", note: "Without a resulting state, no segment can be represented without inventing one." },

  // --- FINAL_CHECK's own defining content field. ---
  { field: "crossCheck", applicablePhases: ["CROSS_CHECK_AND_FINISH"], requirementClass: "REQUIRED", note: "Stage 2.5.c decision lock: the defining content of a cross-check/final-check step." },

  // --- Professional decision lock: CONDITIONALLY_REQUIRED fields. UNKNOWN
  // blocks; the professional resolves the condition by either supplying a
  // real value or marking NOT_APPLICABLE. Evaluated on every phase where
  // the professional's own notes did not name an explicit exemption. ---
  { field: "zones", applicablePhases: ALL_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when execution genuinely occurs in a specific zone; N/A for a genuinely global action (e.g. a whole-head FINAL_CHECK)." },
  { field: "subsectioning", applicablePhases: ALL_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when the technique depends on subdivision into working subsections." },
  { field: "subsectionThickness", applicablePhases: ALL_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when subsection size materially affects control/geometry/result." },
  { field: "progression", applicablePhases: ALL_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when execution sequence/direction materially affects correct reproduction (may also apply to a systematic FINAL_CHECK inspection order)." },
  { field: "zoneConnection", applicablePhases: ALL_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only for a step whose action IS a zone-connection/blend or a zone-connection check." },
  { field: "styling", applicablePhases: ALL_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when the result cannot be correctly represented/evaluated without defining the finishing state. 'Natural fall / no additional styling' is a valid, explicit REAL VALUE here, never NOT_APPLICABLE -- it is itself a styling decision." },
  { field: "observationView", applicablePhases: ALL_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required whenever a defined visual viewpoint matters -- particularly (not exclusively) FINAL_CHECK comparison-type checks." },

  // --- Client head position -- relevant to an actual execution action,
  // not to a pure observation/check (excluded from FINAL_CHECK's own
  // applicable phases below, mirroring the same reasoning the decision
  // lock applied to the 5 cutting-geometry fields). ---
  { field: "clientHeadPosition", applicablePhases: CUTTING_ACTION_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when head position materially affects execution geometry or safety; not evaluated on FINAL_CHECK (a pure check performs no execution action)." },

  // --- The 5 cutting-geometry fields the decision lock explicitly
  // exempts from FINAL_CHECK by default: "A pure observation/check step
  // must not fail readiness because cutting-specific fields are N/A."
  // Evaluated on the four cutting-action phases only -- never even asked
  // about on CROSS_CHECK_AND_FINISH. A professional may still supply real
  // values there (e.g. a genuine corrective cut inside a check step) --
  // doing so is simply never REQUIRED. ---
  { field: "fingerPosition", applicablePhases: CUTTING_ACTION_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when finger position materially affects line/tension/geometry. Never evaluated on FINAL_CHECK by default (decision lock). Still evaluated on PREPARATION_AND_SECTIONING -- no deterministic signal excludes it there yet (fail-closed)." },
  // Readiness relevance audit fix -- fingerAngle/cuttingAngle/cuttingLine
  // describe blade-cutting geometry, which the deterministic derivation
  // proves is never attached to a sectioning-phase step (see
  // PHASES_WITH_PROVEN_CUTTING_GEOMETRY's own header comment). Excluded
  // from PREPARATION_AND_SECTIONING; unchanged everywhere else.
  { field: "fingerAngle", applicablePhases: PHASES_WITH_PROVEN_CUTTING_GEOMETRY, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when finger angle materially affects geometry/length distribution/cutting line. Never evaluated on FINAL_CHECK or PREPARATION_AND_SECTIONING (decision lock; no cutting technique is ever attached to a sectioning step)." },
  { field: "cuttingAngle", applicablePhases: PHASES_WITH_PROVEN_CUTTING_GEOMETRY, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when the cutting action's own angle materially affects the result. Never auto-derived from elevation/fingerAngle (decision lock: no deterministic domain rule for that exists). Never evaluated on FINAL_CHECK or PREPARATION_AND_SECTIONING." },
  // Also technique-conditioned: see CUTTING_STEP_TECHNIQUE_RELEVANCE_EXCLUSIONS
  // (slice_and_slide texturizing does not automatically require this field).
  { field: "cuttingLine", applicablePhases: PHASES_WITH_PROVEN_CUTTING_GEOMETRY, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when the cutting line determines the intended technical geometry. Never evaluated on FINAL_CHECK or PREPARATION_AND_SECTIONING; also excluded for the slice_and_slide texturizing technique specifically (see CUTTING_STEP_TECHNIQUE_RELEVANCE_EXCLUSIONS)." },
  { field: "toolOrientation", applicablePhases: CUTTING_ACTION_PHASES, requirementClass: "CONDITIONALLY_REQUIRED", note: "Required only when tool orientation is necessary for correct/safe reproduction. Never evaluated on FINAL_CHECK by default (decision lock). Still evaluated on PREPARATION_AND_SECTIONING -- no deterministic signal excludes it there yet (fail-closed)." },

  // NOTE: `headBodyPositioning` (deprecated) and `phase`/`constraints`
  // (not provenance-wrapped / structural) are DELIBERATELY absent from
  // this table -- they are never evaluated for readiness at all.
];

const RULES_BY_FIELD: ReadonlyMap<CuttingStepOverrideFieldName, FieldReadinessRule> = new Map(
  CUTTING_EXECUTION_VIDEO_READINESS_RULES.map((rule) => [rule.field, rule]),
);

export function resolveFieldReadinessRule(field: CuttingStepOverrideFieldName): FieldReadinessRule | undefined {
  return RULES_BY_FIELD.get(field);
}

// ---------------------------------------------------------------------------
// Blocking reasons -- mirrors BillingCheckoutConfigIssue's own proven
// {code, locator, message} shape (billing-checkout-config.ts) -- an
// aggregate list, never a single short-circuited reason, so a step (or
// plan) can report every real gap at once.
// ---------------------------------------------------------------------------

export type ReadinessBlockingReasonCode =
  | "READINESS_PLAN_NOT_CONFIRMED"
  | "READINESS_UNKNOWN_PHASE"
  | "READINESS_MISSING_REQUIRED_FIELD"
  | "READINESS_MISSING_CONDITIONALLY_REQUIRED_FIELD";

export interface ReadinessBlockingReason {
  code: ReadinessBlockingReasonCode;
  // null for a plan-level reason (e.g. not CONFIRMED) that is not tied to
  // any one step.
  stepNumber: number | null;
  field: CuttingStepOverrideFieldName | null;
  message: string;
}

export interface StepReadinessResult {
  stepNumber: number;
  phase: CuttingExecutionPhase | null;
  ready: boolean;
  reasons: ReadinessBlockingReason[];
}

export interface PlanReadinessResult {
  planId: string;
  planVersion: number;
  status: string;
  ready: boolean;
  planLevelReasons: ReadinessBlockingReason[];
  steps: StepReadinessResult[];
}

function fieldLabelForMessage(field: CuttingStepOverrideFieldName): string {
  // A small, fixed, human-readable label -- deliberately NOT importing the
  // UI's own CUTTING_STEP_FIELD_DESCRIPTORS (a route-colocated file this
  // src/lib module must never depend on); this is a minimal, independent
  // mapping for safe API/log messages only. The UI is free to render its
  // own richer label using the same `field` key.
  const labels: Record<CuttingStepOverrideFieldName, string> = {
    zones: "Zone(s)",
    elevation: "Elevation",
    tool: "Tool",
    actionType: "Execution action",
    sectioning: "Sectioning",
    guideType: "Guide",
    structuralTechnique: "Structural technique",
    cuttingTechnique: "Cutting technique",
    texturizingTechnique: "Texturizing technique",
    combingDirection: "Combing direction",
    overdirection: "Overdirection",
    headBodyPositioning: "Head/body positioning (deprecated)",
    clientHeadPosition: "Client head position",
    observationView: "Observation viewpoint",
    fingerPosition: "Finger position",
    fingerAngle: "Finger angle",
    cuttingAngle: "Cutting angle",
    cuttingLine: "Cutting line",
    subsectioning: "Subsectioning",
    subsectionThickness: "Subsection thickness",
    toolOrientation: "Tool orientation",
    progression: "Progression",
    zoneConnection: "Zone connection",
    crossCheck: "Cross-check",
    styling: "Styling / finish",
    stateBefore: "State before",
    stateAfter: "State after",
  };
  return labels[field];
}

// ---------------------------------------------------------------------------
// Step readiness
// ---------------------------------------------------------------------------

// Evaluates ONE step's own readiness. `step.payload` is expected to already
// be the EFFECTIVE payload (baseline + professional overrides resolved via
// resolveEffectiveCuttingStepPayload/resolveEffectiveCuttingStepsForRecord)
// -- this function never re-derives that merge itself, mirroring every
// other "effective view" consumer in this codebase.
export function evaluateStepReadiness(step: TechnicalDemonstrationStepRecord): StepReadinessResult {
  const payload = step.payload as unknown as CuttingDemonstrationStepPayload;
  const phaseEntry = payload.phase;
  const phase: CuttingExecutionPhase | null = isProvenancePopulated(phaseEntry) ? (phaseEntry.value as CuttingExecutionPhase) : null;

  if (phase === null) {
    return {
      stepNumber: step.stepNumber,
      phase: null,
      ready: false,
      reasons: [
        {
          code: "READINESS_UNKNOWN_PHASE",
          stepNumber: step.stepNumber,
          field: null,
          message: `Step ${step.stepNumber}'s own execution phase could not be determined -- no readiness rule can be honestly applied.`,
        },
      ],
    };
  }

  const effectiveActionType = resolveEffectiveActionType(payload.actionType, phase);
  const reasons: ReadinessBlockingReason[] = [];

  for (const rule of CUTTING_EXECUTION_VIDEO_READINESS_RULES) {
    if (!isRuleApplicableForStep(rule, phase, effectiveActionType)) continue; // not applicable for this step -- implicitly OPTIONAL here
    if (isTechniqueExcludedForStep(rule.field, payload)) continue; // this step's own technique identity says the field is not relevant here

    const entry = payload[rule.field] as { value: unknown; provenance: string } | undefined;
    if (isProvenancePopulated(entry) || isProvenanceNotApplicable(entry)) continue; // satisfied

    reasons.push({
      code: rule.requirementClass === "REQUIRED" ? "READINESS_MISSING_REQUIRED_FIELD" : "READINESS_MISSING_CONDITIONALLY_REQUIRED_FIELD",
      stepNumber: step.stepNumber,
      field: rule.field,
      message: `Step ${step.stepNumber} is missing ${fieldLabelForMessage(rule.field)}.`,
    });
  }

  return { stepNumber: step.stepNumber, phase, ready: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Plan readiness
// ---------------------------------------------------------------------------

// Only a CONFIRMED plan can ever be VIDEO_READY (Stage 2.5.c core semantic
// lock, unconditional -- DRAFT is always NOT VIDEO_READY, no exception).
// `effectiveSteps` must already be the resolved effective view (same
// contract as evaluateStepReadiness above). A plan is ready only when
// EVERY one of its steps is ready -- there is no existing mechanism to mark
// a step "intentionally excluded from video" (the Stage 2.5.c task itself
// forbids inventing one), so no step is ever silently skipped.
export function evaluatePlanReadiness(
  plan: Pick<TechnicalDemonstrationPlanRecord, "id" | "planVersion" | "status">,
  effectiveSteps: TechnicalDemonstrationStepRecord[],
): PlanReadinessResult {
  const planLevelReasons: ReadinessBlockingReason[] = [];

  if (plan.status !== "CONFIRMED") {
    planLevelReasons.push({
      code: "READINESS_PLAN_NOT_CONFIRMED",
      stepNumber: null,
      field: null,
      message: "Only a CONFIRMED Technical Demonstration Plan can ever be ready for Technical Execution Video.",
    });
  }

  const steps = effectiveSteps.map(evaluateStepReadiness);
  const ready = planLevelReasons.length === 0 && steps.every((s) => s.ready);

  return {
    planId: plan.id,
    planVersion: plan.planVersion,
    status: plan.status,
    ready,
    planLevelReasons,
    steps,
  };
}
