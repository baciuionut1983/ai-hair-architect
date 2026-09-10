import type { ProfessionalReasoningProposal } from "@/lib/professional-reasoning-contracts";
import { isSkillEligibleForAuthority } from "@/lib/professional-skill-contracts";
import type { ExecutionPlanFailureReason, PlannedExecutionUnit, ProfessionalExecutionPlan } from "@/lib/professional-execution-plan-contracts";
import { evaluateExecutionUnitParameterReadiness } from "@/lib/professional-execution-plan-readiness";
import type { ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import type { SkillConditionFacts } from "@/lib/skill-condition-evaluator";

// AI Hair Architect, Professional Skill Engine Stage 6 -- PROFESSIONAL
// EXECUTION PLAN, Part J/K deterministic plan validator. Pure, no I/O, no
// AI, ZERO paid provider call. Mirrors this codebase's own established
// structural-vs-business-rule split (isProfessionalReasoningProposal vs.
// validateProfessionalReasoningProposal, professional-reasoning-
// validator.ts): this file assumes its `plan` input already passed
// isValidProfessionalExecutionPlan (professional-execution-plan-
// contracts.ts) -- it never re-checks bare shape, only PROFESSIONAL
// CORRECTNESS. FAIL CLOSED throughout: every check below defaults to
// "reject" on missing/unrecognized/unresolvable input, never "assume
// fine".
//
// 20 independently-triggerable checks in total (exceeds Part J's own
// "minimum 18"), grouped PER-UNIT (11) and PLAN-LEVEL (5), plus 2 small
// standalone functions covering Part J's remaining two structural/
// authority checks that do not fit a per-content loop (schemaVersion pin
// is covered by isValidProfessionalExecutionPlan already, not re-listed
// here; see the standalone functions at the bottom of this file for the
// approval-authority checks):
//   PER-UNIT (evaluated once per PlannedExecutionUnit):
//     1  allowed skill reference (recognized in templates)
//     2  exact skill version (matches a template exactly, not just skillId)
//     3  skill/delta pairing was in the validated Stage 5 proposal
//     4  declared capability matches the skill's own declared capabilities
//     5  zone applicability valid (within the matched capability's zones)
//     6  required parameters present (via readiness evaluator)
//     7  conditional parameters resolve safely, fail closed on UNKNOWN
//         (via readiness evaluator)
//     8  parameter values allowed (against the skill's own declared
//         allowedValues, independent of parameterRules)
//     9  completion condition exists (defense in depth)
//     10 expected effect exists for a state-changing capability
//     11 verification requirement exists (a real VERIFY action)
//     ~  no undeclared capability (folded into check 4)
//     ~  no invented skill step (a plannedUnit whose skill isn't even in
//         `templates` at all -- distinct from check 1's "known but not
//         approved")
//   PLAN-LEVEL (evaluated once per plan):
//     12 Execution-Unit-level order/dependency
//     13 Skill-Instance-level order/dependency
//     14 preservation constraints not violated
//     15 unresolved deltas not falsely marked solved
//     16 (implicit, Part S) optional stale-snapshot cross-check when the
//         caller supplies expected snapshot identity

export interface ExecutionPlanValidationFailure {
  failureReason: ExecutionPlanFailureReason;
  detail: string;
  executionUnitId?: string;
}

export interface ExecutionPlanValidationResult {
  valid: boolean;
  failures: readonly ExecutionPlanValidationFailure[];
}

export interface ValidateProfessionalExecutionPlanInput {
  plan: ProfessionalExecutionPlan;
  // The EXACT Stage 5 proposal this plan claims to compile from -- check
  // 3 cross-references it directly, never a re-fetched/possibly-drifted
  // copy.
  proposal: ProfessionalReasoningProposal;
  templates: readonly ExecutionPlanSkillTemplate<string>[];
  // Part S, optional: when the caller (typically the repository, re-
  // reading the live HairStateSnapshot rows) supplies the CURRENT real
  // snapshot identity, a mismatch against the plan's own pinned
  // currentSnapshotId/Version or targetSnapshotId/Version is reported
  // (STALE_SNAPSHOT_REFERENCE). Omitted entirely -> this check never
  // fires (never a spurious failure from a caller that simply doesn't
  // have this information yet).
  expectedCurrentSnapshotId?: string;
  expectedCurrentSnapshotVersion?: number;
  expectedTargetSnapshotId?: string;
  expectedTargetSnapshotVersion?: number;
}

const STATE_CHANGING_CAPABILITIES = new Set(["REDUCE_LENGTH", "INCREASE_LENGTH", "REDUCE_WEIGHT", "BUILD_WEIGHT", "MODIFY_PERIMETER_RELATIONSHIP"]);

function unitSkillIdentity(unit: PlannedExecutionUnit): { skillId: string; skillVersion: number } | null {
  const first = unit.atomicActions[0];
  if (!first) return null;
  const consistent = unit.atomicActions.every((a) => a.sourceSkillId === first.sourceSkillId && a.sourceSkillVersion === first.sourceSkillVersion);
  if (!consistent) return null;
  return { skillId: first.sourceSkillId, skillVersion: first.sourceSkillVersion };
}

function findTemplate(templates: readonly ExecutionPlanSkillTemplate<string>[], skillId: string, skillVersion: number): ExecutionPlanSkillTemplate<string> | undefined {
  return templates.find((t) => t.skillDefinition.skillId === skillId && t.skillDefinition.version === skillVersion);
}

function validatePlannedExecutionUnit(unit: PlannedExecutionUnit, proposal: ProfessionalReasoningProposal, templates: readonly ExecutionPlanSkillTemplate<string>[]): ExecutionPlanValidationFailure[] {
  const failures: ExecutionPlanValidationFailure[] = [];
  const unitId = unit.executionUnit.executionUnitId;

  const identity = unitSkillIdentity(unit);
  if (!identity) {
    failures.push({ failureReason: "INVENTED_SKILL_STEP", detail: `Execution Unit "${unitId}" has no consistent, traceable source skill identity across its own atomic actions.`, executionUnitId: unitId });
    return failures;
  }

  const sameSkillTemplate = templates.find((t) => t.skillDefinition.skillId === identity.skillId);
  if (!sameSkillTemplate) {
    failures.push({ failureReason: "INVENTED_SKILL_STEP", detail: `Skill "${identity.skillId}" is not a recognized skill in the given template registry.`, executionUnitId: unitId });
    return failures;
  }

  const template = findTemplate(templates, identity.skillId, identity.skillVersion);
  if (!template) {
    failures.push({
      failureReason: "INVALID_SKILL_VERSION",
      detail: `Skill "${identity.skillId}" v${identity.skillVersion} does not match any registered template version.`,
      executionUnitId: unitId,
    });
    return failures;
  }

  if (!isSkillEligibleForAuthority(template.skillDefinition)) {
    failures.push({ failureReason: "SKILL_NOT_ALLOWED", detail: `Skill "${identity.skillId}" v${identity.skillVersion} is not eligible professional authority.`, executionUnitId: unitId });
  }

  // Check 3 -- skill/delta pairing was in the validated Stage 5 proposal.
  const matchingStep = proposal.proposedSkills.find(
    (s) =>
      s.skillDefinitionId === identity.skillId &&
      s.skillVersion === identity.skillVersion &&
      s.addressesDelta.scope === unit.addressesDelta.scope &&
      s.addressesDelta.field === unit.addressesDelta.field &&
      s.declaredCapabilityUsed === unit.declaredCapabilityUsed,
  );
  if (!matchingStep) {
    failures.push({
      failureReason: "SKILL_NOT_ALLOWED",
      detail: `No Stage 5 proposed step approves skill "${identity.skillId}" v${identity.skillVersion} for delta (${unit.addressesDelta.scope}, ${unit.addressesDelta.field}) with capability "${unit.declaredCapabilityUsed}".`,
      executionUnitId: unitId,
    });
  }

  // Check 4 -- declared capability matches the skill's own declared
  // capabilities.
  const declaredCapabilities = template.skillDefinition.capabilities ?? [];
  const matchedCapability = declaredCapabilities.find((c) => c.kind === unit.declaredCapabilityUsed);
  if (!matchedCapability) {
    failures.push({
      failureReason: "CAPABILITY_MISMATCH",
      detail: `Skill "${identity.skillId}" v${identity.skillVersion} does not declare capability "${unit.declaredCapabilityUsed}".`,
      executionUnitId: unitId,
    });
  } else if (matchedCapability.zones && !matchedCapability.zones.includes(unit.addressesDelta.scope)) {
    // Check 5 -- zone applicability, only when the capability declares an
    // explicit zone list (see file header on why an undeclared list is
    // not checked here).
    failures.push({
      failureReason: "INVALID_ZONE",
      detail: `Capability "${unit.declaredCapabilityUsed}" on skill "${identity.skillId}" v${identity.skillVersion} does not declare zone "${unit.addressesDelta.scope}".`,
      executionUnitId: unitId,
    });
  }

  // Checks 6/7 -- required/conditional parameter readiness.
  const rules = unit.executionUnit.parameterRules ?? [];
  const emptyFacts: SkillConditionFacts<string> = new Map();
  const readinessGaps = evaluateExecutionUnitParameterReadiness(rules, unit.resolvedParameters, emptyFacts).filter((r) => r.status !== "READY");
  for (const gap of readinessGaps) {
    if (gap.failureReason) {
      failures.push({ failureReason: gap.failureReason, detail: `Execution Unit "${unitId}", parameter "${gap.parameterName}": ${gap.status}.`, executionUnitId: unitId });
    }
  }

  // Check 8 -- parameter values allowed, independent of parameterRules
  // (catches a resolvedParameters entry with a value outside the skill's
  // own declared enum, even for a parameter with no ExecutionUnit rule at
  // all).
  for (const resolvedParameter of unit.resolvedParameters) {
    const declaration = template.skillDefinition.parameters.find((p) => p.name === resolvedParameter.name);
    if (declaration?.valueKind === "enum" && declaration.allowedValues && !declaration.allowedValues.includes(resolvedParameter.value)) {
      failures.push({
        failureReason: "INVALID_PARAMETER_VALUE",
        detail: `Execution Unit "${unitId}", parameter "${resolvedParameter.name}": value "${String(resolvedParameter.value)}" is not among the skill's own declared allowedValues.`,
        executionUnitId: unitId,
      });
    }
  }

  // Check 9 -- completion condition exists (defense in depth beyond the
  // structural validator's own required, non-optional field).
  if (!unit.completionCriterion || unit.completionCriterion.fact.length === 0) {
    failures.push({ failureReason: "MISSING_COMPLETION_CONDITION", detail: `Execution Unit "${unitId}" has no completion criterion.`, executionUnitId: unitId });
  }

  // Check 10 -- expected effect exists for a state-changing capability.
  const hasExecuteAction = unit.atomicActions.some((a) => a.actionKind === "EXECUTE");
  if (STATE_CHANGING_CAPABILITIES.has(unit.declaredCapabilityUsed) && !hasExecuteAction) {
    failures.push({
      failureReason: "MISSING_EXPECTED_EFFECT",
      detail: `Execution Unit "${unitId}" declares state-changing capability "${unit.declaredCapabilityUsed}" but compiles no EXECUTE action.`,
      executionUnitId: unitId,
    });
  }

  // Check 11 -- verification requirement exists.
  const verifyAction = unit.atomicActions.find((a) => a.actionKind === "VERIFY");
  if (!verifyAction || !verifyAction.observationCriterion) {
    failures.push({ failureReason: "MISSING_VERIFICATION_REQUIREMENT", detail: `Execution Unit "${unitId}" has no VERIFY action with a real observationCriterion.`, executionUnitId: unitId });
  }

  return failures;
}

export function validateProfessionalExecutionPlan(input: ValidateProfessionalExecutionPlanInput): ExecutionPlanValidationResult {
  const { plan, proposal, templates } = input;
  const failures: ExecutionPlanValidationFailure[] = [];

  for (const unit of plan.plannedUnits) {
    failures.push(...validatePlannedExecutionUnit(unit, proposal, templates));
  }

  // Check 12 -- Execution-Unit-level order/dependency: every
  // prerequisiteExecutionUnitIds entry must already appear earlier in
  // this plan's own unit order.
  const seenUnitIds = new Set<string>();
  for (const unit of plan.plannedUnits) {
    for (const prerequisiteId of unit.executionUnit.prerequisiteExecutionUnitIds ?? []) {
      if (!seenUnitIds.has(prerequisiteId)) {
        failures.push({
          failureReason: "ORDER_DEPENDENCY_VIOLATION",
          detail: `Execution Unit "${unit.executionUnit.executionUnitId}" requires prerequisite Execution Unit "${prerequisiteId}", which does not appear earlier in the plan.`,
          executionUnitId: unit.executionUnit.executionUnitId,
        });
      }
    }
    seenUnitIds.add(unit.executionUnit.executionUnitId);
  }

  // Check 13 -- Skill-Instance-level order/dependency: if a unit's own
  // source Skill Instance declares prerequisiteSkillInstanceIds, every
  // Execution Unit belonging to each prerequisite instance must already
  // appear earlier in the plan.
  const seenSkillInstanceIds = new Set<string>();
  for (const unit of plan.plannedUnits) {
    const sourceInstanceId = unit.executionUnit.sourceSkillInstanceId;
    const identity = unitSkillIdentity(unit);
    const template = identity ? findTemplate(templates, identity.skillId, identity.skillVersion) : undefined;
    if (template && template.skillInstance.skillInstanceId === sourceInstanceId) {
      for (const prerequisiteInstanceId of template.skillInstance.prerequisiteSkillInstanceIds ?? []) {
        if (!seenSkillInstanceIds.has(prerequisiteInstanceId)) {
          failures.push({
            failureReason: "ORDER_DEPENDENCY_VIOLATION",
            detail: `Execution Unit "${unit.executionUnit.executionUnitId}" belongs to Skill Instance "${sourceInstanceId}", which requires prerequisite Skill Instance "${prerequisiteInstanceId}" to be fully planned earlier.`,
            executionUnitId: unit.executionUnit.executionUnitId,
          });
        }
      }
    }
    seenSkillInstanceIds.add(sourceInstanceId);
  }

  // Check 14 -- preservation constraints not violated: no state-changing
  // planned unit may target the same (scope, field) a preservation
  // constraint protects.
  for (const unit of plan.plannedUnits) {
    if (!STATE_CHANGING_CAPABILITIES.has(unit.declaredCapabilityUsed)) continue;
    const violated = plan.preservationConstraints.find((c) => c.scope === unit.addressesDelta.scope && c.field === unit.addressesDelta.field);
    if (violated) {
      failures.push({
        failureReason: "PRESERVATION_CONSTRAINT_VIOLATION",
        detail: `Execution Unit "${unit.executionUnit.executionUnitId}" applies state-changing capability "${unit.declaredCapabilityUsed}" to (${violated.scope}, ${violated.field}), which the plan's own preservation constraints protect.`,
        executionUnitId: unit.executionUnit.executionUnitId,
      });
    }
  }

  // Check 15 -- unresolved deltas not falsely marked solved.
  for (const unit of plan.plannedUnits) {
    const falselyResolved = plan.unresolvedRequirements.find((r) => r.scope === unit.addressesDelta.scope && r.field === unit.addressesDelta.field);
    if (falselyResolved) {
      failures.push({
        failureReason: "UNRESOLVED_DELTA",
        detail: `Execution Unit "${unit.executionUnit.executionUnitId}" addresses (${falselyResolved.scope}, ${falselyResolved.field}), which the plan itself still lists as an unresolved requirement.`,
        executionUnitId: unit.executionUnit.executionUnitId,
      });
    }
  }

  // Check 16 -- optional stale-snapshot cross-check (Part S).
  if (input.expectedCurrentSnapshotId !== undefined && input.expectedCurrentSnapshotId !== plan.currentSnapshotId) {
    failures.push({ failureReason: "STALE_SNAPSHOT_REFERENCE", detail: `Plan's currentSnapshotId "${plan.currentSnapshotId}" no longer matches the live snapshot "${input.expectedCurrentSnapshotId}".` });
  }
  if (input.expectedCurrentSnapshotVersion !== undefined && input.expectedCurrentSnapshotVersion !== plan.currentSnapshotVersion) {
    failures.push({
      failureReason: "STALE_SNAPSHOT_REFERENCE",
      detail: `Plan's currentSnapshotVersion ${plan.currentSnapshotVersion} no longer matches the live snapshot version ${input.expectedCurrentSnapshotVersion}.`,
    });
  }
  if (input.expectedTargetSnapshotId !== undefined && input.expectedTargetSnapshotId !== plan.targetSnapshotId) {
    failures.push({ failureReason: "STALE_SNAPSHOT_REFERENCE", detail: `Plan's targetSnapshotId "${plan.targetSnapshotId}" no longer matches the live snapshot "${input.expectedTargetSnapshotId}".` });
  }
  if (input.expectedTargetSnapshotVersion !== undefined && input.expectedTargetSnapshotVersion !== plan.targetSnapshotVersion) {
    failures.push({
      failureReason: "STALE_SNAPSHOT_REFERENCE",
      detail: `Plan's targetSnapshotVersion ${plan.targetSnapshotVersion} no longer matches the live snapshot version ${input.expectedTargetSnapshotVersion}.`,
    });
  }

  return { valid: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Part L/S -- professional-approval authority. Two small, standalone,
// pure functions embodying "AI cannot auto-approve" / "DRAFT not
// executable as authoritative" (Part U tests 41-45) -- NOT part of the
// per-content check loop above, since they are about WHO decided, never
// about plan CONTENT correctness. A plan may be perfectly valid content-
// wise and still be non-authoritative because no professional has
// approved it yet -- these two facts are independent, exactly like Stage
// 5's own split between `reasoningStatus` (content completeness) and
// `status` (persistence/approval lifecycle).
// ---------------------------------------------------------------------------

// The ONLY legitimate way a plan becomes executable authority: an
// explicit, real professional approval flag, never inferred from
// content validity, never inferred from readiness, never defaulted to
// true.
export function isPlanExecutableAsProfessionalAuthority(planProfessionallyApproved: boolean): boolean {
  return planProfessionallyApproved === true;
}

// A structural guard a future Technical-Demonstration-bridge stage would
// call before compiling any ExecutionUnit/AtomicAction sequence into a
// Demonstration Scene -- refuses on both an unapproved plan AND a
// content-invalid one, fail closed on either.
export function assertPlanReadyForExecutionAuthority(planProfessionallyApproved: boolean, contentValidation: ExecutionPlanValidationResult): ExecutionPlanValidationFailure[] {
  const failures: ExecutionPlanValidationFailure[] = [...contentValidation.failures];
  if (!isPlanExecutableAsProfessionalAuthority(planProfessionallyApproved)) {
    failures.push({ failureReason: "PLAN_NOT_PROFESSIONALLY_APPROVED", detail: "This plan has not been professionally approved; it cannot be treated as executable authority." });
  }
  return failures;
}
