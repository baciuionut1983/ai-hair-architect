import { compileExecutionUnitToAtomicActions, type AtomicActionCompilationSuccess } from "@/lib/cutting-skill-atomic-action-compiler";
import { deriveDemonstrationRequirementsFromAtomicAction } from "@/lib/cutting-skill-demonstration-requirement-deriver";
import { deriveViewpointConstraintsFromDemonstrationRequirements } from "@/lib/cutting-skill-viewpoint-constraint-deriver";
import { compileAtomicActionToVideoInstruction } from "@/lib/cutting-skill-video-instruction-compiler";
import {
  ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
  isEstablishCentralNapeGuideFact,
} from "@/lib/cutting-skill-establish-central-nape-guide";
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
import type { VideoInstruction } from "@/lib/professional-skill-video-instruction-contracts";
import type { ViewpointConstraint } from "@/lib/professional-skill-viewpoint-constraint-contracts";

// AI Hair Architect, Stage 2.5.i.23 -- PILOT-SCOPED REAL CHAIN COMPILER,
// Establish Central Nape Guide ONLY (task Section 1: "pilot strictly
// limited to Central Nape Guide, explicitly NOT extended to Occipital/
// other techniques/full haircut"). Deterministic, pure, no I/O, no
// database, no provider call -- compiles the ALREADY-real Stage 2.5.i.6
// Skill through the ALREADY-real Stage 2.5.i.8/i.10/i.12/i.14/i.21
// compiler/deriver/translator chain into exactly ONE
// ProviderAdapterTranslationOutput, given only the caller-supplied
// precondition signals (authorizationStatus/visualReferenceQualification,
// asserted by the i.22 readiness gate -- never decided here) and the
// selected visual reference (the i.22-bound image -- never chosen here).
//
// COMPUTES NOTHING NEW: mirrors cutting-skill-provider-adapter-compiler.test.ts's
// own real chain-building helpers exactly (this file is that same recipe,
// promoted from test fixture to real, callable production code) -- it
// never re-derives Demonstration Requirements, Viewpoint Constraints, or
// professional authority; it only invokes the EXISTING real compilers/
// derivers in the EXISTING real order.
//
// CUTTING-SPECIFIC, not universal -- named accordingly (mirrors
// cutting-skill-provider-adapter-compiler.ts's own naming precedent
// exactly): pilot scope, not new logic, justifies the cutting-scoped file.

export function compileEstablishCentralNapeGuideProviderAdapterOutput(input: {
  sealedRequestId: string;
  visualReference: ProviderAdapterVisualReference;
  authorizationStatus: AuthorizationPreconditionStatus;
  visualReferenceQualification: VisualReferenceQualificationStatus;
  compiledAt: string;
}): ProviderAdapterTranslationResult {
  const actionsResult = compileExecutionUnitToAtomicActions(
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
    ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
    isEstablishCentralNapeGuideFact,
    input.compiledAt,
  );
  if (actionsResult.status !== "COMPILED") {
    return { status: "UNRESOLVED", reason: `Central Nape Guide Atomic Action compilation failed: ${actionsResult.status}` };
  }
  const actions = (actionsResult as AtomicActionCompilationSuccess).actions;

  const position = findByKind(actions, "POSITION");
  const control = findByKind(actions, "CONTROL");
  const execute = findByKind(actions, "EXECUTE");
  if (!position || !control || !execute) {
    return { status: "UNRESOLVED", reason: "Central Nape Guide did not compile the expected POSITION/CONTROL/EXECUTE actions" };
  }

  const allRequirements: DemonstrationRequirement[] = [];
  const allConstraints: ViewpointConstraint[] = [];
  const instructions: VideoInstruction[] = [];

  for (const action of [position, control, execute]) {
    const requirementsResult = deriveDemonstrationRequirementsFromAtomicAction(
      action,
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      isEstablishCentralNapeGuideFact,
      input.compiledAt,
    );
    if (requirementsResult.status !== "DERIVED") {
      return { status: "UNRESOLVED", reason: `Demonstration Requirement derivation failed for action "${action.actionKind}": ${requirementsResult.status}` };
    }
    const requirements = requirementsResult.requirements;
    allRequirements.push(...requirements);

    // deriveViewpointConstraintsFromDemonstrationRequirements is scoped to
    // ONE Atomic Action's own requirements at a time (it requires every
    // requirement passed in to share the same sourceAtomicActionId) --
    // never called on the cross-action combined array. Per-action results
    // are concatenated below, mirroring
    // cutting-skill-provider-adapter-compiler.test.ts's own real fixture
    // assembly exactly.
    const constraintsResult = deriveViewpointConstraintsFromDemonstrationRequirements(requirements, isEstablishCentralNapeGuideFact, input.compiledAt);
    if (constraintsResult.status !== "COVERED") {
      return { status: "UNRESOLVED", reason: `Viewpoint Constraint derivation failed for action "${action.actionKind}": ${constraintsResult.status}` };
    }
    allConstraints.push(...constraintsResult.constraints);

    const instructionResult = compileAtomicActionToVideoInstruction(action, requirements, constraintsResult, isEstablishCentralNapeGuideFact, input.compiledAt);
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
    isEstablishCentralNapeGuideFact,
  );
}

function findByKind(actions: readonly AtomicAction[], kind: AtomicActionKind): AtomicAction | undefined {
  return actions.find((a) => a.actionKind === kind);
}
