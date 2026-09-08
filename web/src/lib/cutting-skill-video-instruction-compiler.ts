import { isValidAtomicAction, type AtomicAction, type AtomicActionEvidenceStatus } from "@/lib/professional-skill-atomic-action-contracts";
import { isValidDemonstrationRequirement, type DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import type { ViewpointSatisfactionResult } from "@/lib/cutting-skill-viewpoint-constraint-deriver";
import {
  isValidVideoInstruction,
  isVideoInstructionCoverageSatisfied,
  isVideoInstructionObservationClaimSupported,
  isVideoInstructionSourceConsistent,
  type VideoInstruction,
} from "@/lib/professional-skill-video-instruction-contracts";

// AI Hair Architect, Stage 2.5.i.14 -- CUTTING SKILL VIDEOINSTRUCTION
// COMPILER. The FIRST real use of the Stage 2.5.i.13 VideoInstruction
// contract: a small, pure, deterministic function that ASSEMBLES one
// already-compiled Atomic Action (Stage 2.5.i.8, real content from Stage
// 2.5.i.6/i.7) plus its own already-derived Demonstration Requirements
// (Stage 2.5.i.10) and already-derived Viewpoint Policy satisfaction
// (Stage 2.5.i.12) into ONE VideoInstruction -- ZERO provider call, ZERO
// Veo, ZERO prompt, ZERO video generation, ZERO DB, ZERO wiring into any
// runtime path. Calling this function has ZERO effect anywhere in the
// application today.
//
// CUTTING-SPECIFIC, not universal -- named accordingly (mirrors cutting-
// skill-atomic-action-compiler.ts exactly): nothing in this file encodes
// a cutting-specific RULE, but the pilot scope itself (proving the
// compiler against exactly the two real cutting Skills) does not yet
// justify a universal home. The VideoInstruction CONTRACT it targets
// (professional-skill-video-instruction-contracts.ts) remains fully
// universal and untouched -- only this ASSEMBLY exercise is scoped
// cutting-first, per this stage's own explicit "compiler may be cutting-
// specific for this pilot" instruction.
//
// ASSEMBLER, NOT A SECOND DERIVER: this file computes NOTHING that Stage
// 2.5.i.10/i.12 haven't already computed. It never re-derives
// Demonstration Requirements, never re-derives Viewpoint Constraints,
// never re-implements the coverage/framing/family logic those stages own
// -- it only receives their ALREADY-COMPUTED outputs as explicit
// parameters (no hidden DB lookup, no global mutable state) and proves,
// structurally, that they may be safely assembled into one
// VideoInstruction. The actual proof of correctness is delegated to the
// EXISTING Stage 2.5.i.13 validators themselves
// (isValidVideoInstruction / isVideoInstructionSourceConsistent /
// isVideoInstructionCoverageSatisfied / isVideoInstructionObservationClaimSupported)
// -- called here as the real, final gate before a result is ever
// returned, never reimplemented. This is the same "single source of
// truth per layer" discipline every prior stage in this chain has used.
//
// ORDER IS INHERITED, NEVER INVENTED: `VideoInstruction.order` is taken
// directly from the source Atomic Action's own `order` field (already a
// deterministic, contiguous 1..N sequence within one compiled Execution
// Unit, established at Stage 2.5.i.4/i.8) -- no separate order parameter
// exists on this function's own signature, and no cinematic timeline,
// timestamp, or duration is ever introduced.
//
// EVIDENCE STATUS IS INHERITED, NEVER SUPPLIED: this function takes no
// `evidenceStatus` parameter at all -- the caller structurally cannot
// force a stronger claim than the source Atomic Action's own authority.
// `RUNTIME_PROFESSIONAL_OBSERVATION` is only ever produced when the
// source Atomic Action itself already carries an `observationCriterion`
// claiming exactly that (an OBSERVE/VERIFY-kind action); every other
// action kind (PREPARE/POSITION/CONTROL/EXECUTE, which is all three real
// Skills ever compile today, per Stage 2.5.i.8's own documented finding)
// safely inherits `DEMONSTRATED_TARGET`.
//
// DUPLICATE-ID INCOMPATIBILITY GUARD: if the caller's own
// `demonstrationRequirements` array contains two DIFFERENT objects
// sharing the same `demonstrationRequirementId` (a data-integrity
// problem upstream, never expected from the real i.10 deriver's own
// output), this function refuses to guess which one is authoritative --
// FAIL CLOSED with an explicit reason, distinct from the harmless case
// of an exact duplicate (same id, same content), which is safely
// collapsed to one entry.
//
// FREE-TEXT INCAPABLE BY CONSTRUCTION: this function never reads
// `presentationSummary`/`presentationDetail`/`label`/`description`/
// `rationale` from ANY input object -- VideoInstruction itself (Stage
// 2.5.i.13) has no field capable of carrying free text, so no prose
// anywhere in the source chain (including known-stale Technical
// Demonstration Plan description text) can ever reach this function's
// own output, structurally, not merely by convention.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.14's own explicit boundary):
//   - it does NOT call a provider, build a prompt, or reference Veo/
//     Gemini/any model name anywhere;
//   - it does NOT read or write a database, and is not wired into any
//     API route, UI, Technical Demonstration Plan runtime, readiness, or
//     coherence path;
//   - it does NOT compile more than one VideoInstruction per Atomic
//     Action -- the Stage 2.5.i.13 1:1 invariant is preserved exactly; a
//     caller wanting a full sequence calls this once per Atomic Action
//     and validates the resulting list with the EXISTING
//     isValidVideoInstructionSequence, never a new sequence compiler.

export interface VideoInstructionCompilationSuccess {
  status: "COMPILED";
  instruction: VideoInstruction;
}

export interface VideoInstructionCompilationFailure {
  status: "UNRESOLVED";
  reason: string;
}

export type VideoInstructionCompilationResult = VideoInstructionCompilationSuccess | VideoInstructionCompilationFailure;

function inheritEvidenceStatus<TFact extends string>(atomicAction: AtomicAction<TFact>): AtomicActionEvidenceStatus {
  return atomicAction.observationCriterion?.evidenceStatus ?? "DEMONSTRATED_TARGET";
}

export function compileAtomicActionToVideoInstruction<TFact extends string>(
  atomicAction: AtomicAction<TFact>,
  demonstrationRequirements: readonly DemonstrationRequirement<TFact>[],
  viewpointSatisfaction: ViewpointSatisfactionResult,
  isValidFact: (candidate: unknown) => candidate is TFact,
  compiledAt: string,
): VideoInstructionCompilationResult {
  if (!isValidAtomicAction(atomicAction, isValidFact)) {
    return { status: "UNRESOLVED", reason: "source Atomic Action failed structural validation" };
  }

  if (demonstrationRequirements.length === 0) {
    return { status: "UNRESOLVED", reason: "no Demonstration Requirements supplied" };
  }

  const byRequirementId = new Map<string, DemonstrationRequirement<TFact>>();
  for (const requirement of demonstrationRequirements) {
    if (!isValidDemonstrationRequirement(requirement, isValidFact)) {
      return { status: "UNRESOLVED", reason: "one or more Demonstration Requirements failed structural validation" };
    }
    if (requirement.sourceAtomicActionId !== atomicAction.atomicActionId) {
      return { status: "UNRESOLVED", reason: "one or more Demonstration Requirements reference a different source Atomic Action" };
    }
    const existing = byRequirementId.get(requirement.demonstrationRequirementId);
    if (existing) {
      const equivalent =
        existing.category === requirement.category &&
        existing.subjectValue === requirement.subjectValue &&
        JSON.stringify([...existing.subjectParameterNames].sort()) === JSON.stringify([...requirement.subjectParameterNames].sort());
      if (!equivalent) {
        return { status: "UNRESOLVED", reason: `duplicate, incompatible Demonstration Requirement references for id "${requirement.demonstrationRequirementId}"` };
      }
      // Exact, equivalent duplicate -- safe to collapse to one entry.
    } else {
      byRequirementId.set(requirement.demonstrationRequirementId, requirement);
    }
  }
  const normalizedRequirements = [...byRequirementId.values()];

  if (viewpointSatisfaction.status !== "COVERED") {
    const reason = viewpointSatisfaction.status === "VIEWPOINT_UNSATISFIED" || viewpointSatisfaction.status === "INVALID_INPUT" ? viewpointSatisfaction.reason : "Viewpoint Policy did not resolve";
    return { status: "UNRESOLVED", reason: `Viewpoint Policy unresolved: ${reason}` };
  }

  // Sorted, not insertion-order -- the emitted id arrays are a pure
  // function of WHICH ids are present, never of the caller's own input
  // array ordering (Section G determinism requirement).
  const candidate: VideoInstruction = {
    videoInstructionId: `${atomicAction.atomicActionId}#video`,
    vertical: atomicAction.vertical,
    order: atomicAction.order,
    sourceAtomicActionId: atomicAction.atomicActionId,
    sourceDemonstrationRequirementIds: normalizedRequirements.map((r) => r.demonstrationRequirementId).sort(),
    sourceViewpointConstraintIds: [...viewpointSatisfaction.constraints].map((c) => c.viewpointConstraintId).sort(),
    evidenceStatus: inheritEvidenceStatus(atomicAction),
    compiledAt,
  };

  // The real, final gate -- delegates to the EXISTING Stage 2.5.i.13
  // validators rather than reimplementing any of their logic. See file
  // header.
  if (!isValidVideoInstruction(candidate)) {
    return { status: "UNRESOLVED", reason: "assembled VideoInstruction failed its own structural contract" };
  }
  if (!isVideoInstructionSourceConsistent(candidate, normalizedRequirements, viewpointSatisfaction.constraints)) {
    return { status: "UNRESOLVED", reason: "assembled VideoInstruction failed cross-object source consistency" };
  }
  if (!isVideoInstructionCoverageSatisfied(candidate, normalizedRequirements, viewpointSatisfaction.constraints)) {
    return { status: "UNRESOLVED", reason: "assembled VideoInstruction failed the mandatory coverage invariant" };
  }
  if (!isVideoInstructionObservationClaimSupported(candidate, atomicAction)) {
    return { status: "UNRESOLVED", reason: "assembled VideoInstruction claims stronger observation authority than its source Atomic Action supports" };
  }

  return { status: "COMPILED", instruction: candidate };
}
