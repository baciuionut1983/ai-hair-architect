import {
  CUTTING_TECHNIQUES,
  ELEVATION_OPTIONS,
  GUIDELINE_OPTIONS,
  isOneOf,
  SECTIONING_OPTIONS,
  STRUCTURAL_TECHNIQUES,
  TEXTURIZING_TECHNIQUES,
} from "@/lib/proposal-validators";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { isTechnicalDemonstrationVertical, type TechnicalDemonstrationVertical } from "@/lib/technical-demonstration-contracts";
import { isCuttingExecutionActionType, type CuttingExecutionActionType } from "@/lib/technical-demonstration-cutting-contracts";
import {
  FIELD_VALUE_VALIDATORS,
  isCuttingStepOverrideFieldName,
  type CuttingStepOverrideFieldName,
} from "@/lib/technical-demonstration-cutting-overrides";

// Technical Demonstration, Stage 2.5.h.2b -- PROFESSIONAL TECHNIQUE
// EXECUTION PROFILE, contract/foundation only. Types + pure validators, no
// I/O, no database, no provider call, no AI -- mirrors this codebase's own
// established "Stage 1" convention (technical-demonstration-cutting-
// contracts.ts) exactly: a shared vocabulary + runtime guards, nothing more.
//
// WHAT THIS FILE IS: the language/container a FUTURE stage can use to
// author and review real professional execution knowledge in. It answers
// "how would a reviewed technique fact be represented, versioned, and
// proven eligible to ever influence readiness" -- it does NOT answer any
// real haircut question itself.
//
// WHAT THIS FILE IS NOT (Stage 2.5.h.2b's own explicit boundary):
//   - it contains ZERO real professional execution rules -- every example
//     anywhere near this concept (tests only) uses synthetic, clearly-
//     labeled non-production values, never a real technique fact;
//   - it is NOT wired into resolveEffectiveCuttingStepsForRecord,
//     evaluatePlanReadiness, or evaluatePlanCoherence -- a profile existing
//     has ZERO effect on any of those today;
//   - it is NOT persisted -- no Prisma model, no migration; a future stage
//     may add persistence if genuinely needed, not assumed here;
//   - it is NOT a replacement for Technical Visual Map, Spatial Map,
//     AnalysisProposal, or the Technical Demonstration Plan itself -- all
//     of those stay exactly as they are, completely unaware this file
//     exists.
//
// FUTURE FLOW (not built here): approved structured technique intent +
// applicable versioned, ACTIVE, professionally-reviewed
// ProfessionalTechniqueExecutionProfile + approved client-specific
// evidence + professional overrides = effective structured technical
// execution state. Every "+" in that sentence is a SEPARATE future stage's
// own job.

// ---------------------------------------------------------------------------
// Field-rule semantic -- the six-value vocabulary Stage 2.5.h.2b's own
// task explicitly names. A CLOSED enum, exactly like every other closed
// vocabulary in this domain (TechnicalDemonstrationValueProvenance,
// CuttingExecutionActionType, ...) -- never an open string.
// ---------------------------------------------------------------------------

export const EXECUTION_FIELD_SEMANTICS = [
  "REQUIRED_FIXED",
  "REQUIRED_CONDITIONAL",
  "PROFESSIONAL_CHOICE",
  "NOT_APPLICABLE",
  "CLIENT_DERIVED",
  "UNDEFINED",
] as const;
export type ExecutionFieldSemantic = (typeof EXECUTION_FIELD_SEMANTICS)[number];

export function isExecutionFieldSemantic(value: unknown): value is ExecutionFieldSemantic {
  return typeof value === "string" && (EXECUTION_FIELD_SEMANTICS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Condition model -- a small, closed, DATA-ONLY tree (never a callback,
// never a free-form expression string, never anything eval'd). Every
// condition is plain JSON: inspectable, testable, and serializable exactly
// as-is into a future versioned rule row. `fact` is deliberately a small,
// closed vocabulary of ALREADY-STRUCTURED concepts this domain already
// knows how to resolve (or, for `approvedClientEvidence`, explicitly names
// a concept this stage does NOT yet know how to resolve -- present so a
// future stage has a real vocabulary slot to extend, never silently
// invented at that later point). Deliberately NOT required to be a 1:1
// mirror of CuttingStepOverrideFieldName -- a condition may reference a
// plan-level fact (e.g. `distribution`) that is never itself a per-step
// override field.
// ---------------------------------------------------------------------------

export const EXECUTION_RULE_CONDITION_FACTS = [
  "actionType",
  "phase",
  "structuralTechnique",
  "cuttingTechnique",
  "texturizingTechnique",
  "sectioning",
  "guideType",
  "elevation",
  "distribution",
  "overdirection",
  // No mapping from the free-text `tool` field to a closed category
  // vocabulary exists anywhere in this codebase today (Stage 2.5.h.2 audit
  // finding) -- named here as a real future vocabulary slot, never
  // resolved by this stage.
  "toolCategory",
  // Explicitly names the concept without resolving it -- no approved
  // client evidence source is wired to anything in this stage.
  "approvedClientEvidence",
] as const;
export type ExecutionRuleConditionFact = (typeof EXECUTION_RULE_CONDITION_FACTS)[number];

function isExecutionRuleConditionFact(value: unknown): value is ExecutionRuleConditionFact {
  return typeof value === "string" && (EXECUTION_RULE_CONDITION_FACTS as readonly string[]).includes(value);
}

function isConditionLiteral(value: unknown): value is string | boolean {
  return typeof value === "string" || typeof value === "boolean";
}

export interface ExecutionRuleConditionEquals {
  op: "equals";
  fact: ExecutionRuleConditionFact;
  value: string | boolean;
}
export interface ExecutionRuleConditionIn {
  op: "in";
  fact: ExecutionRuleConditionFact;
  values: readonly (string | boolean)[];
}
export interface ExecutionRuleConditionAnd {
  op: "and";
  conditions: readonly ExecutionRuleCondition[];
}
export interface ExecutionRuleConditionOr {
  op: "or";
  conditions: readonly ExecutionRuleCondition[];
}
export interface ExecutionRuleConditionNot {
  op: "not";
  condition: ExecutionRuleCondition;
}
export type ExecutionRuleCondition =
  | ExecutionRuleConditionEquals
  | ExecutionRuleConditionIn
  | ExecutionRuleConditionAnd
  | ExecutionRuleConditionOr
  | ExecutionRuleConditionNot;

// The ONE runtime guard for the whole condition tree -- recursive, closed:
// any `op` outside this exact five-member set (including, deliberately, no
// "javascript"/"eval"/"expression" op ever existing) is rejected, not
// silently ignored.
export function isValidExecutionRuleCondition(value: unknown): value is ExecutionRuleCondition {
  if (!isRecord(value)) return false;
  switch (value.op) {
    case "equals":
      return isExecutionRuleConditionFact(value.fact) && isConditionLiteral(value.value);
    case "in":
      return isExecutionRuleConditionFact(value.fact) && Array.isArray(value.values) && value.values.length > 0 && value.values.every(isConditionLiteral);
    case "and":
    case "or":
      return Array.isArray(value.conditions) && value.conditions.length > 0 && value.conditions.every(isValidExecutionRuleCondition);
    case "not":
      return isValidExecutionRuleCondition(value.condition);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Field rule -- one execution field's own semantic, within one profile.
// `field` reuses CuttingStepOverrideFieldName VERBATIM (the existing
// Technical Demonstration execution field universe) -- never a second,
// competing field-name vocabulary. Exactly one of fixedValue/allowedOptions/
// condition may ever be present, gated strictly by `semantic` (enforced by
// isValidExecutionFieldRule below, never left to convention).
// ---------------------------------------------------------------------------

export interface ExecutionFieldRule {
  ruleId: string;
  field: CuttingStepOverrideFieldName;
  semantic: ExecutionFieldSemantic;
  // REQUIRED_FIXED only -- a single structured value, validated against
  // this field's own existing FIELD_VALUE_VALIDATORS entry (technical-
  // demonstration-cutting-overrides.ts) -- never a second, competing
  // definition of "what is a valid elevation".
  fixedValue?: unknown;
  // PROFESSIONAL_CHOICE only -- a non-empty closed set of structured
  // options, each individually validated the same way. Absent means "any
  // value valid for this field", which this stage deliberately never
  // allows for PROFESSIONAL_CHOICE (see isValidExecutionFieldRule) -- a
  // reviewed profile must always narrow the real choice set, never punt.
  allowedOptions?: readonly unknown[];
  // REQUIRED_CONDITIONAL only -- a deterministic, typed condition (never a
  // callback/expression string).
  condition?: ExecutionRuleCondition;
  // Mandatory for every rule regardless of semantic -- a human-authored
  // reason a future reviewer (and this stage's own tests) can read; never
  // inferred, never optional-in-practice.
  rationale: string;
  // Optional citation of where this fact came from (e.g. "professional
  // interview 2026-09-10") -- never a substitute for `rationale`.
  sourceReference?: string;
}

export function isValidExecutionFieldRule(value: unknown): value is ExecutionFieldRule {
  if (!isRecord(value)) return false;
  if (typeof value.ruleId !== "string" || value.ruleId.length === 0) return false;
  if (!isCuttingStepOverrideFieldName(value.field)) return false;
  if (!isExecutionFieldSemantic(value.semantic)) return false;
  if (typeof value.rationale !== "string" || value.rationale.trim().length === 0) return false;
  if (value.sourceReference !== undefined && typeof value.sourceReference !== "string") return false;

  const field = value.field;
  const hasFixedValue = "fixedValue" in value && value.fixedValue !== undefined;
  const hasAllowedOptions = "allowedOptions" in value && value.allowedOptions !== undefined;
  const hasCondition = "condition" in value && value.condition !== undefined;

  switch (value.semantic) {
    case "REQUIRED_FIXED":
      if (hasAllowedOptions || hasCondition) return false;
      return hasFixedValue && FIELD_VALUE_VALIDATORS[field](value.fixedValue);
    case "PROFESSIONAL_CHOICE": {
      if (hasFixedValue || hasCondition) return false;
      if (!hasAllowedOptions || !Array.isArray(value.allowedOptions) || value.allowedOptions.length === 0) return false;
      return value.allowedOptions.every((option) => FIELD_VALUE_VALIDATORS[field](option));
    }
    case "REQUIRED_CONDITIONAL":
      if (hasFixedValue || hasAllowedOptions) return false;
      return hasCondition && isValidExecutionRuleCondition(value.condition);
    case "NOT_APPLICABLE":
    case "UNDEFINED":
    case "CLIENT_DERIVED":
      // Deliberately bare -- CLIENT_DERIVED in particular must never carry
      // a value here (Stage 2.5.h.2b's own explicit "does not fabricate a
      // client value" requirement): it only ever marks a field as sourced
      // from approved client evidence a LATER stage resolves, never a
      // value this contract invents itself.
      return !hasFixedValue && !hasAllowedOptions && !hasCondition;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Profile identity -- the smallest composable key, deliberately NOT a
// Cartesian product of all seven technique dimensions the Stage 2.5.h.2
// audit listed. Scoped PER actionType: each actionType carries exactly the
// ONE technique-selector SHAPE that technical-demonstration-derivation.ts's
// own FIELD_APPLICABLE_PHASES table already proves is genuinely relevant to
// it -- SECTIONING_ACTION only ever needs `sectioning`; GUIDE_CUTTING/
// GUIDE_OBSERVATION only ever need `guideType`; STRUCTURAL_CUTTING/
// CORRECTIVE_CUTTING need the three fields that phase's own cutting
// geometry actually depends on (structuralTechnique, cuttingTechnique,
// elevation); TEXTURIZING_ACTION only ever needs `texturizingTechnique`;
// FINAL_OBSERVATION needs NO technique selector at all -- its own meaning
// is already fully fixed and closed (CuttingExecutionActionType's own
// header comment). This is what keeps identity small: a future profile
// author never has to supply (or reason about) all seven dimensions at
// once, only the 0-3 that actually apply to the one actionType they are
// authoring for.
// ---------------------------------------------------------------------------

export type ExecutionTechniqueSelector =
  | { kind: "sectioning"; sectioning: string }
  | { kind: "guide"; guideType: string }
  | { kind: "structural_cutting"; structuralTechnique: string; cuttingTechnique: string; elevation: string }
  | { kind: "texturizing"; texturizingTechnique: string };

const REQUIRED_SELECTOR_KIND_BY_ACTION_TYPE: Readonly<Partial<Record<CuttingExecutionActionType, ExecutionTechniqueSelector["kind"]>>> = {
  SECTIONING_ACTION: "sectioning",
  GUIDE_CUTTING: "guide",
  GUIDE_OBSERVATION: "guide",
  STRUCTURAL_CUTTING: "structural_cutting",
  CORRECTIVE_CUTTING: "structural_cutting",
  TEXTURIZING_ACTION: "texturizing",
  // FINAL_OBSERVATION deliberately absent -- no selector at all is valid
  // for it (see isValidExecutionProfileKey below).
};

function isValidExecutionTechniqueSelector(selector: ExecutionTechniqueSelector): boolean {
  switch (selector.kind) {
    case "sectioning":
      return isOneOf(selector.sectioning, SECTIONING_OPTIONS);
    case "guide":
      return isOneOf(selector.guideType, GUIDELINE_OPTIONS);
    case "structural_cutting":
      return isOneOf(selector.structuralTechnique, STRUCTURAL_TECHNIQUES) && isOneOf(selector.cuttingTechnique, CUTTING_TECHNIQUES) && isOneOf(selector.elevation, ELEVATION_OPTIONS);
    case "texturizing":
      return isOneOf(selector.texturizingTechnique, TEXTURIZING_TECHNIQUES);
    default:
      return false;
  }
}

export interface ExecutionProfileKey {
  vertical: TechnicalDemonstrationVertical;
  actionType: CuttingExecutionActionType;
  techniqueSelector?: ExecutionTechniqueSelector;
}

export function isValidExecutionProfileKey(value: unknown): value is ExecutionProfileKey {
  if (!isRecord(value)) return false;
  if (!isTechnicalDemonstrationVertical(value.vertical)) return false;
  if (!isCuttingExecutionActionType(value.actionType)) return false;

  const requiredKind = REQUIRED_SELECTOR_KIND_BY_ACTION_TYPE[value.actionType];
  if (!requiredKind) {
    // FINAL_OBSERVATION (or any future actionType with no entry here): a
    // technique selector would be meaningless -- reject one if supplied,
    // never silently ignore it.
    return value.techniqueSelector === undefined;
  }
  if (!isRecord(value.techniqueSelector) || value.techniqueSelector.kind !== requiredKind) return false;
  return isValidExecutionTechniqueSelector(value.techniqueSelector as ExecutionTechniqueSelector);
}

// ---------------------------------------------------------------------------
// Lifecycle / authority -- DRAFT|ACTIVE|RETIRED status, and a governance
// model that structurally prevents unreviewed content from ever counting
// as domain authority merely by existing.
// ---------------------------------------------------------------------------

export const EXECUTION_PROFILE_STATUSES = ["DRAFT", "ACTIVE", "RETIRED"] as const;
export type ExecutionProfileStatus = (typeof EXECUTION_PROFILE_STATUSES)[number];

// PROFESSIONALLY_AUTHORED -- written directly by a reviewed professional
//   process (this engagement's own audit -> authorize -> implement -> test
//   -> release gate, exactly like every other domain rule in this repo).
// PROFESSIONALLY_REVIEWED -- originated elsewhere (e.g. promoted from a
//   ProfessionalMemory entry) but has since passed the SAME human review.
// MACHINE_DRAFTED -- AI-assisted or otherwise generated, NOT yet reviewed.
//   Can exist (as DRAFT status only -- see isValidProfessionalTechnique
//   ExecutionProfile) so a future "AI draft -> professional review ->
//   explicit activation" workflow has somewhere honest to start, but can
//   NEVER be ACTIVE, and is never eligible authority (see
//   isExecutionProfileEligibleForAuthority).
export const EXECUTION_PROFILE_AUTHORITY_TYPES = ["PROFESSIONALLY_AUTHORED", "PROFESSIONALLY_REVIEWED", "MACHINE_DRAFTED"] as const;
export type ExecutionProfileAuthorityType = (typeof EXECUTION_PROFILE_AUTHORITY_TYPES)[number];

export interface ProfessionalTechniqueExecutionProfile {
  // Stable across versions -- identifies "this technique execution
  // profile", not "this exact revision". Human-assigned, never derived
  // automatically from `key` (two competing candidate profiles could
  // legitimately share the same key while under review).
  profileId: string;
  // Starts at 1, a distinct integer per revision. A profile object is a
  // frozen SNAPSHOT of one version -- there is no "update in place" API
  // anywhere in this file; a new version is always a new, separate object
  // with an incremented `version`, exactly like every other version
  // constant in this codebase (TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_
  // VERSION, CUTTING_DEMONSTRATION_STEP_SCHEMA_VERSION, ...).
  version: number;
  key: ExecutionProfileKey;
  status: ExecutionProfileStatus;
  authorityType: ExecutionProfileAuthorityType;
  // Present only once professionally reviewed (PROFESSIONALLY_REVIEWED).
  reviewedByUserId?: string;
  reviewedAt?: string;
  // Top-level, human-authored justification for this profile's existence
  // as a whole -- distinct from each individual field rule's own
  // `rationale`.
  rationale: string;
  fieldRules: readonly ExecutionFieldRule[];
  createdAt: string;
}

// Two rules within the SAME profile targeting the SAME field is an
// unresolvable ambiguity -- which one applies? -- and must be detected
// deterministically, never silently resolved by array order or "last one
// wins" (that convention belongs to professionalOverrides, an entirely
// different, append-only, chronological mechanism -- a reviewed profile is
// a single frozen snapshot, not a log).
export function findConflictingExecutionFieldRules(fieldRules: readonly ExecutionFieldRule[]): readonly CuttingStepOverrideFieldName[] {
  const counts = new Map<CuttingStepOverrideFieldName, number>();
  for (const rule of fieldRules) {
    counts.set(rule.field, (counts.get(rule.field) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([field]) => field);
}

export function isValidProfessionalTechniqueExecutionProfile(value: unknown): value is ProfessionalTechniqueExecutionProfile {
  if (!isRecord(value)) return false;
  if (typeof value.profileId !== "string" || value.profileId.length === 0) return false;
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) return false;
  if (!isValidExecutionProfileKey(value.key)) return false;
  if (!(EXECUTION_PROFILE_STATUSES as readonly string[]).includes(value.status as string)) return false;
  if (!(EXECUTION_PROFILE_AUTHORITY_TYPES as readonly string[]).includes(value.authorityType as string)) return false;
  // A MACHINE_DRAFTED profile can exist only as DRAFT -- it must never be
  // possible to construct a valid ACTIVE-and-unreviewed profile.
  if (value.status === "ACTIVE" && value.authorityType === "MACHINE_DRAFTED") return false;
  if (value.authorityType === "PROFESSIONALLY_REVIEWED") {
    if (typeof value.reviewedByUserId !== "string" || value.reviewedByUserId.length === 0) return false;
    if (typeof value.reviewedAt !== "string" || value.reviewedAt.length === 0) return false;
  }
  if (typeof value.rationale !== "string" || value.rationale.trim().length === 0) return false;
  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) return false;
  if (!Array.isArray(value.fieldRules) || value.fieldRules.length === 0) return false;
  if (!value.fieldRules.every(isValidExecutionFieldRule)) return false;
  if (findConflictingExecutionFieldRules(value.fieldRules as ExecutionFieldRule[]).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Authority eligibility -- the ONE, single, central predicate any FUTURE
// integration (readiness, effective-state resolution, VIDEO_READY) must
// call to decide "may this profile ever influence anything". Not called
// from anywhere in production yet (Stage 2.5.h.2b has zero readiness
// integration) -- exists now so eligibility is decided once, here, rather
// than re-derived ad hoc at a future second call site.
// ---------------------------------------------------------------------------

export function isExecutionProfileEligibleForAuthority(profile: ProfessionalTechniqueExecutionProfile): boolean {
  if (profile.status !== "ACTIVE") return false;
  if (profile.authorityType === "MACHINE_DRAFTED") return false;
  return true;
}
