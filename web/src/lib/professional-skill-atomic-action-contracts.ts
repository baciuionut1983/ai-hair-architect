import { isRecord } from "@/lib/technical-visual-map-validators";
import { isSkillEligibleForAuthority, isValidSkillCondition, type SkillCondition, type SkillDefinition } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Stage 2.5.i.4 -- ATOMIC ACTION, contract/foundation
// only. Types + pure validators, no I/O, no database, no provider call, no
// AI, ZERO compiler -- mirrors Stage 2.5.i.1/2.5.i.3's own established
// "Stage 1" convention exactly: a shared vocabulary + runtime guards,
// nothing more.
//
// ARCHITECTURAL LOCK (Stage 2.5.i.2 audit, decision B): an Atomic Action is
// "the smallest professionally meaningful executable operation whose
// technical parameters remain internally coherent" -- COMPILED OUTPUT,
// never independently persisted professional authority, never a database
// row per tiny physical movement. This file sits BETWEEN a compiled
// Execution Unit (Stage 2.5.i.3, the stable-context layer) and a future
// VideoInstruction (deliberately NOT built here).
//
// REUSES professional-skill-contracts.ts's SkillCondition<TFact> a THIRD
// time (Skill applicability -> Execution Unit applicability/parameter
// conditions -> this file's own `precondition`) -- never a third
// competing rule language. Also reuses isSkillEligibleForAuthority
// directly: an Atomic Action never carries independent authority.
//
// DELIBERATELY generalizes technical-demonstration-cutting-contracts.ts's
// own CuttingExecutionActionType (7 cutting-specific values: SECTIONING_
// ACTION, STRUCTURAL_CUTTING, TEXTURIZING_ACTION, GUIDE_OBSERVATION,
// GUIDE_CUTTING, FINAL_OBSERVATION, CORRECTIVE_CUTTING) into a small,
// closed, CROSS-VERTICAL structural envelope (ATOMIC_ACTION_KINDS below:
// PREPARE/POSITION/CONTROL/EXECUTE/OBSERVE/VERIFY) -- justified because
// every one of cutting's 7 values already maps cleanly onto one of these 6
// broader categories (SECTIONING_ACTION -> PREPARE, STRUCTURAL_CUTTING/
// CORRECTIVE_CUTTING -> EXECUTE, GUIDE_OBSERVATION/FINAL_OBSERVATION ->
// OBSERVE, GUIDE_CUTTING -> EXECUTE), proving the umbrella is real
// generalization, not an invented abstraction. The cutting-specific
// vocabulary itself is NEVER imported here and never will be -- a
// vertical's own detailed action semantics belong in `verticalPayload`,
// never in this universal envelope.
//
// ACTION vs PARAMETER vs STATE vs OBSERVATION -- kept structurally
// distinct, not by convention:
//   - a bare PARAMETER (e.g. "elevation = 0 deg") has no actionKind, no
//     order, no provenance chain of its own -- it can never satisfy
//     isValidAtomicAction merely by carrying a value (see test #5). This
//     file's `boundParameterNames` only ever REFERENCES a parameter name
//     declared on the source Execution Unit -- it never re-declares or
//     carries the value itself, so a parameter can never masquerade as an
//     action here.
//   - STATE is a typed `stateTransition` (fact + optional fromValue +
//     toValue, never free text), attached only to a NON-observation-kind
//     action (PREPARE/POSITION/CONTROL/EXECUTE) -- because only those
//     kinds change anything.
//   - OBSERVATION is a typed `observationCriterion` (fact + expectedValue
//     + evidenceStatus), REQUIRED on and ONLY valid for OBSERVE/VERIFY
//     kinds -- a bare fact never floats unattached to an action wrapper,
//     and an observation action can never also claim a state transition
//     (observing never changes anything by definition).
//   - `evidenceStatus` (DEMONSTRATED_TARGET vs RUNTIME_PROFESSIONAL_
//     OBSERVATION) directly implements Stage 2.5.i.2's own §22 finding:
//     a future generated demonstration must never claim an unobserved
//     real-client fact was actually observed.
//
// REPETITION -- a small, closed, bounded `iteration` concept
// (OVER_ORDERED_SUBSECTIONS | UNTIL_EXECUTION_UNIT_COMPLETE | FIXED_COUNT,
// the last requiring an explicit positive integer count) lives ON the
// Atomic Action itself, deliberately, NOT as a separate outer layer: the
// thing that repeats (e.g. "cut strand") is the compiled operation itself,
// still scoped by its own stable Execution Unit context -- one Atomic
// Action record represents the whole repeated operation, never N
// duplicated records for N strands. No arbitrary/unbounded loop construct
// exists anywhere in this file.
//
// ANTI-MICROSTEP HEURISTIC (mirrors isValidSkillDefinition's own
// "procedure.length >= 2" structural floor, and its own honesty about
// imperfection): a non-observation-kind action (PREPARE/POSITION/CONTROL/
// EXECUTE) must carry at least one of a state transition, a bound
// parameter reference, or an iteration -- an action with none of these
// carries no detectable technical content and is more likely a disguised
// microscopic movement ("move hand 2cm") than a real professional action.
// This is a heuristic floor, not a professional-meaning oracle: type
// validation cannot and does not claim to determine whether "cut strand"
// vs. "close shear blade" is the correct professional grain -- that
// remains a professional review judgment, exactly like Stage 2.5.i.1's own
// documented boundary.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.4's own explicit boundary):
//   - it contains ZERO real professional execution content -- every
//     example anywhere near this concept, in tests only, is explicitly
//     labeled "SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY";
//   - it implements ZERO compiler -- nothing here ever produces an
//     AtomicAction from a real ExecutionUnit; that is a future stage's job;
//   - it is NOT persisted -- no Prisma model, no migration, no "save"/
//     "create" function anywhere in this file (see test #12). Every
//     AtomicAction id is a "stable deterministic identity WITHIN one
//     compiled execution" only -- never implied to be a stable, globally
//     persisted authored identifier the way SkillDefinition.skillId or
//     ExecutionUnit.executionUnitId are;
//   - it does NOT implement VideoInstruction or any video compiler -- this
//     file exports no such symbol (see test #18). Atomic Action describes
//     professional execution semantics only; camera/timing/framing/
//     provider-specific presentation is a strictly later, separate stage;
//   - it does NOT hardcode a single vertical -- `vertical` is a plain
//     string; `verticalPayload` is an uninterpreted `Record<string,
//     unknown>` narrowed only by the calling vertical's own validator,
//     mirroring ExecutionUnit.verticalPayload's own exact precedent.

// ---------------------------------------------------------------------------
// Action kind -- the small, closed, cross-vertical structural envelope. See
// file header for why this generalizes (rather than imports)
// CuttingExecutionActionType.
// ---------------------------------------------------------------------------

export const ATOMIC_ACTION_KINDS = ["PREPARE", "POSITION", "CONTROL", "EXECUTE", "OBSERVE", "VERIFY"] as const;
export type AtomicActionKind = (typeof ATOMIC_ACTION_KINDS)[number];

export function isAtomicActionKind(value: unknown): value is AtomicActionKind {
  return typeof value === "string" && (ATOMIC_ACTION_KINDS as readonly string[]).includes(value);
}

function isObservationKind(kind: AtomicActionKind): boolean {
  return kind === "OBSERVE" || kind === "VERIFY";
}

function isParameterLiteral(value: unknown): value is string | boolean | number {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

// ---------------------------------------------------------------------------
// State transition -- typed, never free text. Only ever valid on a
// non-observation-kind action (see isValidAtomicAction below).
// ---------------------------------------------------------------------------

export interface AtomicActionStateTransition {
  fact: string;
  fromValue?: string | boolean | number;
  toValue: string | boolean | number;
}

function isValidAtomicActionStateTransition(value: unknown): value is AtomicActionStateTransition {
  if (!isRecord(value)) return false;
  if (typeof value.fact !== "string" || value.fact.length === 0) return false;
  if (value.fromValue !== undefined && !isParameterLiteral(value.fromValue)) return false;
  if (!("toValue" in value) || value.toValue === undefined || !isParameterLiteral(value.toValue)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Observation criterion -- typed, never a bare unwrapped fact. Required on
// and exclusive to OBSERVE/VERIFY kinds. `evidenceStatus` is the direct
// implementation of Stage 2.5.i.2's §22 finding (see file header).
// ---------------------------------------------------------------------------

export const ATOMIC_ACTION_EVIDENCE_STATUSES = ["DEMONSTRATED_TARGET", "RUNTIME_PROFESSIONAL_OBSERVATION"] as const;
export type AtomicActionEvidenceStatus = (typeof ATOMIC_ACTION_EVIDENCE_STATUSES)[number];

export function isAtomicActionEvidenceStatus(value: unknown): value is AtomicActionEvidenceStatus {
  return typeof value === "string" && (ATOMIC_ACTION_EVIDENCE_STATUSES as readonly string[]).includes(value);
}

export interface AtomicActionObservationCriterion {
  fact: string;
  expectedValue: string | boolean | number;
  evidenceStatus: AtomicActionEvidenceStatus;
}

function isValidAtomicActionObservationCriterion(value: unknown): value is AtomicActionObservationCriterion {
  if (!isRecord(value)) return false;
  if (typeof value.fact !== "string" || value.fact.length === 0) return false;
  if (!("expectedValue" in value) || value.expectedValue === undefined || !isParameterLiteral(value.expectedValue)) return false;
  if (!isAtomicActionEvidenceStatus(value.evidenceStatus)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Iteration -- the closed, bounded repetition model. See file header for
// why this lives on the Atomic Action itself.
// ---------------------------------------------------------------------------

export const ATOMIC_ACTION_ITERATION_MODES = ["OVER_ORDERED_SUBSECTIONS", "UNTIL_EXECUTION_UNIT_COMPLETE", "FIXED_COUNT"] as const;
export type AtomicActionIterationMode = (typeof ATOMIC_ACTION_ITERATION_MODES)[number];

export function isAtomicActionIterationMode(value: unknown): value is AtomicActionIterationMode {
  return typeof value === "string" && (ATOMIC_ACTION_ITERATION_MODES as readonly string[]).includes(value);
}

export interface AtomicActionIteration {
  mode: AtomicActionIterationMode;
  // FIXED_COUNT only -- a small, explicit, closed bound. Never unbounded,
  // never derived at runtime by this contract.
  count?: number;
  // Presentation-only rationale for what is iterated over -- never
  // technical authority (same discipline as presentationSummary below).
  note?: string;
}

export function isValidAtomicActionIteration(value: unknown): value is AtomicActionIteration {
  if (!isRecord(value)) return false;
  if (!isAtomicActionIterationMode(value.mode)) return false;
  const hasCount = "count" in value && value.count !== undefined;
  if (value.mode === "FIXED_COUNT") {
    if (!hasCount || typeof value.count !== "number" || !Number.isInteger(value.count) || value.count < 1) return false;
  } else if (hasCount) {
    return false;
  }
  if (value.note !== undefined && (typeof value.note !== "string" || value.note.length === 0)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The Atomic Action itself.
// ---------------------------------------------------------------------------

export interface AtomicAction<TFact extends string = string> {
  // Stable, deterministic identity WITHIN one compiled execution -- see
  // file header on why this is NOT an authored, persisted identifier.
  atomicActionId: string;
  // Open string, deliberately -- mirrors ExecutionUnit.vertical exactly.
  vertical: string;
  // 1-based ordering within its own compiled sequence (see
  // isValidAtomicActionSequence below).
  order: number;

  actionKind: AtomicActionKind;

  // Provenance chain (Stage 2.5.i.2's own locked chain: Professional
  // Authority -> Skill Definition/version -> Skill Instance -> Execution
  // Unit -> Atomic Action). An Atomic Action never creates new authority;
  // see isAtomicActionEligibleForAuthority below.
  sourceExecutionUnitId: string;
  sourceSkillId: string;
  sourceSkillVersion: number;

  // Declarative REFERENCES only to parameter names declared on the source
  // Execution Unit -- never a re-declared value. This file has no
  // co-located Execution Unit object to cross-validate against (Atomic
  // Actions compile separately); that cross-check belongs to the future
  // compiler, not this contract.
  boundParameterNames?: readonly string[];

  // Closed, typed precondition, sourced from already-resolved composition/
  // Execution Unit facts -- an Atomic Action never decides professional
  // truth by itself.
  precondition?: SkillCondition<TFact>;
  // Declarative dependency references -- deterministic ordering only, no
  // runtime scheduler implied or implemented.
  requiresActionIds?: readonly string[];

  // Exactly one of these two may ever apply, gated strictly by
  // actionKind -- see isValidAtomicAction.
  stateTransition?: AtomicActionStateTransition;
  observationCriterion?: AtomicActionObservationCriterion;

  iteration?: AtomicActionIteration;

  // Vertical-specific execution payload -- uninterpreted here, mirrors
  // ExecutionUnit.verticalPayload's own exact precedent.
  verticalPayload?: Record<string, unknown>;

  // Human-review, presentation-only metadata -- NEVER read as technical
  // authority by any validator in this file (see test #17).
  presentationSummary: string;
  presentationDetail?: string;

  // Distinct name from `createdAt` (SkillDefinition/ExecutionUnit) --
  // deliberately signals "this is a compilation product timestamp", never
  // an authored-record timestamp.
  compiledAt: string;
}

export function isValidAtomicAction<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
  isValidVerticalPayload?: (candidate: unknown) => boolean,
): value is AtomicAction<TFact> {
  if (!isRecord(value)) return false;
  if (typeof value.atomicActionId !== "string" || value.atomicActionId.length === 0) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 1) return false;
  if (!isAtomicActionKind(value.actionKind)) return false;

  if (typeof value.sourceExecutionUnitId !== "string" || value.sourceExecutionUnitId.length === 0) return false;
  if (typeof value.sourceSkillId !== "string" || value.sourceSkillId.length === 0) return false;
  if (typeof value.sourceSkillVersion !== "number" || !Number.isInteger(value.sourceSkillVersion) || value.sourceSkillVersion < 1) return false;

  if (value.boundParameterNames !== undefined) {
    if (!Array.isArray(value.boundParameterNames)) return false;
    if (!value.boundParameterNames.every((n) => typeof n === "string" && n.length > 0)) return false;
  }

  if (value.precondition !== undefined && !isValidSkillCondition(value.precondition, isValidFact)) return false;

  if (value.requiresActionIds !== undefined) {
    if (!Array.isArray(value.requiresActionIds)) return false;
    if (!value.requiresActionIds.every((id) => typeof id === "string" && id.length > 0)) return false;
    // Self-reference is a structural contradiction, never legal.
    if ((value.requiresActionIds as string[]).includes(value.atomicActionId as string)) return false;
  }

  const kindIsObservation = isAtomicActionKind(value.actionKind) && isObservationKind(value.actionKind);

  if (kindIsObservation) {
    // Observation never changes state.
    if (value.stateTransition !== undefined) return false;
    if (!isValidAtomicActionObservationCriterion(value.observationCriterion)) return false;
  } else {
    // A bare fact never floats unattached to an observation-kind action.
    if (value.observationCriterion !== undefined) return false;
    if (value.stateTransition !== undefined && !isValidAtomicActionStateTransition(value.stateTransition)) return false;

    // Anti-microstep structural floor -- see file header.
    const hasBoundParameters = Array.isArray(value.boundParameterNames) && value.boundParameterNames.length > 0;
    const hasStateTransition = value.stateTransition !== undefined;
    const hasIteration = value.iteration !== undefined;
    if (!hasBoundParameters && !hasStateTransition && !hasIteration) return false;
  }

  if (value.iteration !== undefined && !isValidAtomicActionIteration(value.iteration)) return false;

  if (value.verticalPayload !== undefined) {
    if (isValidVerticalPayload) {
      if (!isValidVerticalPayload(value.verticalPayload)) return false;
    } else if (!isRecord(value.verticalPayload)) {
      return false;
    }
  }

  if (typeof value.presentationSummary !== "string" || value.presentationSummary.trim().length === 0) return false;
  if (value.presentationDetail !== undefined && (typeof value.presentationDetail !== "string" || value.presentationDetail.length === 0)) return false;

  if (typeof value.compiledAt !== "string" || value.compiledAt.length === 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Atomic Action sequence -- one compiled Execution Unit's own ordered
// output. Unlike SkillDefinition.procedure (which requires >= 2 steps),
// a sequence of exactly ONE Atomic Action is fully valid -- this contract
// never forces artificial splitting to reach a minimum count (see test
// #16). Every action in a sequence must share the SAME
// sourceExecutionUnitId; ordering must be a genuine, contiguous 1..N
// sequence; ids must be unique; the requiresActionIds graph must reference
// only ids within this same sequence and contain no cycle.
// ---------------------------------------------------------------------------

export function isValidAtomicActionSequence<TFact extends string>(actions: readonly AtomicAction<TFact>[]): boolean {
  if (actions.length === 0) return false;

  const firstUnit = actions[0].sourceExecutionUnitId;
  if (!actions.every((a) => a.sourceExecutionUnitId === firstUnit)) return false;

  const ids = actions.map((a) => a.atomicActionId);
  if (new Set(ids).size !== ids.length) return false;

  const orders = actions.map((a) => a.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i] !== i + 1) return false;
  }

  const idSet = new Set(ids);
  const byId = new Map(actions.map((a) => [a.atomicActionId, a]));
  for (const action of actions) {
    for (const reqId of action.requiresActionIds ?? []) {
      if (!idSet.has(reqId)) return false;
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
    const action = byId.get(id);
    for (const reqId of action?.requiresActionIds ?? []) {
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
// Authority -- an Atomic Action never carries independent authority; it
// inherits eligibility from the SkillDefinition its own sourceSkillId/
// sourceSkillVersion names, exactly like isExecutionUnitEligibleForAuthority.
// Not called from anywhere in production yet -- no compiler, no runtime
// Atomic Action generation exists (Stage 2.5.i.4's own explicit boundary).
// ---------------------------------------------------------------------------

export function isAtomicActionEligibleForAuthority(sourceSkill: Pick<SkillDefinition, "status" | "authorityType">): boolean {
  return isSkillEligibleForAuthority(sourceSkill);
}
