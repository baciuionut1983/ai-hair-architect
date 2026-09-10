import { isSkillEligibleForAuthority, type SkillDefinition } from "@/lib/professional-skill-contracts";
import type { SkillInstance } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";
import type { AtomicAction, AtomicActionObservationCriterion } from "@/lib/professional-skill-atomic-action-contracts";
import { compileExecutionUnitToAtomicActions } from "@/lib/cutting-skill-atomic-action-compiler";
import type { ProfessionalReasoningProposal, ProposedSkillStep } from "@/lib/professional-reasoning-contracts";
import {
  PROFESSIONAL_EXECUTION_PLAN_SCHEMA_VERSION,
  type ExecutionPlanFailureReason,
  type PlannedExecutionParameter,
  type PlannedExecutionUnit,
  type ProfessionalExecutionPlan,
} from "@/lib/professional-execution-plan-contracts";
import { computeProfessionalExecutionPlanReadiness, summarizeExecutionUnitReadiness, type ExecutionUnitReadinessVerdict } from "@/lib/professional-execution-plan-readiness";
import type { SkillConditionFacts } from "@/lib/skill-condition-evaluator";

// AI Hair Architect, Professional Skill Engine Stage 6 -- PROFESSIONAL
// EXECUTION PLAN, Part O compiler (Stage 5 proposal -> Stage 6 plan) +
// Part L minimal professional-authority operations. Pure, deterministic,
// no I/O, no AI, ZERO paid provider call (Part R). Compiles a CONFIRMED
// Stage 5 ProfessionalReasoningProposal into a ProfessionalExecutionPlan
// using ONLY already-real skill content -- reuses
// cutting-skill-atomic-action-compiler.ts's own
// compileExecutionUnitToAtomicActions UNCHANGED (never re-implemented),
// and adds ONLY what that compiler explicitly, deliberately never does:
// appending a VERIFY-kind AtomicAction (Part I), and carrying each unit's
// own declaredCapabilityUsed/addressesDelta/resolvedParameters forward
// (Part C/E).
//
// TEMPLATE REGISTRY (Part N): the caller supplies a small, closed list of
// ExecutionPlanSkillTemplate entries -- one per real, allowed Skill
// Definition version. This file declares NO registry of its own content
// (no new skill authored here); Part O's own real proof supplies exactly
// the 3 real skills' own already-exported SkillDefinition/SkillInstance/
// ExecutionUnit[] constants. A ProposedSkillStep naming any
// skillDefinitionId/skillVersion NOT present in the caller's own template
// list fails closed with SKILL_NOT_ALLOWED -- this file has no path to
// silently invent or substitute a skill.
//
// MULTI-EXECUTION-UNIT SKILLS (e.g. Occipital Transition's own real 2
// Execution Units -- lower/comb, upper/fingers): ALL of a matched
// template's own executionUnits compile into the plan, in their own
// declared `order`, all sharing the SAME step-level addressesDelta/
// declaredCapabilityUsed -- a Stage 5 step approves WHAT skill/delta
// pairing to use; the skill's own real Execution Unit breakdown is HOW
// that skill's own real content already subdivides its execution (never
// re-derived or second-guessed here). This file deliberately does NOT
// evaluate each Execution Unit's own `applicabilityCondition` to decide
// inclusion/exclusion -- unlike a parameter rule, an Execution Unit's
// applicability condition describes WHEN, during real physical
// progression through the zone, that unit's own stable context holds
// (e.g. "below" vs "at-and-above" the occipital curvature) -- a temporal/
// positional fact that changes DURING one professional's own execution
// of the skill, not a static fact this offline compile-time exercise can
// honestly resolve once and for all. Both Execution Units are compiled
// into the plan as real, prepared professional guidance; which one
// currently applies is for the professional executing the plan to
// observe live -- exactly the same "OFFLINE COMPILATION, never runtime
// simulation" boundary cutting-skill-atomic-action-compiler.ts's own
// header already draws for parameter resolution.
//
// PARAMETER PROVENANCE (Part E): every resolvedParameter compiled here is
// tagged SKILL_DEFAULT -- see professional-execution-plan-contracts.ts's
// own header for why this is not an invented default: each value traces
// to either an ExecutionUnit.parameterRules REQUIRED_FIXED.fixedValue
// (e.g. Occipital Transition's own real controlMethodRule) or a
// SkillInstance.parameterBindings entry with bindingState
// "FIXED_FROM_AUTHORITY" -- both are real, already-authored professional
// authority, reproducing (never diverging from)
// cutting-skill-atomic-action-compiler.ts's own private
// resolveEffectiveParameterValue precedence (Execution-Unit rule wins
// over Skill-Instance binding) exactly, since that function is not
// exported.
//
// COMPLETION/VERIFICATION (Part G/I): each compiled unit's own
// completionCriterion is a fresh, deterministic fact name
// ("<executionUnitId>.completed"), expectedValue true, evidenceStatus
// RUNTIME_PROFESSIONAL_OBSERVATION -- the honest, available verification
// method for real haircut execution today (no sensor exists for "is this
// zone's guide established"; Vision is never called in Stage 6, Part I's
// own explicit rule). The SAME criterion is reused verbatim as the
// appended VERIFY AtomicAction's own observationCriterion -- one source
// of truth, never two independently-authored "is this done" signals.
//
// VALIDATION SPLIT: this file does NOT independently re-verify every Part
// J rule (zone applicability, order dependency, preservation-constraint
// violation, ...) -- mirrors this codebase's own established structural-
// vs-business-rule split (isProfessionalReasoningProposal vs.
// validateProfessionalReasoningProposal). A compiled plan is always fed
// through professional-execution-plan-validator.ts before being treated
// as usable; this compiler only refuses to compile when it cannot even
// construct a structurally coherent plan (unknown/ineligible skill,
// undeclared capability, or an Execution Unit whose own declared
// parameters cannot resolve).
//
// PART M -- the Stage 5 proposal's own unresolvedRequirements (e.g. the
// crown-weight-reduction delta: "No registered skill declares capability
// to reduce weight in the crown zone") are carried forward VERBATIM, and
// NEVER become a plannedUnit here -- there is no template, no synthetic
// step, no fabricated Execution Unit standing in for an unsupported
// delta.

export interface ExecutionPlanSkillTemplate<TFact extends string> {
  skillDefinition: SkillDefinition<TFact>;
  skillInstance: SkillInstance<TFact>;
  executionUnits: readonly ExecutionUnit<TFact>[];
  isValidFact: (candidate: unknown) => candidate is TFact;
}

export interface CompileProfessionalExecutionPlanInput {
  proposal: ProfessionalReasoningProposal;
  reasoningProposalId: string;
  reasoningProposalContextFingerprint: string;
  currentSnapshotId: string;
  currentSnapshotVersion: number;
  targetSnapshotId: string;
  targetSnapshotVersion: number;
  // Heterogeneous per entry (Occipital Transition's own OccipitalTransitionFact
  // differs from Central Nape Guide/Continue Construction's own shared
  // ExecutionRuleConditionFact) -- each entry keeps its own real TFact at
  // the point compileExecutionUnitToAtomicActions is called; the OUTPUT
  // plan/units widen to TFact=string (every field in ExecutionUnit/
  // AtomicAction/PlannedExecutionUnit uses TFact only in covariant/output
  // position, so this widening is structurally sound, never a cast that
  // hides a real mismatch).
  templates: readonly ExecutionPlanSkillTemplate<string>[];
  compiledAt: string;
}

export interface ProfessionalExecutionPlanCompilationSuccess {
  status: "COMPILED";
  plan: ProfessionalExecutionPlan;
}

export interface ProfessionalExecutionPlanCompilationFailure {
  status: "UNRESOLVED";
  failureReason: ExecutionPlanFailureReason;
  reason: string;
  stepId?: string;
}

export type ProfessionalExecutionPlanCompilationResult = ProfessionalExecutionPlanCompilationSuccess | ProfessionalExecutionPlanCompilationFailure;

function resolveDeclaredParametersAsSkillDefault<TFact extends string>(
  skillDefinition: SkillDefinition<TFact>,
  skillInstance: SkillInstance<TFact>,
  executionUnit: ExecutionUnit<TFact>,
): PlannedExecutionParameter[] {
  const resolved: PlannedExecutionParameter[] = [];
  for (const parameter of skillDefinition.parameters) {
    const euRule = executionUnit.parameterRules?.find((r) => r.parameterName === parameter.name);
    if (euRule) {
      if (euRule.semantic === "REQUIRED_FIXED" && euRule.fixedValue !== undefined) {
        resolved.push({ name: parameter.name, value: euRule.fixedValue, source: "SKILL_DEFAULT" });
      }
      // Every other Execution-Unit-rule semantic never resolves a concrete
      // value here -- mirrors resolveEffectiveParameterValue's own exact
      // precedence. Should not occur when compileExecutionUnitToAtomicActions
      // already reported COMPILED (that call already guarantees every
      // declared parameter resolved); defensive only, never reached by the
      // real proof.
      continue;
    }
    const binding = skillInstance.parameterBindings.find((b) => b.parameterName === parameter.name);
    if (binding && binding.bindingState !== "UNRESOLVED" && binding.value !== undefined) {
      resolved.push({ name: parameter.name, value: binding.value, source: "SKILL_DEFAULT" });
    }
  }
  return resolved;
}

function compilePlannedExecutionUnit<TFact extends string>(
  template: ExecutionPlanSkillTemplate<TFact>,
  executionUnit: ExecutionUnit<TFact>,
  step: ProposedSkillStep,
  compiledAt: string,
): { status: "COMPILED"; unit: PlannedExecutionUnit<TFact> } | { status: "UNRESOLVED"; failureReason: ExecutionPlanFailureReason; reason: string } {
  const compiled = compileExecutionUnitToAtomicActions(template.skillDefinition, template.skillInstance, executionUnit, template.isValidFact, compiledAt);
  if (compiled.status === "UNRESOLVED") {
    return { status: "UNRESOLVED", failureReason: "MISSING_REQUIRED_PARAMETER", reason: `Execution Unit "${executionUnit.executionUnitId}": ${compiled.reason}.` };
  }

  const resolvedParameters = resolveDeclaredParametersAsSkillDefault(template.skillDefinition, template.skillInstance, executionUnit);

  const completionCriterion: AtomicActionObservationCriterion = {
    fact: `${executionUnit.executionUnitId}.completed`,
    expectedValue: true,
    evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION",
  };

  const verifyAction: AtomicAction<TFact> = {
    atomicActionId: `${executionUnit.executionUnitId}#verify`,
    vertical: executionUnit.vertical,
    order: compiled.actions.length + 1,
    actionKind: "VERIFY",
    sourceExecutionUnitId: executionUnit.executionUnitId,
    sourceSkillId: template.skillInstance.sourceSkillId,
    sourceSkillVersion: template.skillInstance.sourceSkillVersion,
    observationCriterion: completionCriterion,
    presentationSummary: `Professional visual confirmation that "${executionUnit.label}" is complete.`,
    compiledAt,
  };

  const unit: PlannedExecutionUnit<TFact> = {
    executionUnit,
    atomicActions: [...compiled.actions, verifyAction],
    addressesDelta: step.addressesDelta,
    declaredCapabilityUsed: step.declaredCapabilityUsed,
    completionCriterion,
    resolvedParameters,
  };

  return { status: "COMPILED", unit };
}

export function compileProfessionalExecutionPlan(input: CompileProfessionalExecutionPlanInput): ProfessionalExecutionPlanCompilationResult {
  const { proposal } = input;
  const stepsById = new Map(proposal.proposedSkills.map((s) => [s.stepId, s] as const));
  const orderedSteps = proposal.proposedOrder.map((id) => stepsById.get(id)).filter((s): s is ProposedSkillStep => s !== undefined);

  const plannedUnits: PlannedExecutionUnit<string>[] = [];

  for (const step of orderedSteps) {
    const template = input.templates.find((t) => t.skillDefinition.skillId === step.skillDefinitionId && t.skillDefinition.version === step.skillVersion);
    if (!template) {
      return {
        status: "UNRESOLVED",
        failureReason: "SKILL_NOT_ALLOWED",
        reason: `No compiled template is registered for skill "${step.skillDefinitionId}" v${step.skillVersion}.`,
        stepId: step.stepId,
      };
    }
    if (!isSkillEligibleForAuthority(template.skillDefinition)) {
      return {
        status: "UNRESOLVED",
        failureReason: "SKILL_NOT_ALLOWED",
        reason: `Skill "${step.skillDefinitionId}" v${step.skillVersion} is not eligible professional authority.`,
        stepId: step.stepId,
      };
    }
    const declaredCapabilities = template.skillDefinition.capabilities ?? [];
    if (!declaredCapabilities.some((c) => c.kind === step.declaredCapabilityUsed)) {
      return {
        status: "UNRESOLVED",
        failureReason: "CAPABILITY_MISMATCH",
        reason: `Skill "${step.skillDefinitionId}" v${step.skillVersion} does not declare capability "${step.declaredCapabilityUsed}".`,
        stepId: step.stepId,
      };
    }

    for (const executionUnit of template.executionUnits) {
      const compiledUnit = compilePlannedExecutionUnit(template, executionUnit, step, input.compiledAt);
      if (compiledUnit.status === "UNRESOLVED") {
        return { status: "UNRESOLVED", failureReason: compiledUnit.failureReason, reason: compiledUnit.reason, stepId: step.stepId };
      }
      plannedUnits.push(compiledUnit.unit);
    }
  }

  const readiness = computeProfessionalExecutionPlanReadiness({
    unitVerdicts: computeUnitVerdicts(plannedUnits),
    unresolvedRequirementCount: proposal.unresolvedRequirements.length,
    droppedProposedStepCount: 0,
  });

  const plan: ProfessionalExecutionPlan = {
    schemaVersion: PROFESSIONAL_EXECUTION_PLAN_SCHEMA_VERSION,
    currentSnapshotId: input.currentSnapshotId,
    currentSnapshotVersion: input.currentSnapshotVersion,
    targetSnapshotId: input.targetSnapshotId,
    targetSnapshotVersion: input.targetSnapshotVersion,
    reasoningProposalId: input.reasoningProposalId,
    reasoningProposalContextFingerprint: input.reasoningProposalContextFingerprint,
    plannedUnits,
    preservationConstraints: proposal.preservationConstraints,
    unresolvedRequirements: proposal.unresolvedRequirements,
    readiness,
  };

  return { status: "COMPILED", plan };
}

function computeUnitVerdicts(plannedUnits: readonly PlannedExecutionUnit<string>[]): readonly ExecutionUnitReadinessVerdict[] {
  const emptyFacts: SkillConditionFacts<string> = new Map();
  return plannedUnits.map((unit) => summarizeExecutionUnitReadiness(unit.executionUnit.parameterRules ?? [], unit.resolvedParameters, emptyFacts).verdict);
}

// ---------------------------------------------------------------------------
// Part L -- minimal professional-authority operations. Both are pure:
// they return a NEW plan value, never mutate the input, never touch the
// source Stage 5 proposal. "Approve the entire plan" / "replace a
// proposed skill with another allowed one" / "change order" are
// deliberately NOT implemented here -- Part L's own "large new UI not
// required" allowance is read as covering the data/service layer too:
// approval is a persistence-layer status transition (mirrors Stage 5's
// own confirmDraftReasoningProposal, see professional-execution-plan-
// repository.ts), and skill-swap/reorder would require a materially
// larger dispatcher across the whole template registry for a capability
// this stage's own Part O proof does not exercise -- flagged, not
// silently skipped.
// ---------------------------------------------------------------------------

export function applyProfessionalParameterOverride(plan: ProfessionalExecutionPlan, executionUnitId: string, parameterName: string, value: string | boolean | number): ProfessionalExecutionPlan {
  const plannedUnits = plan.plannedUnits.map((unit) => {
    if (unit.executionUnit.executionUnitId !== executionUnitId) return unit;
    const resolvedParameters: PlannedExecutionParameter[] = [
      ...unit.resolvedParameters.filter((p) => p.name !== parameterName),
      { name: parameterName, value, source: "PROFESSIONAL_OVERRIDE" },
    ];
    return { ...unit, resolvedParameters };
  });

  const readiness = computeProfessionalExecutionPlanReadiness({
    unitVerdicts: computeUnitVerdicts(plannedUnits),
    unresolvedRequirementCount: plan.unresolvedRequirements.length,
    droppedProposedStepCount: 0,
  });

  return { ...plan, plannedUnits, readiness };
}

export function rejectPlannedExecutionUnit(plan: ProfessionalExecutionPlan, executionUnitId: string): ProfessionalExecutionPlan {
  const plannedUnits = plan.plannedUnits.filter((u) => u.executionUnit.executionUnitId !== executionUnitId);
  const droppedProposedStepCount = plan.plannedUnits.length - plannedUnits.length;

  const readiness = computeProfessionalExecutionPlanReadiness({
    unitVerdicts: computeUnitVerdicts(plannedUnits),
    unresolvedRequirementCount: plan.unresolvedRequirements.length,
    droppedProposedStepCount,
  });

  return { ...plan, plannedUnits, readiness };
}
