import { compileExecutionUnitToAtomicActions, type AtomicActionCompilationSuccess } from "@/lib/cutting-skill-atomic-action-compiler";
import { deriveDemonstrationRequirementsFromAtomicAction } from "@/lib/cutting-skill-demonstration-requirement-deriver";
import { deriveViewpointConstraintsFromDemonstrationRequirements } from "@/lib/cutting-skill-viewpoint-constraint-deriver";
import { compileAtomicActionToVideoInstruction } from "@/lib/cutting-skill-video-instruction-compiler";
import {
  CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS,
  CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL,
  CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE,
  isContinueCentralNapeConstructionFact,
} from "@/lib/cutting-skill-continue-central-nape-construction";
import {
  translateVideoInstructionSequenceToProviderAdapterOutput,
  type ProviderAdapterTranslationResult,
} from "@/lib/cutting-skill-provider-adapter-compiler";
import type { AtomicAction, AtomicActionKind } from "@/lib/professional-skill-atomic-action-contracts";
import type { DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import type {
  AuthorizationPreconditionStatus,
  ProviderAdapterVisualReference,
  VisualReferenceQualificationStatus,
} from "@/lib/professional-skill-provider-adapter-contracts";
import type { ViewpointConstraint } from "@/lib/professional-skill-viewpoint-constraint-contracts";
import type { VideoInstruction } from "@/lib/professional-skill-video-instruction-contracts";

// AI Hair Architect, Stage 2.5.i.25 -- PILOT-SCOPED REAL CHAIN COMPILER,
// Continue Central Nape Construction ONLY. Mirrors
// cutting-skill-establish-central-nape-guide-provider-request.ts's own
// exact structure and discipline (Stage 2.5.i.23) -- deterministic, pure,
// no I/O, no database, no provider call. Computes nothing new: only
// invokes the EXISTING real compilers/derivers, now including the Stage
// 2.5.i.25 iteration-reachability path, in the EXISTING real order.
//
// This is the first real, end-to-end proof that procedural progression
// (Atomic Action `iteration` -> VideoInstruction `sourceIteration` ->
// ProviderAdapterActionSegment `iteration`) survives the FULL compile
// chain for real content, not just a synthetic fixture.

export function compileContinueCentralNapeConstructionProviderAdapterOutput(input: {
  sealedRequestId: string;
  visualReference: ProviderAdapterVisualReference;
  authorizationStatus: AuthorizationPreconditionStatus;
  visualReferenceQualification: VisualReferenceQualificationStatus;
  compiledAt: string;
}): ProviderAdapterTranslationResult {
  const actionsResult = compileExecutionUnitToAtomicActions(
    CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL,
    CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE,
    CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS[0],
    isContinueCentralNapeConstructionFact,
    input.compiledAt,
  );
  if (actionsResult.status !== "COMPILED") {
    return { status: "UNRESOLVED", reason: `Continue Central Nape Construction Atomic Action compilation failed: ${actionsResult.status}` };
  }
  const actions = (actionsResult as AtomicActionCompilationSuccess).actions;

  const position = findByKind(actions, "POSITION");
  const control = findByKind(actions, "CONTROL");
  const execute = findByKind(actions, "EXECUTE");
  if (!position || !control || !execute) {
    return { status: "UNRESOLVED", reason: "Continue Central Nape Construction did not compile the expected POSITION/CONTROL/EXECUTE actions" };
  }

  const allRequirements: DemonstrationRequirement[] = [];
  const allConstraints: ViewpointConstraint[] = [];
  const instructions: VideoInstruction[] = [];

  for (const action of [position, control, execute]) {
    const requirementsResult = deriveDemonstrationRequirementsFromAtomicAction(
      action,
      CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE,
      CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS[0],
      isContinueCentralNapeConstructionFact,
      input.compiledAt,
    );
    if (requirementsResult.status !== "DERIVED") {
      return { status: "UNRESOLVED", reason: `Demonstration Requirement derivation failed for action "${action.actionKind}": ${requirementsResult.status}` };
    }
    const requirements = requirementsResult.requirements;
    allRequirements.push(...requirements);

    const constraintsResult = deriveViewpointConstraintsFromDemonstrationRequirements(requirements, isContinueCentralNapeConstructionFact, input.compiledAt);
    if (constraintsResult.status !== "COVERED") {
      return { status: "UNRESOLVED", reason: `Viewpoint Constraint derivation failed for action "${action.actionKind}": ${constraintsResult.status}` };
    }
    allConstraints.push(...constraintsResult.constraints);

    const instructionResult = compileAtomicActionToVideoInstruction(action, requirements, constraintsResult, isContinueCentralNapeConstructionFact, input.compiledAt);
    if (instructionResult.status !== "COMPILED") {
      return { status: "UNRESOLVED", reason: `VideoInstruction compilation failed for action "${action.actionKind}": ${instructionResult.status}` };
    }
    instructions.push(instructionResult.instruction);
  }

  return translateVideoInstructionSequenceToProviderAdapterOutput(
    {
      videoInstructions: instructions,
      demonstrationRequirements: allRequirements,
      viewpointConstraints: allConstraints,
      visualReference: input.visualReference,
      authorizationStatus: input.authorizationStatus,
      visualReferenceQualification: input.visualReferenceQualification,
      sealedRequestId: input.sealedRequestId,
    },
    isContinueCentralNapeConstructionFact,
  );
}

function findByKind(actions: readonly AtomicAction[], kind: AtomicActionKind): AtomicAction | undefined {
  return actions.find((a) => a.actionKind === kind);
}
