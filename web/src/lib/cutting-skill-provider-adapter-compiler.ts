import { isValidDemonstrationRequirement, type DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import {
  isValidVideoInstruction,
  isValidVideoInstructionSequence,
  isVideoInstructionCoverageSatisfied,
  isVideoInstructionSourceConsistent,
  type VideoInstruction,
} from "@/lib/professional-skill-video-instruction-contracts";
import type { ViewpointConstraint } from "@/lib/professional-skill-viewpoint-constraint-contracts";
import {
  isValidProviderAdapterTranslationOutput,
  isValidProviderAdapterTranslationRequest,
  type ProviderAdapterActionSegment,
  type ProviderAdapterSemanticFact,
  type ProviderAdapterTranslationOutput,
  type ProviderAdapterTranslationRequest,
} from "@/lib/professional-skill-provider-adapter-contracts";

// AI Hair Architect, Stage 2.5.i.21 -- CUTTING SKILL PROVIDER ADAPTER
// COMPILER. The FIRST real use of the Stage 2.5.i.21 Provider Adapter
// contract: a small, pure, deterministic function that translates one
// already-compiled, already-grouped VideoInstruction sequence (Stage
// 2.5.i.13/i.14, real content from Stage 2.5.i.6/i.7, real chain
// completed at Stage 2.5.i.19) into ONE provider-independent
// ProviderAdapterTranslationOutput -- ZERO provider call, ZERO Veo, ZERO
// Gemini, ZERO prompt, ZERO video generation, ZERO DB, ZERO wiring into
// any runtime path. Calling this function has ZERO effect anywhere in
// the application today.
//
// CUTTING-SPECIFIC, not universal -- named accordingly (mirrors cutting-
// skill-video-instruction-compiler.ts exactly): nothing in this file's
// own function body encodes a cutting-specific RULE (no parameter name,
// no cutting value, no "Central Nape" anywhere in executable logic) --
// the pilot scope itself (proving this translator against exactly the
// Central Nape Guide real sequence) does not yet justify a universal
// home, per the exact same reasoning Stage 2.5.i.14's own header already
// documented. The Provider Adapter CONTRACT it targets
// (professional-skill-provider-adapter-contracts.ts) remains fully
// universal and untouched.
//
// TRANSLATOR, NOT A SECOND DERIVER: this file computes NOTHING that
// Stage 2.5.i.10/i.12/i.13/i.14 haven't already computed. It never
// re-derives Demonstration Requirements, never re-derives Viewpoint
// Constraints, never re-implements sequence/coverage/source-consistency
// logic -- it only receives their ALREADY-COMPUTED outputs as explicit
// parameters and proves, structurally, that they may be safely
// translated into one ProviderAdapterTranslationOutput. The actual proof
// of correctness is delegated to the EXISTING Stage 2.5.i.13 validators
// themselves (isValidVideoInstructionSequence /
// isVideoInstructionSourceConsistent / isVideoInstructionCoverageSatisfied)
// -- called here as the real, final gate before a result is ever
// returned, never reimplemented. Same "single source of truth per layer"
// discipline every prior stage in this chain has used.
//
// "UNRESOLVED HAIRSTATE" / "MISSING SHEARORIENTATION" ARE NOT SPECIAL-
// CASED HERE (this stage's own fail-closed list, items 9-11): this
// translator has no hardcoded notion that "wet hair" or "shear
// orientation" must exist -- that would encode cutting-specific
// knowledge into what must stay a generic layer (this stage's own
// "do not encode Central Nape into universal adapter infrastructure"
// rule, extended to this pilot file too, despite its cutting-scoped
// name). Instead, these cases are proven via the exact same GENERIC
// mechanism every other missing-value case uses: if a real
// VideoInstruction's own `sourceDemonstrationRequirementIds` references
// an id that is not present (or is present but inconsistent) in the
// caller-supplied `demonstrationRequirements` array, source-consistency
// fails -- regardless of WHICH fact that id happened to represent. The
// test file proves this concretely by supplying the real Central Nape
// Guide EXECUTE VideoInstruction (which references real wet/orientation
// requirement ids) alongside a deliberately truncated requirement array.
//
// STATE VS ACTION, STRUCTURALLY GUARANTEED: a segment is created ONLY
// ONE-PER-SOURCE-VIDEOINSTRUCTION -- there is no code path anywhere in
// this file capable of inventing a new segment from a fact. A
// SUBJECT_CONDITION_STATE fact (e.g. "wet") can only ever appear inside
// an EXISTING segment's own `requiredVisibleFacts` array, never as a
// segment of its own -- structurally incapable of becoming "a wetting
// action" (Stage 2.5.i.21's own explicit boundary).
//
// FACT REACHABILITY WITHOUT DUPLICATION: `requiredVisibleFacts` is built
// generically by resolving each VideoInstruction's own already-referenced
// `sourceDemonstrationRequirementIds` -- no per-category special casing,
// no manual enumeration of "wet"/"comb"/"0 degrees" anywhere in this
// file's own logic. Whatever Stage 2.5.i.10/i.19 already made reachable
// through a VideoInstruction's own references arrives here automatically.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.21's own explicit boundary):
//   - it does NOT call a provider, build a prompt, or reference Veo/
//     Gemini/any model name anywhere;
//   - it does NOT create, persist, or infer consent, and does NOT
//     perform any image-quality detection -- both precondition signals
//     are consumed exactly as given, never decided here;
//   - it does NOT read or write a database, and is not wired into any
//     API route, UI, Technical Demonstration Plan runtime, readiness, or
//     coherence path;
//   - it does NOT translate more than one grouped VideoInstruction
//     sequence into more than one ProviderAdapterTranslationOutput --
//     the whole real Central Nape Guide 3-action sequence becomes
//     exactly ONE output, never three.

export interface ProviderAdapterTranslationSuccess {
  status: "TRANSLATED";
  output: ProviderAdapterTranslationOutput;
}

export interface ProviderAdapterTranslationFailure {
  status: "UNRESOLVED";
  reason: string;
}

export type ProviderAdapterTranslationResult = ProviderAdapterTranslationSuccess | ProviderAdapterTranslationFailure;

function buildSegment<TFact extends string>(
  instruction: VideoInstruction,
  requirementsById: ReadonlyMap<string, DemonstrationRequirement<TFact>>,
  constraintsById: ReadonlyMap<string, ViewpointConstraint>,
): ProviderAdapterActionSegment {
  const requiredVisibleFacts: ProviderAdapterSemanticFact[] = instruction.sourceDemonstrationRequirementIds.map((id) => {
    const requirement = requirementsById.get(id)!;
    return { category: requirement.category, value: requirement.subjectValue, sourceDemonstrationRequirementId: requirement.demonstrationRequirementId };
  });

  const relevantConstraints = instruction.sourceViewpointConstraintIds.map((id) => constraintsById.get(id)!);
  const viewpointFamily = relevantConstraints[0].viewpointFamily;
  const framingSemantics = [...new Set(relevantConstraints.map((c) => c.framingSemantic))];

  return {
    order: instruction.order,
    sourceVideoInstructionId: instruction.videoInstructionId,
    sourceAtomicActionId: instruction.sourceAtomicActionId,
    evidenceStatus: instruction.evidenceStatus,
    requiredVisibleFacts,
    viewpointFamily,
    framingSemantics,
    sourceViewpointConstraintIds: instruction.sourceViewpointConstraintIds,
  };
}

export function translateVideoInstructionSequenceToProviderAdapterOutput<TFact extends string>(
  request: ProviderAdapterTranslationRequest<TFact>,
  isValidFact: (candidate: unknown) => candidate is TFact,
): ProviderAdapterTranslationResult {
  if (!isValidProviderAdapterTranslationRequest(request, isValidFact)) {
    return { status: "UNRESOLVED", reason: "translation request failed its own structural contract" };
  }

  if (request.authorizationStatus !== "VALIDATED") {
    return { status: "UNRESOLVED", reason: "authorization precondition missing or not VALIDATED" };
  }
  if (request.visualReferenceQualification !== "QUALIFIED") {
    return { status: "UNRESOLVED", reason: "visual reference qualification precondition missing or not QUALIFIED" };
  }

  if (!isValidVideoInstructionSequence(request.videoInstructions)) {
    return { status: "UNRESOLVED", reason: "invalid VideoInstruction sequence" };
  }

  const firstVertical = request.videoInstructions[0].vertical;
  if (!request.videoInstructions.every((i) => i.vertical === firstVertical)) {
    return { status: "UNRESOLVED", reason: "grouped VideoInstructions must all share the same vertical -- unsupported action grouping" };
  }

  const requirementsById = new Map<string, DemonstrationRequirement<TFact>>();
  for (const requirement of request.demonstrationRequirements) {
    if (!isValidDemonstrationRequirement(requirement, isValidFact)) {
      return { status: "UNRESOLVED", reason: "one or more Demonstration Requirements failed structural validation" };
    }
    const existing = requirementsById.get(requirement.demonstrationRequirementId);
    if (existing) {
      const equivalent =
        existing.category === requirement.category &&
        existing.subjectValue === requirement.subjectValue &&
        JSON.stringify([...existing.subjectParameterNames].sort()) === JSON.stringify([...requirement.subjectParameterNames].sort());
      if (!equivalent) {
        return { status: "UNRESOLVED", reason: `duplicate, incompatible Demonstration Requirement references for id "${requirement.demonstrationRequirementId}"` };
      }
    } else {
      requirementsById.set(requirement.demonstrationRequirementId, requirement);
    }
  }

  const constraintsById = new Map(request.viewpointConstraints.map((c) => [c.viewpointConstraintId, c]));

  for (const instruction of request.videoInstructions) {
    if (!isValidVideoInstruction(instruction)) {
      return { status: "UNRESOLVED", reason: "one or more VideoInstructions failed their own structural contract" };
    }
    if (!isVideoInstructionSourceConsistent(instruction, request.demonstrationRequirements, request.viewpointConstraints)) {
      return { status: "UNRESOLVED", reason: `VideoInstruction "${instruction.videoInstructionId}" failed cross-object source consistency` };
    }
    if (!isVideoInstructionCoverageSatisfied(instruction, request.demonstrationRequirements, request.viewpointConstraints)) {
      return { status: "UNRESOLVED", reason: `VideoInstruction "${instruction.videoInstructionId}" failed the mandatory coverage invariant` };
    }
    const relevantConstraints = instruction.sourceViewpointConstraintIds.map((id) => constraintsById.get(id)!);
    const families = new Set(relevantConstraints.map((c) => c.viewpointFamily));
    if (families.size > 1) {
      return { status: "UNRESOLVED", reason: `VideoInstruction "${instruction.videoInstructionId}" resolves to conflicting Viewpoint families -- conflicting requirement values` };
    }
  }

  const segments = request.videoInstructions.map((instruction) => buildSegment(instruction, requirementsById, constraintsById));

  const output: ProviderAdapterTranslationOutput = {
    generationIntent: "TECHNICAL_EXECUTION_DEMONSTRATION",
    vertical: firstVertical,
    sealedRequestId: request.sealedRequestId,
    visualReference: request.visualReference,
    segments,
  };

  if (!isValidProviderAdapterTranslationOutput(output)) {
    return { status: "UNRESOLVED", reason: "assembled translation output failed its own structural contract" };
  }

  return { status: "TRANSLATED", output };
}
