import { findCurrentConfirmedProposal } from "@/lib/proposal-repository";
import { PROPOSAL_VERTICALS } from "@/lib/proposal-validators";
import { ORCHESTRATOR_ACTION_REGISTRY, isOrchestratorActionAllowedForRole } from "@/lib/orchestrator-action-registry";
import type { ConciergePendingDecision, OrchestratorContext } from "@/lib/orchestrator-contracts";
import type { BareConfirmation } from "@/lib/orchestrator-confirmation-detector";
import type {
  OrchestrationPlan,
  OrchestrationPlanBlockingReason,
  OrchestrationPlanGoal,
  OrchestrationPlanStep,
  OrchestrationPlanStepStatus,
} from "@/lib/orchestrator-plan-contracts";

// AI Concierge / Orchestrator, Stage 5 -- the ONE place a real
// OrchestrationPlan is built (task section 6: "implement ONE strong
// professional flow first"). The step SEQUENCE below is 100%
// server-authored and fixed -- never AI-generated (task section 15's own
// list of what AI may/may not return; see orchestrator-service.ts's own
// header comment for why no "AI outputs an ordered step list" mechanism
// exists in this stage at all: with exactly one registered goal, a
// variable AI-authored sequence would be pure attack surface for zero
// benefit -- task section 4's own "the server decides each actual
// transition" is satisfied maximally by never letting AI output reach
// step/action territory in the first place).
//
// Every step's action is one of the EXISTING, already-registered
// OrchestratorActionId values (orchestrator-action-registry.ts) -- this
// function invents nothing; it re-derives requiresUserConsent/costClass
// straight from that SAME registry entry for each step's action (never
// independently decided), so a plan step can never claim a looser cost/
// consent policy than the real one. requiresProfessionalApproval is the
// one field this function enriches beyond the registry's own per-action
// value (which is always false for every navigate action today, since
// navigating itself never needs approval) -- see buildStep's own doc
// comment for exactly where and why.
//
// task section 5/14: EVERY step's status is derived FRESH from real,
// already-verified state on every call -- client/analysis existence
// (OrchestratorContext, already ownership-checked upstream), a real
// CONFIRMED "cutting" AnalysisProposal read (findCurrentConfirmedProposal,
// the SAME existing, already-tested repository function the rest of this
// app's Proposal domain already relies on), and the SAME
// hasCompletedPhotoPreview signal Stage 2 already established (still a
// per-turn, caller-supplied hint -- this function deliberately does NOT
// walk the TechnicalVisualMap/SpatialBinding/PhotoPreviewGeneration chain
// itself: doing so would mean reaching into the Spatial Mapping domain
// this stage is explicitly forbidden from touching (task section 20).
// Nothing here is ever remembered from a previous call -- DB truth always
// wins (task section 5/6), and a plan built from stale/forged context
// (an id that no longer resolves) collapses to the SAME safe, honest
// BLOCKED outcome a stale single decision already would.
export interface ResolveVisualizeResultPlanInput {
  ownerUserId: string;
  context: OrchestratorContext;
  pendingDecision: ConciergePendingDecision | null;
  confirmation: BareConfirmation | null;
}

export interface ResolveVisualizeResultPlanDependencies {
  findCurrentConfirmedProposal?: typeof findCurrentConfirmedProposal;
}

const CUTTING_VERTICAL = PROPOSAL_VERTICALS[0];

export async function resolveVisualizeResultPlan(
  input: ResolveVisualizeResultPlanInput,
  dependencies: ResolveVisualizeResultPlanDependencies = {},
): Promise<OrchestrationPlan> {
  const { ownerUserId, context, pendingDecision, confirmation } = input;
  const findProposal = dependencies.findCurrentConfirmedProposal ?? findCurrentConfirmedProposal;
  const goal: OrchestrationPlanGoal = "visualize_result";
  const planId = buildPlanId(goal, context.currentClientId);

  // Defense in depth (matches orchestrator-service.ts's own established
  // pattern): every action this plan ever uses is professional-only in
  // today's registry, so a non-professional role can never progress past
  // step 1 regardless -- checked here explicitly even though the ONLY
  // real caller (orchestrator-service.ts's buildDecision) already gates
  // plan-building on roleClass === "professional" before ever reaching
  // this function.
  if (!isOrchestratorActionAllowedForRole("OPEN_CLIENT", context.roleClass)) {
    const steps = [buildStep("open_client", "OPEN_CLIENT", "ACTIVE", "role_not_supported", [])];
    return { planId, goal, status: "BLOCKED", currentStepId: "open_client", steps };
  }

  // Step 1: OPEN_CLIENT.
  if (!context.currentClientId) {
    const steps = [buildStep("open_client", "OPEN_CLIENT", "ACTIVE", "no_client_resolved", [])];
    return { planId, goal, status: "BLOCKED", currentStepId: "open_client", steps };
  }
  const steps: OrchestrationPlanStep[] = [buildStep("open_client", "OPEN_CLIENT", "COMPLETED", null, [])];

  // Step 2: START_ANALYSIS ("ensure an analysis exists" -- task section 5's
  // own example: "If Analysis exists already: skip/reconcile
  // appropriately"). Never re-creates one that already exists.
  if (!context.currentAnalysisId) {
    steps.push(buildStep("ensure_analysis", "START_ANALYSIS", "ACTIVE", null, ["open_client"]));
    return { planId, goal, status: "ACTIVE", currentStepId: "ensure_analysis", steps };
  }
  steps.push(buildStep("ensure_analysis", "START_ANALYSIS", "SKIPPED", null, ["open_client"]));

  // Step 3: OPEN_ANALYSIS ("review the proposed look") -- gated on a
  // REAL, confirmed AnalysisProposal (task section 8: professional
  // approval stops the plan; task section 6: "do not fabricate a
  // Proposal or approval if the current system doesn't support automatic
  // creation in that state" -- this function never creates or confirms
  // one, it only reads whether one already exists).
  let proposalConfirmed = false;
  try {
    proposalConfirmed = (await findProposal(ownerUserId, context.currentClientId, CUTTING_VERTICAL)) !== null;
  } catch {
    // Fail closed: a read failure is NEVER treated as "approved" -- an
    // honest "still waiting for approval" is always the safe direction
    // here, never a false COMPLETED.
    proposalConfirmed = false;
  }

  if (!proposalConfirmed) {
    steps.push(
      buildStep("review_proposed_look", "OPEN_ANALYSIS", "ACTIVE", "awaiting_professional_approval", ["ensure_analysis"], {
        requiresProfessionalApproval: true,
      }),
    );
    return { planId, goal, status: "WAITING_FOR_APPROVAL", currentStepId: "review_proposed_look", steps };
  }
  steps.push(buildStep("review_proposed_look", "OPEN_ANALYSIS", "COMPLETED", null, ["ensure_analysis"], { requiresProfessionalApproval: true }));

  // Steps 4/5: OFFER_VIDEO -> REQUEST_VIDEO (task section 6, steps 7-10;
  // reuses the EXACT SAME OFFER_VIDEO/REQUEST_VIDEO policy and Stage
  // 2/4 pending-decision mechanism, completely unchanged -- this
  // function only ever DESCRIBES that same real decision as a step,
  // never re-implements or bypasses it).

  // Task section 6, step 8 / task section 18, test L: a bare "no"
  // completes the optional video branch -- zero Video calls, plan
  // finishes here.
  if (pendingDecision === "VIDEO_OFFER" && confirmation === "no") {
    steps.push(buildStep("offer_video", "OFFER_VIDEO", "COMPLETED", null, ["review_proposed_look"]));
    steps.push(buildStep("confirm_video", "REQUEST_VIDEO", "SKIPPED", null, ["offer_video"]));
    return { planId, goal, status: "COMPLETED", currentStepId: null, steps };
  }

  // Task section 6, step 9/10 / task section 9: a bare "yes" only ever
  // reaches WAITING_FOR_COST_CONFIRMATION -- the EXISTING Video UI's own
  // dialog is still what's needed to actually finish this step. The
  // planner never submits anything itself.
  if (pendingDecision === "VIDEO_OFFER" && confirmation === "yes") {
    steps.push(buildStep("offer_video", "OFFER_VIDEO", "COMPLETED", null, ["review_proposed_look"]));
    steps.push(
      buildStep("confirm_video", "REQUEST_VIDEO", "ACTIVE", "awaiting_cost_confirmation", ["offer_video"]),
    );
    return { planId, goal, status: "WAITING_FOR_COST_CONFIRMATION", currentStepId: "confirm_video", steps };
  }

  // Photo Preview not yet complete this turn (the SAME Stage 2 signal,
  // never independently re-derived -- see this file's own header
  // comment) -- an async-engine wait, task section 10.
  if (!context.hasCompletedPhotoPreview) {
    steps.push(buildStep("offer_video", "OFFER_VIDEO", "ACTIVE", "awaiting_photo_preview_completion", ["review_proposed_look"]));
    steps.push(buildStep("confirm_video", "REQUEST_VIDEO", "PENDING", null, ["offer_video"]));
    return { planId, goal, status: "WAITING_FOR_ENGINE", currentStepId: "offer_video", steps };
  }

  // Photo Preview complete, no answer yet -- the conversational offer
  // moment itself (task section 6, step 7).
  steps.push(buildStep("offer_video", "OFFER_VIDEO", "ACTIVE", "awaiting_user_confirmation", ["review_proposed_look"]));
  steps.push(buildStep("confirm_video", "REQUEST_VIDEO", "PENDING", null, ["offer_video"]));
  return { planId, goal, status: "WAITING_FOR_USER", currentStepId: "offer_video", steps };
}

// task section 11: cancellation stops FUTURE orchestration steps without
// pretending anything about already-running provider operations or
// erasing real progress -- applied as an overlay on top of a normally-
// resolved plan (never a separate, independently-computed "cancelled
// plan" that could disagree with real state), so `steps` still honestly
// reflects exactly what DB state showed a moment ago.
export function cancelPlan(plan: OrchestrationPlan): OrchestrationPlan {
  return { ...plan, status: "CANCELLED", currentStepId: null };
}

function buildPlanId(goal: OrchestrationPlanGoal, clientId: string | null): string {
  return `${goal}:${clientId ?? "none"}`;
}

function buildStep(
  stepId: string,
  action: OrchestrationPlanStep["action"],
  status: OrchestrationPlanStepStatus,
  blockingReason: OrchestrationPlanBlockingReason | null,
  dependsOn: string[],
  overrides: Partial<Pick<OrchestrationPlanStep, "requiresProfessionalApproval">> = {},
): OrchestrationPlanStep {
  const definition = ORCHESTRATOR_ACTION_REGISTRY[action];
  return {
    stepId,
    action,
    status,
    requiresContext: definition.requiresClientId,
    requiresProfessionalApproval: overrides.requiresProfessionalApproval ?? definition.requiresProfessionalApproval,
    requiresUserConsent: definition.requiresUserConsent,
    costClass: definition.costClass,
    blockingReason,
    dependsOn,
  };
}

