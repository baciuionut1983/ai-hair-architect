import { isRecord } from "@/lib/technical-visual-map-validators";
import { isSkillEligibleForAuthority, isValidSkillCondition, type SkillCondition, type SkillDefinition } from "@/lib/professional-skill-contracts";
import type { SkillInstance } from "@/lib/professional-skill-instance-contracts";

// AI Hair Architect, Stage 2.5.i.3 -- EXECUTION UNIT, contract/foundation
// only. Types + pure validators, no I/O, no database, no provider call, no
// AI -- mirrors Stage 2.5.i.1's own established "Stage 1" convention
// (professional-skill-contracts.ts) exactly: a shared vocabulary + runtime
// guards, nothing more.
//
// ARCHITECTURAL LOCK (Stage 2.5.i.2 audit): an Execution Unit is a
// context-bound portion of a Professional Skill Instance during which the
// relevant professional execution facts remain stable. It is the layer
// that resolves the Stage 2.5.i.2-confirmed scalar-field conflict (a
// Technical Demonstration step today holds exactly ONE value per technical
// field, even when real execution legitimately varies within one step by
// anatomical zone, side, sub-phase, condition branch, anatomical
// threshold, tool/control-method transition, client-position transition,
// or handedness-conditioned ergonomics). This file sits BETWEEN a Skill
// Instance (not yet built -- no Composition Engine exists) and a compiled
// Atomic Action (deliberately NOT built here -- Stage 2.5.i.2's own B
// decision: "compiled-only, never persisted independently").
//
// DELIBERATELY NOT IMPORTING technical-demonstration-execution-profile-
// contracts.ts's own ExecutionFieldSemantic/EXECUTION_FIELD_SEMANTICS,
// despite it being a structurally identical, vertical-agnostic six-value
// enum: this file reproduces that same semantic vocabulary independently
// (EXECUTION_UNIT_PARAMETER_SEMANTICS below), mirroring professional-
// skill-contracts.ts's own exact precedent and stated reasoning ("this
// codebase's own established convention already tolerates small,
// independently-named, structurally-similar lifecycle enums per entity
// type... rather than forcing every governed entity through one shared
// type"). Naming a parameter-rule semantic after a Technical-
// Demonstration-specific file would be a layering inversion, not a reuse
// win -- this file's own naming family (professional-skill-*) sits one
// level more generic than technical-demonstration-execution-profile-
// contracts.ts.
//
// DOES import professional-skill-contracts.ts's SkillCondition<TFact> and
// isValidSkillCondition DIRECTLY (not reproduced a third time): unlike the
// case above, that type is ALREADY the generic, vertical-agnostic
// condition language one layer up from ExecutionRuleCondition --
// reproducing it again here would be exactly the "parallel rule language"
// this stage's own task explicitly forbids "unless strictly necessary".
// Also imports isSkillEligibleForAuthority directly: an Execution Unit
// never carries its own independent authority; it inherits eligibility
// from the SkillDefinition its own source Skill Instance names (see
// isExecutionUnitEligibleForAuthority below).
//
// STAGE 2.5.i.6a -- EXECUTION UNIT -> SKILL INSTANCE TRACEABILITY. Imports
// SkillInstance (type-only) to type isExecutionUnitConsistentWithSource
// SkillInstance's own parameters -- a new, intentional, non-circular
// dependency edge (professional-skill-instance-contracts.ts imports
// nothing from this file). `sourceSkillInstanceId` REPLACES this file's
// own original `sourceSkillId`/`sourceSkillVersion` fields (both existed
// only because Stage 2.5.i.3 predated Skill Instance, Stage 2.5.i.5, by
// two stages) -- keeping all three would be exactly the "redundant
// authority fields" duplication this stage's own task explicitly forbids:
// a Skill Instance already carries its own sourceSkillId/sourceSkillVersion
// (professional-skill-instance-contracts.ts), so an Execution Unit needs
// only ONE pointer (to the Instance) for the full chain (Skill Definition
// -> Skill Instance -> Execution Unit) to be reconstructible, never two
// independent, potentially-drifting sources of the same fact.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.3's own explicit boundary):
//   - it contains ZERO real professional execution rules -- every example
//     anywhere near this concept, in tests only, is explicitly labeled
//     "SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY";
//   - it is NOT wired into any Composition Engine, Skill Instance,
//     Technical Demonstration Plan, readiness, coherence, derivation, or
//     the generator -- an Execution Unit existing has ZERO effect on any
//     of those today;
//   - it does NOT implement Atomic Action. An Atomic Action is a later,
//     compiled-only concept (Stage 2.5.i.2's own B decision) that reads an
//     Execution Unit's stable context at render time; this file never
//     embeds one, and no field anywhere in this file's validated shape is
//     named, recognized, or given any special meaning as "atomic actions";
//   - it is NOT persisted -- no Prisma model, no migration. Stage 2.5.i.2's
//     own D decision (persist Composition/Skill Instance/Execution Unit;
//     compile Atomic Action/VideoInstruction) describes a FUTURE
//     persistence shape this contract is merely structured to fit, not
//     something this stage builds;
//   - it does NOT hardcode a single vertical -- `vertical` is a plain
//     string (mirrors SkillDefinition.vertical exactly). `zoneId`/
//     `subPhase` are open, vertical-supplied identifiers this contract
//     never interprets; `laterality` is the one genuinely cross-vertical
//     closed scope vocabulary this stage adds. Any vertical-specific
//     execution context beyond that lives in `verticalPayload`, an
//     uninterpreted `Record<string, unknown>` narrowed only by the calling
//     vertical's own validator -- mirrors TechnicalDemonstrationStepRecord.
//     payload's own established "unknown here, narrowed by the matching
//     vertical's own validator" precedent exactly.

// ---------------------------------------------------------------------------
// Laterality -- the ONE genuinely cross-vertical closed scope vocabulary
// this stage adds (handedness-conditioned ergonomics and mirrored/bilateral
// technique sides are not a cutting-only concept). Small and closed, like
// every other vocabulary in this domain.
// ---------------------------------------------------------------------------

export const EXECUTION_UNIT_LATERALITY_VALUES = ["LEFT", "RIGHT", "BILATERAL", "NOT_APPLICABLE"] as const;
export type ExecutionUnitLaterality = (typeof EXECUTION_UNIT_LATERALITY_VALUES)[number];

export function isExecutionUnitLaterality(value: unknown): value is ExecutionUnitLaterality {
  return typeof value === "string" && (EXECUTION_UNIT_LATERALITY_VALUES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Parameter-rule semantic -- see file header for why this is independently
// declared rather than importing technical-demonstration-execution-
// profile-contracts.ts's own ExecutionFieldSemantic.
// ---------------------------------------------------------------------------

export const EXECUTION_UNIT_PARAMETER_SEMANTICS = [
  "REQUIRED_FIXED",
  "REQUIRED_CONDITIONAL",
  "PROFESSIONAL_CHOICE",
  "NOT_APPLICABLE",
  "CLIENT_DERIVED",
  "UNDEFINED",
] as const;
export type ExecutionUnitParameterSemantic = (typeof EXECUTION_UNIT_PARAMETER_SEMANTICS)[number];

export function isExecutionUnitParameterSemantic(value: unknown): value is ExecutionUnitParameterSemantic {
  return typeof value === "string" && (EXECUTION_UNIT_PARAMETER_SEMANTICS as readonly string[]).includes(value);
}

function isParameterLiteral(value: unknown): value is string | boolean | number {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

// ---------------------------------------------------------------------------
// Parameter rule -- one Execution Unit's own stable-context parameter
// binding. Mirrors ExecutionFieldRule's exact discriminated shape
// (technical-demonstration-execution-profile-contracts.ts) but generalizes
// `field` to an open `parameterName` (this contract has no closed,
// cutting-specific field-name vocabulary to validate against, unlike
// CuttingStepOverrideFieldName + FIELD_VALUE_VALIDATORS) and reuses
// SkillCondition<TFact> for REQUIRED_CONDITIONAL instead of
// ExecutionRuleCondition. Exactly one of fixedValue/allowedOptions/
// condition may ever be present, gated strictly by `semantic`.
// ---------------------------------------------------------------------------

export interface ExecutionUnitParameterRule<TFact extends string = string> {
  parameterName: string;
  semantic: ExecutionUnitParameterSemantic;
  // REQUIRED_FIXED only.
  fixedValue?: string | boolean | number;
  // PROFESSIONAL_CHOICE only -- a non-empty closed set of options.
  allowedOptions?: readonly (string | boolean | number)[];
  // REQUIRED_CONDITIONAL only -- the reused, closed SkillCondition language.
  condition?: SkillCondition<TFact>;
  // Mandatory for every rule regardless of semantic -- a human-authored
  // reason, never inferred.
  rationale: string;
}

export function isValidExecutionUnitParameterRule<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is ExecutionUnitParameterRule<TFact> {
  if (!isRecord(value)) return false;
  if (typeof value.parameterName !== "string" || value.parameterName.length === 0) return false;
  if (!isExecutionUnitParameterSemantic(value.semantic)) return false;
  if (typeof value.rationale !== "string" || value.rationale.trim().length === 0) return false;

  const hasFixedValue = "fixedValue" in value && value.fixedValue !== undefined;
  const hasAllowedOptions = "allowedOptions" in value && value.allowedOptions !== undefined;
  const hasCondition = "condition" in value && value.condition !== undefined;

  switch (value.semantic) {
    case "REQUIRED_FIXED":
      if (hasAllowedOptions || hasCondition) return false;
      return hasFixedValue && isParameterLiteral(value.fixedValue);
    case "PROFESSIONAL_CHOICE": {
      if (hasFixedValue || hasCondition) return false;
      if (!hasAllowedOptions || !Array.isArray(value.allowedOptions) || value.allowedOptions.length === 0) return false;
      return value.allowedOptions.every(isParameterLiteral);
    }
    case "REQUIRED_CONDITIONAL":
      if (hasFixedValue || hasAllowedOptions) return false;
      return hasCondition && isValidSkillCondition(value.condition, isValidFact);
    case "NOT_APPLICABLE":
    case "UNDEFINED":
    case "CLIENT_DERIVED":
      // Deliberately bare -- CLIENT_DERIVED in particular must never carry
      // a value here, same discipline as ExecutionFieldRule's own
      // equivalent case.
      return !hasFixedValue && !hasAllowedOptions && !hasCondition;
    default:
      return false;
  }
}

// Two rules within the SAME Execution Unit targeting the SAME parameter is
// an unresolvable ambiguity -- mirrors findConflictingExecutionFieldRules/
// findConflictingSkillParameterNames's own exact precedent.
export function findConflictingExecutionUnitParameterRules(rules: readonly { parameterName: string }[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const rule of rules) {
    counts.set(rule.parameterName, (counts.get(rule.parameterName) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// The Execution Unit itself.
// ---------------------------------------------------------------------------

export interface ExecutionUnit<TFact extends string = string> {
  // Stable identity within its own Skill Instance/procedure -- human- or
  // compiler-assigned, never derived automatically.
  executionUnitId: string;
  // Open string, deliberately -- mirrors SkillDefinition.vertical exactly.
  vertical: string;
  // 1-based ordering within its own Execution Unit sequence (see
  // isValidExecutionUnitSequence below) -- the same ordering discipline as
  // SkillProcedureStep.order and TechnicalDemonstrationStep.stepNumber.
  order: number;
  // Human-review grouping metadata -- a professional-facing label (e.g.
  // "Posterior/Lower"), never technical authority itself. Free text is
  // safe here specifically BECAUSE it is presentation-only: nothing in
  // this contract's own validation ever reads `label`/`description` as a
  // technical fact.
  label: string;
  description?: string;

  // Optional scope -- the "context stays stable" boundary. All three are
  // independent axes; a real Execution Unit may set any subset.
  zoneId?: string;
  laterality?: ExecutionUnitLaterality;
  subPhase?: string;

  // Optional: when this Execution Unit applies at all, in the SAME closed
  // condition language every other rule engine in this domain already
  // uses -- never a free-form description, never eval'd.
  applicabilityCondition?: SkillCondition<TFact>;
  // The stable professional-execution context/parameters this Execution
  // Unit carries. Deliberately NOT an Atomic Action array -- a parameter
  // rule declares WHAT stays fixed/conditional/professional-choice within
  // this scope; compiling that into actual operations is a separate,
  // later, non-persisted step this contract never performs.
  parameterRules?: readonly ExecutionUnitParameterRule<TFact>[];

  // Declarative only -- no resolution/ordering logic lives here. A future
  // compiler consults these; this contract only records and structurally
  // validates them (see isValidExecutionUnitSequence's acyclic check).
  prerequisiteExecutionUnitIds?: readonly string[];

  // Provenance -- the exact Skill Instance this Execution Unit was
  // derived from (Stage 2.5.i.6a). The full chain (Professional Authority
  // -> Skill Definition/version -> Skill Instance -> Execution Unit) is
  // reconstructible transitively via the referenced SkillInstance's own
  // sourceSkillId/sourceSkillVersion -- never duplicated here. An
  // Execution Unit never carries independent authority; see
  // isExecutionUnitEligibleForAuthority.
  sourceSkillInstanceId: string;

  // Vertical-specific execution context payload -- this contract has NO
  // opinion on its shape (mirrors TechnicalDemonstrationStepRecord.
  // payload's own "Record<string, unknown>, narrowed by the matching
  // vertical's own validator" precedent exactly). Never interpreted here.
  // Cutting may eventually use this for concepts like elevation/control
  // method/tool orientation; Color/Treatment would use their own, entirely
  // different shape -- never forced into this file's universal fields.
  verticalPayload?: Record<string, unknown>;

  createdAt: string;
}

export function isValidExecutionUnit<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
  isValidVerticalPayload?: (candidate: unknown) => boolean,
): value is ExecutionUnit<TFact> {
  if (!isRecord(value)) return false;
  if (typeof value.executionUnitId !== "string" || value.executionUnitId.length === 0) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 1) return false;
  if (typeof value.label !== "string" || value.label.trim().length === 0) return false;
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length === 0)) return false;

  if (value.zoneId !== undefined && (typeof value.zoneId !== "string" || value.zoneId.length === 0)) return false;
  if (value.laterality !== undefined && !isExecutionUnitLaterality(value.laterality)) return false;
  if (value.subPhase !== undefined && (typeof value.subPhase !== "string" || value.subPhase.length === 0)) return false;

  if (value.applicabilityCondition !== undefined && !isValidSkillCondition(value.applicabilityCondition, isValidFact)) return false;

  if (value.parameterRules !== undefined) {
    if (!Array.isArray(value.parameterRules)) return false;
    if (!value.parameterRules.every((rule) => isValidExecutionUnitParameterRule(rule, isValidFact))) return false;
    if (findConflictingExecutionUnitParameterRules(value.parameterRules as { parameterName: string }[]).length > 0) return false;
  }

  if (value.prerequisiteExecutionUnitIds !== undefined) {
    if (!Array.isArray(value.prerequisiteExecutionUnitIds)) return false;
    if (!value.prerequisiteExecutionUnitIds.every((id) => typeof id === "string" && id.length > 0)) return false;
    // Self-reference is a structural contradiction, never legal.
    if ((value.prerequisiteExecutionUnitIds as string[]).includes(value.executionUnitId as string)) return false;
  }

  // The source relation can never be hidden solely in verticalPayload --
  // it is this structured, required field, always.
  if (typeof value.sourceSkillInstanceId !== "string" || value.sourceSkillInstanceId.length === 0) return false;

  if (value.verticalPayload !== undefined) {
    if (isValidVerticalPayload) {
      if (!isValidVerticalPayload(value.verticalPayload)) return false;
    } else if (!isRecord(value.verticalPayload)) {
      return false;
    }
  }

  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Execution Unit sequence -- "one Skill Instance can conceptually produce
// several Execution Units" (Stage 2.5.i.2 §15/§33). A sequence is never a
// mixed-source bag: every unit in it must share the SAME
// sourceSkillInstanceId (Stage 2.5.i.6a -- exactly one Skill Instance's own
// derivation, never several stitched together, and never merely "the same
// Skill+version" -- two separate instances of the same Skill/version, e.g.
// reused twice within one Composition, must never be silently mixed into
// one sequence either). Ordering must be a genuine, contiguous 1..N
// sequence (mirrors SkillDefinition.procedure's own exact ordering
// discipline), ids must be unique, and the prerequisiteExecutionUnitIds
// graph must reference only ids that exist within this same sequence and
// contain no cycle -- a dangling or circular dependency is rejected, never
// silently ignored.
// ---------------------------------------------------------------------------

export function isValidExecutionUnitSequence<TFact extends string>(units: readonly ExecutionUnit<TFact>[]): boolean {
  if (units.length === 0) return false;

  const firstSourceInstance = units[0].sourceSkillInstanceId;
  if (!units.every((u) => u.sourceSkillInstanceId === firstSourceInstance)) return false;

  const ids = units.map((u) => u.executionUnitId);
  if (new Set(ids).size !== ids.length) return false;

  const orders = units.map((u) => u.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i] !== i + 1) return false;
  }

  const idSet = new Set(ids);
  const byId = new Map(units.map((u) => [u.executionUnitId, u]));
  for (const unit of units) {
    for (const prereqId of unit.prerequisiteExecutionUnitIds ?? []) {
      if (!idSet.has(prereqId)) return false;
    }
  }

  // Acyclic check -- plain DFS over a closed graph (only ids within this
  // same sequence are ever referenced, enforced above).
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(ids.map((id) => [id, WHITE]));
  const hasCycle = (id: string): boolean => {
    color.set(id, GRAY);
    const unit = byId.get(id);
    for (const prereqId of unit?.prerequisiteExecutionUnitIds ?? []) {
      const state = color.get(prereqId);
      if (state === GRAY) return true;
      if (state === WHITE && hasCycle(prereqId)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const id of ids) {
    if (color.get(id) === WHITE && hasCycle(id)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Authority -- an Execution Unit never carries independent authority; it
// inherits eligibility from the SkillDefinition its source Skill Instance
// itself points to. Same governance principle as isSkillEligibleFor
// Authority/isExecutionProfileEligibleForAuthority: an unreviewed or
// non-ACTIVE source Skill can never make its own Execution Units eligible
// authority merely by this contract's own shape existing. The caller
// resolves the SkillDefinition via the chain (sourceSkillInstanceId ->
// Skill Instance -> sourceSkillId/sourceSkillVersion) -- this function's
// own signature is unchanged by Stage 2.5.i.6a, since it already accepted
// the resolved SkillDefinition-shaped object directly, never the raw id.
// Not called from anywhere in production yet -- no Composition Engine, no
// runtime Execution Unit activation exists (Stage 2.5.i.3's own explicit
// boundary).
// ---------------------------------------------------------------------------

export function isExecutionUnitEligibleForAuthority(sourceSkill: Pick<SkillDefinition, "status" | "authorityType">): boolean {
  return isSkillEligibleForAuthority(sourceSkill);
}

// ---------------------------------------------------------------------------
// Cross-check -- pure, no DB, no runtime lookup (Stage 2.5.i.6a's own
// explicit boundary: "contract validation only"). Callable ONLY when the
// caller already has both objects in hand (e.g. a future compiler holding
// a Skill Instance and the Execution Units derived from it); this file
// never fetches a Skill Instance itself. Confirms the Execution Unit's own
// `sourceSkillInstanceId` genuinely names the given Skill Instance AND
// that the two agree on `vertical` -- catching a cross-domain
// contradiction (e.g. a cutting Execution Unit accidentally pointing at a
// color Skill Instance) wherever domain information is actually available,
// without this file needing to know anything about verticals itself.
// ---------------------------------------------------------------------------

export function isExecutionUnitConsistentWithSourceSkillInstance(
  unit: Pick<ExecutionUnit, "sourceSkillInstanceId" | "vertical">,
  instance: Pick<SkillInstance, "skillInstanceId" | "vertical">,
): boolean {
  return unit.sourceSkillInstanceId === instance.skillInstanceId && unit.vertical === instance.vertical;
}
