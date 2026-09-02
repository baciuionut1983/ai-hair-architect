import type { OrchestratorActionId, OrchestratorCostClass } from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 5 -- the typed, runtime-validated
// multi-step plan (task section 2). Deliberately a SEPARATE, ADDITIVE
// concept from OrchestratorDecision (orchestrator-contracts.ts), never
// merged into it: the existing decision contract (Stage 1-4, already
// depended on by every existing test/UI component) stays byte-for-byte
// unchanged. A plan is returned ALONGSIDE a decision (see
// orchestrator-service.ts's own resolveOrchestrationPlan and the route's
// `{ decision, plan }` response shape) -- it is a richer, PARALLEL view of
// the SAME underlying state, never a replacement for the single
// actionable recommendation that already drives the UI.
//
// PRODUCT PRINCIPLE (task section 4/6): "The planner suggests sequence.
// The server decides each actual transition." Nothing in this file is
// executable -- a plan is pure descriptive data, exactly like
// OrchestratorDecision itself. See orchestrator-plan-service.ts for the
// ONE place a plan is actually built (100% server-authored, deterministic
// step sequence -- never AI-generated, see that file's own header
// comment for why).

// Only one registered goal exists in Stage 5 (task section 6: "implement
// ONE strong professional flow first") -- the "see the proposed result,
// optionally with a video" journey. Adding a second goal later means
// adding it here AND to orchestrator-plan-service.ts's own registry --
// never an arbitrary string.
export type OrchestrationPlanGoal = "visualize_result";

const ORCHESTRATION_PLAN_GOALS: readonly OrchestrationPlanGoal[] = ["visualize_result"];

export function isOrchestrationPlanGoal(value: unknown): value is OrchestrationPlanGoal {
  return typeof value === "string" && (ORCHESTRATION_PLAN_GOALS as readonly string[]).includes(value);
}

// task section 7's own named list, plus WAITING_FOR_COST_CONFIRMATION
// (task section 9's own example: "If accepted: -> WAITING_FOR_COST_CONFIRMATION")
// -- distinct from the generic WAITING_FOR_USER because it represents a
// materially different moment: WAITING_FOR_USER is "a simple yes/no
// question is open"; WAITING_FOR_COST_CONFIRMATION is "the user already
// said yes conversationally, and only the EXISTING Video cost dialog can
// finish this" (task section 9/13's own "never manufacture cost
// consent"). PLANNED is kept for fidelity to task section 7's own list
// even though this stage's own synchronous, stateless implementation
// always evaluates a plan immediately (see orchestrator-plan-service.ts) --
// no external caller ever observes PLANNED today; it is reserved for a
// hypothetical future asynchronous planning step.
export type OrchestrationPlanStatus =
  | "PLANNED"
  | "ACTIVE"
  | "WAITING_FOR_USER"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_ENGINE"
  | "WAITING_FOR_COST_CONFIRMATION"
  | "COMPLETED"
  | "BLOCKED"
  | "CANCELLED";

const ORCHESTRATION_PLAN_STATUSES: readonly OrchestrationPlanStatus[] = [
  "PLANNED",
  "ACTIVE",
  "WAITING_FOR_USER",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_ENGINE",
  "WAITING_FOR_COST_CONFIRMATION",
  "COMPLETED",
  "BLOCKED",
  "CANCELLED",
];

function isOrchestrationPlanStatus(value: unknown): value is OrchestrationPlanStatus {
  return typeof value === "string" && (ORCHESTRATION_PLAN_STATUSES as readonly string[]).includes(value);
}

// Deliberately a SMALLER vocabulary than the plan-level status -- a step
// is either not reached yet, the current focus, already satisfied (for
// real, or because DB state already showed it done -- "SKIPPED"), or
// unable to proceed ("BLOCKED", with the REASON carried on the step
// itself via blockingReason, never re-encoded into more step statuses).
export type OrchestrationPlanStepStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "BLOCKED";

const ORCHESTRATION_PLAN_STEP_STATUSES: readonly OrchestrationPlanStepStatus[] = ["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "BLOCKED"];

function isOrchestrationPlanStepStatus(value: unknown): value is OrchestrationPlanStepStatus {
  return typeof value === "string" && (ORCHESTRATION_PLAN_STEP_STATUSES as readonly string[]).includes(value);
}

// WHY the current step can't progress automatically -- a closed,
// machine-readable vocabulary (task section 8/9's own required
// invariants, made structurally checkable). Never a free-text reason.
export type OrchestrationPlanBlockingReason =
  | "no_client_resolved"
  | "role_not_supported"
  | "awaiting_professional_approval"
  | "awaiting_photo_preview_completion"
  | "awaiting_user_confirmation"
  | "awaiting_cost_confirmation";

const ORCHESTRATION_PLAN_BLOCKING_REASONS: readonly OrchestrationPlanBlockingReason[] = [
  "no_client_resolved",
  "role_not_supported",
  "awaiting_professional_approval",
  "awaiting_photo_preview_completion",
  "awaiting_user_confirmation",
  "awaiting_cost_confirmation",
];

function isOrchestrationPlanBlockingReason(value: unknown): value is OrchestrationPlanBlockingReason {
  return typeof value === "string" && (ORCHESTRATION_PLAN_BLOCKING_REASONS as readonly string[]).includes(value);
}

// task section 2/3: "Each step should reference ONLY a registered
// capability/action... Do not use free-form executable strings." `action`
// is typed as the SAME OrchestratorActionId the existing action registry
// already validates (orchestrator-action-registry.ts) -- there is no
// separate plan-action vocabulary a planner could diverge from the real
// one. requiresProfessionalApproval/requiresUserConsent/costClass are
// copied straight from that SAME registry entry for `action` (never
// independently decided here), so a plan step can never claim a looser
// policy than the registry's own real one.
export interface OrchestrationPlanStep {
  stepId: string;
  action: OrchestratorActionId;
  status: OrchestrationPlanStepStatus;
  requiresContext: boolean;
  requiresProfessionalApproval: boolean;
  requiresUserConsent: boolean;
  costClass: OrchestratorCostClass;
  blockingReason: OrchestrationPlanBlockingReason | null;
  dependsOn: string[];
}

export interface OrchestrationPlan {
  // NOT a database identity (task section 13: no new persistence) -- a
  // stable, deterministic label for this exact (goal, client) pairing,
  // recomputed identically every time the same goal is resolved for the
  // same client. See orchestrator-plan-service.ts's own buildPlanId.
  planId: string;
  goal: OrchestrationPlanGoal;
  status: OrchestrationPlanStatus;
  currentStepId: string | null;
  steps: OrchestrationPlanStep[];
}

function isOrchestratorActionIdLike(value: unknown): value is OrchestratorActionId {
  // Deliberately does not import isOrchestratorActionId from
  // orchestrator-action-registry.ts (which would create a dependency
  // cycle -- that module already imports FROM orchestrator-contracts.ts,
  // which this file does not touch, but keeping this file's own
  // dependency graph shallow and one-directional matters more than
  // reusing one line). The real allowlist this validates against still
  // lives in exactly one place: ORCHESTRATOR_ACTION_ID_VALUES below is
  // kept in sync with OrchestratorActionId by
  // orchestrator-plan-contracts.test.ts's own exhaustiveness check.
  return typeof value === "string" && (ORCHESTRATOR_ACTION_ID_VALUES as readonly string[]).includes(value);
}

const ORCHESTRATOR_ACTION_ID_VALUES: readonly OrchestratorActionId[] = [
  "OPEN_CLIENTS",
  "OPEN_CLIENT",
  "START_ANALYSIS",
  "OPEN_ANALYSIS",
  "OFFER_VIDEO",
  "REQUEST_VIDEO",
];

const ORCHESTRATOR_COST_CLASS_VALUES: readonly OrchestratorCostClass[] = ["NO_INCREMENTAL_COST", "LOW_COST", "MEANINGFUL_COST"];

function isOrchestratorCostClassLike(value: unknown): value is OrchestratorCostClass {
  return typeof value === "string" && (ORCHESTRATOR_COST_CLASS_VALUES as readonly string[]).includes(value);
}

function isOrchestrationPlanStep(value: unknown): value is OrchestrationPlanStep {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.stepId !== "string" || candidate.stepId.length === 0) return false;
  if (!isOrchestratorActionIdLike(candidate.action)) return false;
  if (!isOrchestrationPlanStepStatus(candidate.status)) return false;
  if (typeof candidate.requiresContext !== "boolean") return false;
  if (typeof candidate.requiresProfessionalApproval !== "boolean") return false;
  if (typeof candidate.requiresUserConsent !== "boolean") return false;
  if (!isOrchestratorCostClassLike(candidate.costClass)) return false;
  if (candidate.blockingReason !== null && !isOrchestrationPlanBlockingReason(candidate.blockingReason)) return false;
  if (!Array.isArray(candidate.dependsOn) || !candidate.dependsOn.every((id) => typeof id === "string")) return false;
  return true;
}

// The runtime boundary (task section 2/3, mirrors isOrchestratorDecision's
// own role exactly): every plan this codebase ever hands to an API
// response passes through this guard. In this stage a plan is always
// built by our own deterministic code (orchestrator-plan-service.ts), so
// this can never actually fail today -- but it is the exact seam any
// future planner enhancement must also pass through, unchanged, and test
// coverage exercises it for real rather than assuming it.
export function isOrchestrationPlan(value: unknown): value is OrchestrationPlan {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.planId !== "string" || candidate.planId.length === 0) return false;
  if (!isOrchestrationPlanGoal(candidate.goal)) return false;
  if (!isOrchestrationPlanStatus(candidate.status)) return false;
  if (candidate.currentStepId !== null && typeof candidate.currentStepId !== "string") return false;
  if (!Array.isArray(candidate.steps) || !candidate.steps.every(isOrchestrationPlanStep)) return false;
  // currentStepId, when non-null, must reference a real step in this
  // exact plan -- never a dangling/invented id.
  if (candidate.currentStepId !== null && !(candidate.steps as OrchestrationPlanStep[]).some((step) => step.stepId === candidate.currentStepId)) {
    return false;
  }
  return true;
}
