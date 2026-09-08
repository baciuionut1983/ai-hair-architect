import { isRecord } from "@/lib/technical-visual-map-validators";
import { ATOMIC_ACTION_EVIDENCE_STATUSES, isAtomicActionEvidenceStatus, type AtomicAction, type AtomicActionEvidenceStatus } from "@/lib/professional-skill-atomic-action-contracts";
import { type DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import { type ViewpointConstraint } from "@/lib/professional-skill-viewpoint-constraint-contracts";

// AI Hair Architect, Stage 2.5.i.13 -- VIDEOINSTRUCTION, contract/
// foundation only. Types + pure validators, no I/O, no database, no
// provider call, no AI, ZERO compiler -- mirrors Stage 2.5.i.4/i.10/
// i.12's own established "Stage 1" convention exactly. UNIVERSAL --
// named accordingly (professional-skill-*).
//
// ARCHITECTURAL LOCK (Stage 2.5.i.11/i.12 audits): a VideoInstruction is
// the provider-independent envelope answering "what must this segment of
// Technical Execution Video demonstrate" -- it packages already-derived
// Atomic Action / Demonstration Requirement / Viewpoint Constraint
// authority by REFERENCE, creates NO new professional or cinematographic
// authority, and NEVER answers exact provider implementation (camera
// geometry, timing, prompt syntax, model, seed). This file sits strictly
// between Viewpoint Constraint (Stage 2.5.i.12) and a future Provider
// Adapter -- ZERO compiler exists here (no
// compileAtomicActionToVideoInstruction or equivalent); a future stage
// implements deterministic compilation once this contract is approved.
//
// SINGLE UNIVERSAL FILE, no vertical-specific sibling this time --
// deliberately different from Stage 2.5.i.10/i.12's own universal-
// contract/vertical-deriver split. Those stages needed a cutting-specific
// RULE TABLE (which parameter maps to which category; which family
// satisfies which framing). This stage needs no such table: every
// function below is pure referential-integrity checking over already-
// universal shapes (AtomicAction, DemonstrationRequirement,
// ViewpointConstraint) -- there is no vertical-specific judgment to make,
// so there is no vertical-specific file to split it into.
//
// REFERENCES, NOT RE-DECLARATIONS -- this contract's own explicit
// boundary: it does NOT duplicate Skill/Skill Instance/Execution Unit
// ids (already reachable transitively via sourceAtomicActionId -> Atomic
// Action's own provenance chain), does NOT re-embed Demonstration
// Requirement or Viewpoint Constraint CONTENT (only their ids), and does
// NOT carry a copy of any professional fact value. Only
// `sourceAtomicActionId` is denormalized onto this type directly (mirrors
// TechnicalDemonstrationStep.vertical's own established "denormalized
// scoping field, query/defense-in-depth convenience" precedent) --
// everything else is a bare id reference.
//
// EVIDENCE STATUS -- reuses AtomicActionEvidenceStatus (DEMONSTRATED_
// TARGET / RUNTIME_PROFESSIONAL_OBSERVATION) DIRECTLY, not an
// independently-declared mirror, unlike this domain's usual "small,
// independently-named, structurally-similar enum per entity type"
// precedent (professional-skill-contracts.ts's own stated reasoning).
// Deliberately different here: the meaning is not merely similar, it is
// IDENTICAL (a VideoInstruction's own claim about what was demonstrated
// vs. observed must never be allowed to drift from its source Atomic
// Action's own claim), and isVideoInstructionObservationClaimSupported
// below directly cross-checks the two -- a genuine need for the same
// type, not just the same shape, justifying the deviation from the usual
// precedent (mirrors professional-skill-instance-contracts.ts's own
// documented exception for CLIENT_DERIVED/PROFESSIONAL_OVERRIDE, same
// reasoning).
//
// NO SEPARATE "RENDER INTENT" FIELD -- considered and rejected. The
// semantic content a future provider needs (which relationship/geometry/
// context must be shown) is ALREADY fully reconstructible from the
// referenced Demonstration Requirement(s)' own `category` and the
// referenced Viewpoint Constraint(s)' own `framingSemantic` -- adding a
// third, redundant semantic field here would be exactly the "second copy
// of Demonstration Requirement semantics" this stage's own task
// explicitly forbids.
//
// NO CONTINUITY FIELD -- considered and rejected for the same reason.
// Cross-instruction ordering/continuity is ALREADY fully reconstructible
// via sourceAtomicActionId -> AtomicAction.order/sourceExecutionUnitId ->
// ExecutionUnit.order/prerequisiteExecutionUnitIds (both already real,
// already-established precedents) -- adding a dedicated
// `priorVideoInstructionId` or similar here would duplicate information
// already expressible one layer up, violating this stage's own explicit
// "avoid duplicate provenance" instruction. `order` itself IS kept as a
// direct, denormalized field (see above) purely for cheap local
// sequencing, mirroring the same established precedent.
//
// COVERAGE INVARIANT -- Stage 2.5.i.12 established that mandatory
// Demonstration Requirements must be covered by a Viewpoint Constraint.
// This file does NOT recompute or duplicate that policy engine -- it only
// provides a pure, cross-object PROOF function
// (isVideoInstructionCoverageSatisfied) that every one of a
// VideoInstruction's own referenced Demonstration Requirement ids is
// actually satisfied by the union of its own referenced Viewpoint
// Constraints' own `satisfiedDemonstrationRequirementIds` -- the same
// "structurally prove nothing was silently dropped" discipline as every
// prior stage in this chain.
//
// CROSS-ACTION INTEGRITY -- a VideoInstruction for Atomic Action A must
// never silently reference a Demonstration Requirement or Viewpoint
// Constraint that actually belongs to a DIFFERENT Atomic Action.
// isVideoInstructionSourceConsistent proves this, wherever the caller has
// all the relevant objects on hand -- pure validation, no DB lookup.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.13's own explicit boundary):
//   - it contains ZERO camera/timing/provider-specific field (exact
//     angle, distance, lens, seconds, frame count, model name, prompt
//     syntax, seed, provider operation id, safety parameters) -- Stage
//     2.5.i.11/i.12's own already-established boundary, extended here;
//   - it does NOT implement a compiler, a provider adapter, or Technical
//     Execution Video generation -- this file exports no such symbol;
//   - it is NOT persisted -- no Prisma model, no migration. Like every
//     layer downstream of Skill Instance/Execution Unit, it is treated as
//     a future compiled artifact, never independent authority;
//   - it does NOT depend on Technical Visual Map, Spatial Map, Photo
//     Preview, or Result Video in any way -- no import from any of those
//     files anywhere in this contract;
//   - it does NOT claim a runtime observation occurred unless the source
//     Atomic Action itself already makes that exact claim -- see
//     isVideoInstructionObservationClaimSupported.

// ---------------------------------------------------------------------------
// The VideoInstruction itself.
// ---------------------------------------------------------------------------

export interface VideoInstruction {
  videoInstructionId: string;
  // Open string, deliberately -- mirrors every other contract in this
  // family exactly.
  vertical: string;
  // 1-based ordering (see isValidVideoInstructionSequence below).
  order: number;
  // Denormalized provenance -- see file header. The rest of the chain
  // (Execution Unit -> Skill Instance -> Skill Definition/version ->
  // Professional Authority) is reachable transitively through the source
  // Atomic Action, never duplicated here.
  sourceAtomicActionId: string;
  // References only, never re-embedded content -- at least one of each,
  // required (see REQUIRED VS OPTIONAL audit, file header).
  sourceDemonstrationRequirementIds: readonly string[];
  sourceViewpointConstraintIds: readonly string[];
  // Reused directly from Stage 2.5.i.4 -- see file header for why this is
  // NOT independently re-declared. RUNTIME_PROFESSIONAL_OBSERVATION is
  // structurally legal but only ever SUPPORTED when the source Atomic
  // Action itself already makes the identical claim -- see
  // isVideoInstructionObservationClaimSupported.
  evidenceStatus: AtomicActionEvidenceStatus;
  // Distinct name from `createdAt` (SkillDefinition/ExecutionUnit/Skill
  // Instance) -- mirrors AtomicAction.compiledAt's own exact precedent:
  // this is a compilation-product timestamp, never an authored-record
  // timestamp.
  compiledAt: string;
}

function isNonEmptyStringArrayNoDuplicates(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((v) => typeof v === "string" && v.length > 0)) return false;
  return new Set(value).size === value.length;
}

export function isValidVideoInstruction(value: unknown): value is VideoInstruction {
  if (!isRecord(value)) return false;
  if (typeof value.videoInstructionId !== "string" || value.videoInstructionId.length === 0) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 1) return false;
  if (typeof value.sourceAtomicActionId !== "string" || value.sourceAtomicActionId.length === 0) return false;

  if (!isNonEmptyStringArrayNoDuplicates(value.sourceDemonstrationRequirementIds)) return false;
  if (!isNonEmptyStringArrayNoDuplicates(value.sourceViewpointConstraintIds)) return false;

  if (!isAtomicActionEvidenceStatus(value.evidenceStatus)) return false;
  if (typeof value.compiledAt !== "string" || value.compiledAt.length === 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Sequence -- deliberately minimal, self-contained (no external lookup
// needed): contiguous 1..N order, unique instruction ids, and -- since
// this contract's own architecture is one VideoInstruction per Atomic
// Action (the smallest professionally meaningful unit, matching Atomic
// Action's own established granularity) -- unique source Atomic Action
// ids too. Deeper cross-Execution-Unit consistency, if ever needed, is a
// natural future extension taking the corresponding Atomic Action/
// Execution Unit objects as additional input -- not required by anything
// this stage's own task asks for, and not built speculatively.
// ---------------------------------------------------------------------------

export function isValidVideoInstructionSequence(instructions: readonly VideoInstruction[]): boolean {
  if (instructions.length === 0) return false;

  const ids = instructions.map((i) => i.videoInstructionId);
  if (new Set(ids).size !== ids.length) return false;

  const sourceActionIds = instructions.map((i) => i.sourceAtomicActionId);
  if (new Set(sourceActionIds).size !== sourceActionIds.length) return false;

  const orders = instructions.map((i) => i.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i] !== i + 1) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Cross-object integrity -- see file header. Pure, no DB, callable
// wherever the caller already has the relevant objects.
// ---------------------------------------------------------------------------

export function isVideoInstructionSourceConsistent<TFact extends string>(
  instruction: VideoInstruction,
  demonstrationRequirements: readonly DemonstrationRequirement<TFact>[],
  viewpointConstraints: readonly ViewpointConstraint[],
): boolean {
  const requirementsById = new Map(demonstrationRequirements.map((r) => [r.demonstrationRequirementId, r]));
  for (const id of instruction.sourceDemonstrationRequirementIds) {
    const requirement = requirementsById.get(id);
    if (!requirement || requirement.sourceAtomicActionId !== instruction.sourceAtomicActionId) return false;
  }

  const constraintsById = new Map(viewpointConstraints.map((c) => [c.viewpointConstraintId, c]));
  for (const id of instruction.sourceViewpointConstraintIds) {
    const constraint = constraintsById.get(id);
    if (!constraint) return false;
    for (const satisfiedId of constraint.satisfiedDemonstrationRequirementIds) {
      const satisfiedRequirement = requirementsById.get(satisfiedId);
      if (!satisfiedRequirement || satisfiedRequirement.sourceAtomicActionId !== instruction.sourceAtomicActionId) return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Coverage invariant -- see file header. Never recomputes viewpoint
// policy; only proves the union of what the instruction's own referenced
// Viewpoint Constraints satisfy covers every one of its own referenced
// Demonstration Requirements.
// ---------------------------------------------------------------------------

export function isVideoInstructionCoverageSatisfied<TFact extends string>(
  instruction: VideoInstruction,
  demonstrationRequirements: readonly DemonstrationRequirement<TFact>[],
  viewpointConstraints: readonly ViewpointConstraint[],
): boolean {
  if (!isVideoInstructionSourceConsistent(instruction, demonstrationRequirements, viewpointConstraints)) return false;

  const constraintsById = new Map(viewpointConstraints.map((c) => [c.viewpointConstraintId, c]));
  const covered = new Set<string>();
  for (const id of instruction.sourceViewpointConstraintIds) {
    const constraint = constraintsById.get(id);
    if (!constraint) return false;
    for (const satisfiedId of constraint.satisfiedDemonstrationRequirementIds) covered.add(satisfiedId);
  }

  return instruction.sourceDemonstrationRequirementIds.every((id) => covered.has(id));
}

// ---------------------------------------------------------------------------
// Demonstration target vs. runtime observation -- see file header.
// ---------------------------------------------------------------------------

export function isVideoInstructionObservationClaimSupported<TFact extends string>(
  instruction: VideoInstruction,
  sourceAtomicAction: AtomicAction<TFact>,
): boolean {
  if (instruction.sourceAtomicActionId !== sourceAtomicAction.atomicActionId) return false;
  if (instruction.evidenceStatus === "RUNTIME_PROFESSIONAL_OBSERVATION") {
    return sourceAtomicAction.observationCriterion?.evidenceStatus === "RUNTIME_PROFESSIONAL_OBSERVATION";
  }
  return true;
}

// Re-exported so a caller only ever needs one import for this file's own
// vocabulary alongside the reused evidence-status guard.
export { ATOMIC_ACTION_EVIDENCE_STATUSES, isAtomicActionEvidenceStatus };
