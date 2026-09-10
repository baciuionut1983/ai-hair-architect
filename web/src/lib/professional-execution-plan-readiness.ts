import type { SkillCondition } from "@/lib/professional-skill-contracts";
import type { ExecutionUnitParameterRule } from "@/lib/professional-skill-execution-unit-contracts";
import { evaluateSkillCondition, type SkillConditionFacts } from "@/lib/skill-condition-evaluator";
import type { ExecutionPlanFailureReason, PlannedExecutionParameter, ProfessionalExecutionPlanReadiness } from "@/lib/professional-execution-plan-contracts";

// AI Hair Architect, Professional Skill Engine Stage 6 -- PROFESSIONAL
// EXECUTION PLAN, Part D/E readiness evaluator. Pure, deterministic, no
// I/O, no AI. Evaluates ExecutionUnit.parameterRules (professional-skill-
// execution-unit-contracts.ts, UNCHANGED) against a plan's own resolved
// parameters, reusing Stage 4's exact evaluateSkillCondition (Kleene K3
// logic) for REQUIRED_CONDITIONAL rules -- NO second condition evaluator.
//
// GROUNDING IN REAL DATA (Part A audit finding): none of the 3 real
// skills' own ExecutionUnits populate `parameterRules` today -- all of
// their real parameter values live one layer up, on SkillInstance.
// parameterBindings (bindingState "FIXED_FROM_AUTHORITY" throughout,
// confirmed by direct reading of cutting-skill-establish-central-nape-
// guide.ts / cutting-skill-occipital-transition.ts / cutting-skill-
// continue-central-nape-construction.ts). This file's own logic is
// therefore exercised end-to-end by the real Part O proof only in its
// trivial "zero rules declared -> zero gaps" branch; its non-trivial
// branches (REQUIRED_FIXED/REQUIRED_CONDITIONAL/PROFESSIONAL_CHOICE/
// NOT_APPLICABLE gaps) are proven correct via SYNTHETIC TEST FIXTURE
// ExecutionUnits, mirroring this codebase's own established convention
// (see e.g. professional-skill-execution-unit-contracts.test.ts) for
// testing a real, structural mechanism ahead of real content exercising
// every branch -- never invented professional authority.
//
// FAIL-CLOSED ON UNKNOWN (task's own explicit rule, Part D): a
// REQUIRED_CONDITIONAL rule whose condition evaluates UNKNOWN is ALWAYS
// reported as a gap (UNKNOWN_CONDITIONAL_PARAMETER), even when a value
// happens to already be resolved for that parameter -- "do not guess"
// means never treating a present value as proof the condition holds; the
// applicability itself, not merely the value slot, is what remains
// unknown.
//
// PROFESSIONAL_CHOICE missing is modeled as a MISSING_REQUIRED_PARAMETER
// gap, not a new failure reason -- Part J's own 18-check list names
// "required parameters present" as one check, and a Professional Choice
// left unmade is, from the plan's own readiness perspective, exactly that:
// this Execution Unit is not usable until someone chooses. Part T's
// closed failure-reason set is deliberately not grown for this.

// ---------------------------------------------------------------------------
// Per-parameter readiness.
// ---------------------------------------------------------------------------

export const PARAMETER_READINESS_STATUSES = ["READY", "MISSING", "NEEDS_INPUT", "INVALID", "REJECTED"] as const;
export type ParameterReadinessStatus = (typeof PARAMETER_READINESS_STATUSES)[number];

export interface ParameterReadinessResult {
  parameterName: string;
  status: ParameterReadinessStatus;
  failureReason?: ExecutionPlanFailureReason;
}

function findResolved(resolvedParameters: readonly PlannedExecutionParameter[], name: string): PlannedExecutionParameter | undefined {
  return resolvedParameters.find((p) => p.name === name);
}

export function evaluateExecutionUnitParameterReadiness<TFact extends string>(
  rules: readonly ExecutionUnitParameterRule<TFact>[],
  resolvedParameters: readonly PlannedExecutionParameter[],
  facts: SkillConditionFacts<TFact>,
): readonly ParameterReadinessResult[] {
  return rules.map((rule) => evaluateOneParameterRule(rule, resolvedParameters, facts));
}

function evaluateOneParameterRule<TFact extends string>(
  rule: ExecutionUnitParameterRule<TFact>,
  resolvedParameters: readonly PlannedExecutionParameter[],
  facts: SkillConditionFacts<TFact>,
): ParameterReadinessResult {
  const resolved = findResolved(resolvedParameters, rule.parameterName);

  switch (rule.semantic) {
    case "REQUIRED_FIXED": {
      if (!resolved) return { parameterName: rule.parameterName, status: "MISSING", failureReason: "MISSING_REQUIRED_PARAMETER" };
      if (resolved.value !== rule.fixedValue) return { parameterName: rule.parameterName, status: "INVALID", failureReason: "INVALID_PARAMETER_VALUE" };
      return { parameterName: rule.parameterName, status: "READY" };
    }
    case "REQUIRED_CONDITIONAL": {
      const outcome = evaluateSkillCondition(rule.condition as SkillCondition<TFact>, facts);
      if (outcome === "UNKNOWN") return { parameterName: rule.parameterName, status: "NEEDS_INPUT", failureReason: "UNKNOWN_CONDITIONAL_PARAMETER" };
      if (outcome === "FALSE") return { parameterName: rule.parameterName, status: "READY" };
      if (!resolved) return { parameterName: rule.parameterName, status: "MISSING", failureReason: "MISSING_REQUIRED_PARAMETER" };
      return { parameterName: rule.parameterName, status: "READY" };
    }
    case "PROFESSIONAL_CHOICE": {
      if (!resolved) return { parameterName: rule.parameterName, status: "NEEDS_INPUT", failureReason: "MISSING_REQUIRED_PARAMETER" };
      const allowed = rule.allowedOptions ?? [];
      if (!allowed.includes(resolved.value)) return { parameterName: rule.parameterName, status: "INVALID", failureReason: "INVALID_PARAMETER_VALUE" };
      return { parameterName: rule.parameterName, status: "READY" };
    }
    case "NOT_APPLICABLE": {
      if (resolved) return { parameterName: rule.parameterName, status: "REJECTED", failureReason: "NOT_APPLICABLE_PARAMETER_SUPPLIED" };
      return { parameterName: rule.parameterName, status: "READY" };
    }
    case "CLIENT_DERIVED":
    case "UNDEFINED":
      // Part D's own explicit rule: no readiness impact either way.
      return { parameterName: rule.parameterName, status: "READY" };
  }
}

// ---------------------------------------------------------------------------
// Per-Execution-Unit rollup.
// ---------------------------------------------------------------------------

export const EXECUTION_UNIT_READINESS_VERDICTS = ["READY", "NEEDS_INPUT", "BLOCKED"] as const;
export type ExecutionUnitReadinessVerdict = (typeof EXECUTION_UNIT_READINESS_VERDICTS)[number];

export interface ExecutionUnitReadinessSummary {
  verdict: ExecutionUnitReadinessVerdict;
  gaps: readonly ParameterReadinessResult[];
}

const BLOCKING_STATUSES: readonly ParameterReadinessStatus[] = ["INVALID", "REJECTED"];

export function summarizeExecutionUnitReadiness<TFact extends string>(
  rules: readonly ExecutionUnitParameterRule<TFact>[],
  resolvedParameters: readonly PlannedExecutionParameter[],
  facts: SkillConditionFacts<TFact>,
): ExecutionUnitReadinessSummary {
  const results = evaluateExecutionUnitParameterReadiness(rules, resolvedParameters, facts);
  const gaps = results.filter((r) => r.status !== "READY");

  // A definite MISSING (REQUIRED_FIXED, or REQUIRED_CONDITIONAL whose
  // condition evaluated TRUE) is a hard blocker -- the unit cannot be
  // executed at all, not merely "needs a human answer".
  const hasHardMissing = gaps.some((g) => g.status === "MISSING");
  const hasInvalidOrRejected = gaps.some((g) => BLOCKING_STATUSES.includes(g.status));
  const hasNeedsInput = gaps.some((g) => g.status === "NEEDS_INPUT");

  if (hasHardMissing || hasInvalidOrRejected) return { verdict: "BLOCKED", gaps };
  if (hasNeedsInput) return { verdict: "NEEDS_INPUT", gaps };
  return { verdict: "READY", gaps };
}

// ---------------------------------------------------------------------------
// Plan-level readiness (Part B/M). Priority order, worst first: BLOCKED >
// NEEDS_INPUT > NEEDS_SKILL > PARTIAL > READY_FOR_PROFESSIONAL_REVIEW.
// Each of the 5 values is given a distinct, non-overlapping trigger:
//   BLOCKED               -- at least one planned unit has a hard defect.
//   NEEDS_INPUT            -- no defects, but at least one planned unit
//                             needs a human answer before it can proceed.
//   NEEDS_SKILL             -- every planned unit is itself fine, but the
//                             plan still carries at least one unresolved
//                             requirement (Part M -- e.g. the crown-
//                             weight-reduction delta: no registered skill
//                             declares the needed capability at all).
//   PARTIAL                -- every planned unit is fine and there is no
//                             missing-skill gap, but the plan's own
//                             coverage of its source Stage 5 proposal is
//                             incomplete for another reason (Part L -- a
//                             professional rejected an Execution Unit
//                             without a replacement).
//   READY_FOR_PROFESSIONAL_REVIEW -- none of the above.
// ---------------------------------------------------------------------------

export function computeProfessionalExecutionPlanReadiness(input: {
  unitVerdicts: readonly ExecutionUnitReadinessVerdict[];
  unresolvedRequirementCount: number;
  droppedProposedStepCount: number;
}): ProfessionalExecutionPlanReadiness {
  if (input.unitVerdicts.includes("BLOCKED")) return "BLOCKED";
  if (input.unitVerdicts.includes("NEEDS_INPUT")) return "NEEDS_INPUT";
  if (input.unresolvedRequirementCount > 0) return "NEEDS_SKILL";
  if (input.droppedProposedStepCount > 0) return "PARTIAL";
  return "READY_FOR_PROFESSIONAL_REVIEW";
}
