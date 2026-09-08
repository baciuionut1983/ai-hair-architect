import { isRecord } from "@/lib/technical-visual-map-validators";
import { isSkillEligibleForAuthority, type SkillDefinition } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Stage 2.5.i.5 -- PROFESSIONAL SKILL INSTANCE +
// COMPOSITION, contract/foundation only. Types + pure validators, no I/O,
// no database, no provider call, no AI, ZERO Composition Engine -- mirrors
// Stage 2.5.i.1/2.5.i.3/2.5.i.4's own established "Stage 1" convention
// exactly: a shared vocabulary + runtime guards, nothing more.
//
// ARCHITECTURAL LOCK (Stage 2.5.i.2 audit): a Skill Instance is "an
// instantiation of one approved Professional Skill Definition for one
// concrete composition/execution context, with resolved or explicitly
// unresolved parameters/conditions." It bridges Professional Skill
// Definition (Stage 2.5.i.1, reusable authority) -> concrete client/goal/
// context -> future Execution Units (Stage 2.5.i.3) WITHOUT generating any
// Execution Units here. A ProfessionalComposition is the minimal ordered
// container holding Skill Instances for one client/goal context -- NOT a
// Composition Engine; nothing in this file selects, resolves, or composes
// anything.
//
// LEVELS, kept structurally distinct, never collapsed (Stage 2.5.i.5's own
// explicit boundary):
//   Professional Skill Definition -- reusable professional procedure
//     authority (Stage 2.5.i.1, unchanged, imported by reference only).
//   Skill Instance (THIS FILE) -- concrete bound use of one Definition
//     version within one Composition, with typed, provenance-tagged
//     parameter bindings.
//   Execution Unit (Stage 2.5.i.3, unchanged) -- a context-bound execution
//     segment a FUTURE compiler derives FROM a Skill Instance. Not
//     generated, not referenced by id, not imported here.
//   Atomic Action (Stage 2.5.i.4, unchanged) -- compiled-only executable
//     detail a FUTURE compiler derives FROM Execution Units. Not
//     generated, not referenced, not imported here.
//
// PARAMETER BINDING STATE -- an INDEPENDENTLY DECLARED, NEW 8-value closed
// enum (SkillInstanceParameterBindingState below), deliberately NOT the
// same type as ExecutionFieldSemantic (2.5.h.2b) or
// ExecutionUnitParameterSemantic (2.5.i.3): those describe the RULE
// declared on a field/parameter ("what kind of rule governs this"), one
// layer up from here. This file describes the RESOLVED OUTCOME for one
// specific bound value on one specific instance ("what actually happened
// when this was resolved, and why the value exists") -- a genuinely
// different question, asked one layer down. Two of the eight values
// intentionally reuse an EXISTING NAME with an IDENTICAL meaning rather
// than being renamed for uniformity: CLIENT_DERIVED (same concept as
// ExecutionFieldSemantic's own CLIENT_DERIVED) and PROFESSIONAL_OVERRIDE
// (same concept as TechnicalDemonstrationValueProvenance's own
// PROFESSIONAL_OVERRIDE, technical-demonstration-contracts.ts) -- kept
// identical on purpose because the underlying meaning truly is identical,
// unlike the general "independently-named per entity type" precedent this
// codebase otherwise follows (professional-skill-contracts.ts's own file
// header explains that precedent) for genuinely NEW/different concepts.
//
// CONDITION RESOLUTION -- this file does NOT import SkillCondition
// (professional-skill-contracts.ts) or declare a new condition tree type.
// A Skill Instance never DECLARES a condition -- that authority lives on
// the source SkillDefinition/ExecutionUnit rule, one layer up. This file
// only RECORDS the resolved FACT INPUTS a condition declared elsewhere was
// evaluated against (SkillInstanceConditionFactInput<TFact> below) --
// reusing the exact same closed `TFact extends string` vocabulary and
// `string | boolean | number` literal typing every condition-aware
// contract in this domain already shares is the real reuse point here,
// not the condition-tree type itself. `source` on a fact input is a
// small, closed, three-value enum (CONFIRMED_CLIENT_FACT/
// PROFESSIONAL_INPUT/COMPOSITION_CONTEXT) that deliberately has NO slot
// for "raw, unconfirmed AI observation" -- an unconfirmed AI fact
// structurally cannot be represented as resolution authority here.
//
// PROFESSIONAL CHOICE, selected vs. unresolved -- kept structurally
// distinct (task's own explicit A/B requirement), never collapsed into a
// generic UNKNOWN: PROFESSIONAL_CHOICE (a value IS selected, from a
// required, non-empty `allowedOptions` set, always confirmedByUserId/
// confirmedAt-stamped) vs. UNRESOLVED with `allowedOptions` present (a
// value is NOT yet selected, but the set it will be chosen from is
// already known) vs. UNRESOLVED with `allowedOptions` absent (some other,
// less-specific kind of open gap).
//
// COMPOSITION LIFECYCLE -- reuses TechnicalDemonstrationPlan's own exact
// DRAFT|CONFIRMED|SUPERSEDED vocabulary (no REJECTED), NOT AnalysisProposal's
// four-value one: a ProfessionalComposition's real accept/decline decision
// belongs to the AnalysisProposal it is built from (which already owns
// REJECTED); once instantiated, a Composition behaves like a derived
// selection artifact, not an independently re-litigated proposal -- the
// exact same reasoning TechnicalDemonstrationPlan's own header comment
// already gives for the same choice.
//
// ORDERING -- deliberately mirrors ExecutionUnit/AtomicAction's own exact
// precedent a fourth time in this domain: a Composition does NOT hold an
// ordered list of Skill Instance ids (which would create two competing
// sources of truth for order). Instead each SkillInstance carries its own
// `compositionId` + `order`, and isValidSkillInstanceSequence validates
// the SET (same-composition membership, contiguous 1..N ordering, unique
// ids, acyclic prerequisite graph) -- exactly like
// isValidExecutionUnitSequence/isValidAtomicActionSequence.
//
// SOURCE AUTHORITY REFERENCE, not a full snapshot -- `sourceSkillId` +
// `sourceSkillVersion` alone are chosen over embedding the entire
// SkillDefinition object: a SkillDefinition is already an immutable,
// versioned snapshot by its own file's own documented discipline ("there
// is no update in place API... a new version is always a new, separate
// object"), so a version-pinned reference is exactly as reproducible as an
// embedded copy, without the duplication/staleness cost.
//
// COMPATIBILITY -- `compatibilityEvaluation` is a bare, optional AUDIT
// RECORD (what was evaluated against what, and the outcome), never an
// evaluator. This file exports zero compatibility/coherence CHECKING
// function -- Stage 2.5.h.2d's own coherence engine is never duplicated
// here (see test proving no such export exists).
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.5's own explicit boundary):
//   - it contains ZERO real professional Skill content or real client
//     composition -- every example anywhere near this concept, in tests
//     only, is explicitly labeled "SYNTHETIC TEST FIXTURE -- NOT REAL
//     PROFESSIONAL AUTHORITY";
//   - it implements ZERO Composition Engine and ZERO automatic Skill
//     selection -- nothing here ever produces a SkillInstance or
//     ProfessionalComposition from a real client/proposal; that is a
//     future stage's job;
//   - it generates ZERO Execution Units and compiles ZERO Atomic Actions
//     -- this file exports no such symbol (see tests #20/#21);
//   - it is NOT persisted -- no Prisma model, no migration, no "save"/
//     "create" function anywhere in this file;
//   - it does NOT hardcode a single vertical -- `vertical` is a plain
//     string on both types, mirroring every prior contract in this
//     family exactly.

// ---------------------------------------------------------------------------
// Parameter binding state -- see file header for why this is independently
// declared, and why two of its eight values deliberately reuse existing
// names.
// ---------------------------------------------------------------------------

export const SKILL_INSTANCE_PARAMETER_BINDING_STATES = [
  "FIXED_FROM_AUTHORITY",
  "CONDITION_RESOLVED",
  "CLIENT_DERIVED",
  "PROFESSIONAL_CONFIRMED",
  "PROFESSIONAL_OVERRIDE",
  "PROFESSIONAL_CHOICE",
  "DEMONSTRATION_SPECIFIC",
  "UNRESOLVED",
] as const;
export type SkillInstanceParameterBindingState = (typeof SKILL_INSTANCE_PARAMETER_BINDING_STATES)[number];

export function isSkillInstanceParameterBindingState(value: unknown): value is SkillInstanceParameterBindingState {
  return typeof value === "string" && (SKILL_INSTANCE_PARAMETER_BINDING_STATES as readonly string[]).includes(value);
}

function isParameterLiteral(value: unknown): value is string | boolean | number {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

// ---------------------------------------------------------------------------
// Condition fact input -- the resolved evidence a condition declared
// elsewhere was evaluated against. See file header: this is NOT a
// condition tree.
// ---------------------------------------------------------------------------

export const SKILL_INSTANCE_CONDITION_FACT_SOURCES = ["CONFIRMED_CLIENT_FACT", "PROFESSIONAL_INPUT", "COMPOSITION_CONTEXT"] as const;
export type SkillInstanceConditionFactSource = (typeof SKILL_INSTANCE_CONDITION_FACT_SOURCES)[number];

export function isSkillInstanceConditionFactSource(value: unknown): value is SkillInstanceConditionFactSource {
  return typeof value === "string" && (SKILL_INSTANCE_CONDITION_FACT_SOURCES as readonly string[]).includes(value);
}

export interface SkillInstanceConditionFactInput<TFact extends string = string> {
  fact: TFact;
  value: string | boolean | number;
  source: SkillInstanceConditionFactSource;
}

function isValidSkillInstanceConditionFactInput<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is SkillInstanceConditionFactInput<TFact> {
  if (!isRecord(value)) return false;
  if (!isValidFact(value.fact)) return false;
  if (!("value" in value) || value.value === undefined || !isParameterLiteral(value.value)) return false;
  if (!isSkillInstanceConditionFactSource(value.source)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Applicability resolution -- whether (and on what evidence) the source
// Skill's own applicabilityCondition (if any) was found to apply. Purely a
// record of an evaluation outcome; this file never performs the
// evaluation.
// ---------------------------------------------------------------------------

export interface SkillInstanceApplicabilityResolution<TFact extends string = string> {
  applies: boolean;
  factsUsed: readonly SkillInstanceConditionFactInput<TFact>[];
}

function isValidSkillInstanceApplicabilityResolution<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is SkillInstanceApplicabilityResolution<TFact> {
  if (!isRecord(value)) return false;
  if (typeof value.applies !== "boolean") return false;
  if (!Array.isArray(value.factsUsed)) return false;
  if (!value.factsUsed.every((f) => isValidSkillInstanceConditionFactInput(f, isValidFact))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Parameter binding -- one bound (or explicitly unresolved) parameter
// value on one Skill Instance. Exactly which of value/allowedOptions/
// conditionFactsUsed/sourceReference/confirmedByUserId/confirmedAt/
// rationale may be present is gated strictly by `bindingState`, never left
// to convention (see isValidSkillInstanceParameterBinding).
// ---------------------------------------------------------------------------

export interface SkillInstanceParameterBinding<TFact extends string = string> {
  parameterName: string;
  bindingState: SkillInstanceParameterBindingState;
  // Absent iff bindingState is UNRESOLVED.
  value?: string | boolean | number;
  // PROFESSIONAL_CHOICE only (required, `value` must be a member) -- OR
  // UNRESOLVED (optional: marks "this is specifically an unresolved
  // professional choice", distinguishing it from every other kind of
  // unresolved gap, per the task's own A/B requirement).
  allowedOptions?: readonly (string | boolean | number)[];
  // CONDITION_RESOLVED only, required and non-empty.
  conditionFactsUsed?: readonly SkillInstanceConditionFactInput<TFact>[];
  // Optional citation (e.g. "confirmed client fact id", "rule id") --
  // never a substitute for the structured fields above.
  sourceReference?: string;
  // PROFESSIONAL_CONFIRMED / PROFESSIONAL_OVERRIDE / PROFESSIONAL_CHOICE
  // only, both required together -- the three genuinely human-in-the-loop
  // states.
  confirmedByUserId?: string;
  confirmedAt?: string;
  // DEMONSTRATION_SPECIFIC only, required -- a human-authored reason this
  // value was fixed for a deterministic demonstration rather than left to
  // the real, dynamically-adapting professional rule (task's own explicit
  // example: real rule adapts; demonstration target is fixed).
  rationale?: string;
}

export function isValidSkillInstanceParameterBinding<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is SkillInstanceParameterBinding<TFact> {
  if (!isRecord(value)) return false;
  if (typeof value.parameterName !== "string" || value.parameterName.length === 0) return false;
  if (!isSkillInstanceParameterBindingState(value.bindingState)) return false;

  const hasValue = "value" in value && value.value !== undefined;
  const hasAllowedOptions = "allowedOptions" in value && value.allowedOptions !== undefined;
  const hasConditionFacts = "conditionFactsUsed" in value && value.conditionFactsUsed !== undefined;
  const hasSourceReference = "sourceReference" in value && value.sourceReference !== undefined;
  const hasConfirmedBy = "confirmedByUserId" in value && value.confirmedByUserId !== undefined;
  const hasConfirmedAt = "confirmedAt" in value && value.confirmedAt !== undefined;
  const hasRationale = "rationale" in value && value.rationale !== undefined;

  if (hasValue && !isParameterLiteral(value.value)) return false;
  if (hasAllowedOptions) {
    if (!Array.isArray(value.allowedOptions) || value.allowedOptions.length === 0) return false;
    if (!value.allowedOptions.every(isParameterLiteral)) return false;
  }
  if (hasConditionFacts) {
    if (!Array.isArray(value.conditionFactsUsed)) return false;
    if (!value.conditionFactsUsed.every((f) => isValidSkillInstanceConditionFactInput(f, isValidFact))) return false;
  }
  if (hasSourceReference && (typeof value.sourceReference !== "string" || value.sourceReference.length === 0)) return false;
  if (hasConfirmedBy && (typeof value.confirmedByUserId !== "string" || value.confirmedByUserId.length === 0)) return false;
  if (hasConfirmedAt && (typeof value.confirmedAt !== "string" || value.confirmedAt.length === 0)) return false;
  if (hasRationale && (typeof value.rationale !== "string" || value.rationale.trim().length === 0)) return false;

  switch (value.bindingState) {
    case "UNRESOLVED":
      return !hasValue && !hasConditionFacts && !hasConfirmedBy && !hasConfirmedAt;
    case "FIXED_FROM_AUTHORITY":
      return hasValue && !hasAllowedOptions && !hasConditionFacts && !hasConfirmedBy && !hasConfirmedAt;
    case "CONDITION_RESOLVED":
      return hasValue && !hasAllowedOptions && hasConditionFacts && (value.conditionFactsUsed as unknown[]).length > 0 && !hasConfirmedBy && !hasConfirmedAt;
    case "CLIENT_DERIVED":
      return hasValue && !hasAllowedOptions && !hasConditionFacts && hasSourceReference && !hasConfirmedBy && !hasConfirmedAt;
    case "PROFESSIONAL_CONFIRMED":
    case "PROFESSIONAL_OVERRIDE":
      return hasValue && !hasAllowedOptions && !hasConditionFacts && hasConfirmedBy && hasConfirmedAt;
    case "PROFESSIONAL_CHOICE":
      return (
        hasValue &&
        hasAllowedOptions &&
        (value.allowedOptions as unknown[]).includes(value.value) &&
        !hasConditionFacts &&
        hasConfirmedBy &&
        hasConfirmedAt
      );
    case "DEMONSTRATION_SPECIFIC":
      return hasValue && !hasAllowedOptions && !hasConditionFacts && !hasConfirmedBy && !hasConfirmedAt && hasRationale;
    default:
      return false;
  }
}

// Two bindings within the SAME Skill Instance targeting the SAME parameter
// is an unresolvable ambiguity -- mirrors findConflictingExecutionUnit
// ParameterRules's own exact precedent.
export function findConflictingSkillInstanceParameterBindings(bindings: readonly { parameterName: string }[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const binding of bindings) {
    counts.set(binding.parameterName, (counts.get(binding.parameterName) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Compatibility -- a bare audit record, never an evaluator. See file
// header.
// ---------------------------------------------------------------------------

export const SKILL_INSTANCE_COMPATIBILITY_OUTCOMES = ["COMPATIBLE", "INCOMPATIBLE", "NOT_YET_EVALUATED"] as const;
export type SkillInstanceCompatibilityOutcome = (typeof SKILL_INSTANCE_COMPATIBILITY_OUTCOMES)[number];

export function isSkillInstanceCompatibilityOutcome(value: unknown): value is SkillInstanceCompatibilityOutcome {
  return typeof value === "string" && (SKILL_INSTANCE_COMPATIBILITY_OUTCOMES as readonly string[]).includes(value);
}

export interface SkillInstanceCompatibilityEvaluation {
  evaluatedAgainstSkillInstanceIds: readonly string[];
  outcome: SkillInstanceCompatibilityOutcome;
}

function isValidSkillInstanceCompatibilityEvaluation(value: unknown): value is SkillInstanceCompatibilityEvaluation {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.evaluatedAgainstSkillInstanceIds)) return false;
  if (!value.evaluatedAgainstSkillInstanceIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  if (!isSkillInstanceCompatibilityOutcome(value.outcome)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The Skill Instance itself.
// ---------------------------------------------------------------------------

export interface SkillInstance<TFact extends string = string> {
  // Stable identity within its own Composition -- never a persisted,
  // globally-authored identifier the way SkillDefinition.skillId is.
  skillInstanceId: string;
  vertical: string;

  // Provenance -- see file header on why this is a version-pinned
  // reference, not an embedded snapshot.
  sourceSkillId: string;
  sourceSkillVersion: number;

  compositionId: string;
  // 1-based ordering within its own Composition (see
  // isValidSkillInstanceSequence below).
  order: number;

  applicabilityResolution?: SkillInstanceApplicabilityResolution<TFact>;
  parameterBindings: readonly SkillInstanceParameterBinding<TFact>[];

  // Declarative dependency references within the SAME composition --
  // deterministic ordering only, no runtime scheduler implied.
  prerequisiteSkillInstanceIds?: readonly string[];
  compatibilityEvaluation?: SkillInstanceCompatibilityEvaluation;

  createdAt: string;
}

export function isValidSkillInstance<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is SkillInstance<TFact> {
  if (!isRecord(value)) return false;
  if (typeof value.skillInstanceId !== "string" || value.skillInstanceId.length === 0) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (typeof value.sourceSkillId !== "string" || value.sourceSkillId.length === 0) return false;
  if (typeof value.sourceSkillVersion !== "number" || !Number.isInteger(value.sourceSkillVersion) || value.sourceSkillVersion < 1) return false;
  if (typeof value.compositionId !== "string" || value.compositionId.length === 0) return false;
  if (typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 1) return false;

  if (value.applicabilityResolution !== undefined && !isValidSkillInstanceApplicabilityResolution(value.applicabilityResolution, isValidFact)) {
    return false;
  }

  if (!Array.isArray(value.parameterBindings)) return false;
  if (!value.parameterBindings.every((b) => isValidSkillInstanceParameterBinding(b, isValidFact))) return false;
  if (findConflictingSkillInstanceParameterBindings(value.parameterBindings as { parameterName: string }[]).length > 0) return false;

  if (value.prerequisiteSkillInstanceIds !== undefined) {
    if (!Array.isArray(value.prerequisiteSkillInstanceIds)) return false;
    if (!value.prerequisiteSkillInstanceIds.every((id) => typeof id === "string" && id.length > 0)) return false;
    if ((value.prerequisiteSkillInstanceIds as string[]).includes(value.skillInstanceId as string)) return false;
  }

  if (value.compatibilityEvaluation !== undefined && !isValidSkillInstanceCompatibilityEvaluation(value.compatibilityEvaluation)) return false;

  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Skill Instance sequence -- one Composition's own ordered output. See
// file header on why ordering lives here, not on ProfessionalComposition.
// ---------------------------------------------------------------------------

export function isValidSkillInstanceSequence<TFact extends string>(instances: readonly SkillInstance<TFact>[]): boolean {
  if (instances.length === 0) return false;

  const firstComposition = instances[0].compositionId;
  if (!instances.every((i) => i.compositionId === firstComposition)) return false;

  // One Composition is single-vertical, mirroring AnalysisProposal.vertical
  // / TechnicalDemonstrationPlan.vertical -- a mixed-vertical sequence is
  // cross-vertical misuse, rejected here rather than left undetected.
  const firstVertical = instances[0].vertical;
  if (!instances.every((i) => i.vertical === firstVertical)) return false;

  const ids = instances.map((i) => i.skillInstanceId);
  if (new Set(ids).size !== ids.length) return false;

  const orders = instances.map((i) => i.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i] !== i + 1) return false;
  }

  const idSet = new Set(ids);
  const byId = new Map(instances.map((i) => [i.skillInstanceId, i]));
  for (const instance of instances) {
    for (const reqId of instance.prerequisiteSkillInstanceIds ?? []) {
      if (!idSet.has(reqId)) return false;
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(ids.map((id) => [id, WHITE]));
  const hasCycle = (id: string): boolean => {
    color.set(id, GRAY);
    const instance = byId.get(id);
    for (const reqId of instance?.prerequisiteSkillInstanceIds ?? []) {
      const state = color.get(reqId);
      if (state === GRAY) return true;
      if (state === WHITE && hasCycle(reqId)) return true;
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
// Authority -- a Skill Instance never carries independent authority; it
// inherits eligibility from the SkillDefinition its own sourceSkillId/
// sourceSkillVersion names, exactly like isExecutionUnitEligibleForAuthority
// / isAtomicActionEligibleForAuthority.
// ---------------------------------------------------------------------------

export function isSkillInstanceEligibleForAuthority(sourceSkill: Pick<SkillDefinition, "status" | "authorityType">): boolean {
  return isSkillEligibleForAuthority(sourceSkill);
}

// ---------------------------------------------------------------------------
// Professional Composition -- the minimal ordered container. See file
// header on why it holds no Skill Instance list of its own.
// ---------------------------------------------------------------------------

export const PROFESSIONAL_COMPOSITION_STATUSES = ["DRAFT", "CONFIRMED", "SUPERSEDED"] as const;
export type ProfessionalCompositionStatus = (typeof PROFESSIONAL_COMPOSITION_STATUSES)[number];

export function isProfessionalCompositionStatus(value: unknown): value is ProfessionalCompositionStatus {
  return typeof value === "string" && (PROFESSIONAL_COMPOSITION_STATUSES as readonly string[]).includes(value);
}

export interface ProfessionalComposition {
  compositionId: string;
  vertical: string;
  // Revision counter, mirrors TechnicalDemonstrationPlan.planVersion.
  version: number;
  status: ProfessionalCompositionStatus;
  // Soft pointer only (mirrors AnalysisProposal's own established
  // soft-ID-pointer precedent) -- this file has no relation of its own to
  // AnalysisProposal.
  sourceProposalId?: string;
  confirmedAt?: string;
  // Present only once status = SUPERSEDED -- mirrors
  // SkillDefinition.supersededBySkillId's own exact precedent.
  supersededByCompositionId?: string;
  createdAt: string;
}

export function isValidProfessionalComposition(value: unknown): value is ProfessionalComposition {
  if (!isRecord(value)) return false;
  if (typeof value.compositionId !== "string" || value.compositionId.length === 0) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) return false;
  if (!isProfessionalCompositionStatus(value.status)) return false;

  if (value.sourceProposalId !== undefined && (typeof value.sourceProposalId !== "string" || value.sourceProposalId.length === 0)) return false;
  if (value.confirmedAt !== undefined && (typeof value.confirmedAt !== "string" || value.confirmedAt.length === 0)) return false;

  if (value.supersededByCompositionId !== undefined) {
    if (typeof value.supersededByCompositionId !== "string" || value.supersededByCompositionId.length === 0) return false;
    if (value.status !== "SUPERSEDED") return false;
  }

  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) return false;

  return true;
}
