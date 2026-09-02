import { findClientForOwner, listClientsForOwner } from "@/lib/client-repository";
import { findAnalysisForOwner } from "@/lib/analysis-repository";
import {
  classifyOrchestratorIntentHybrid,
  type ConciergeClassifierSource,
  type HybridClassifierDependencies,
} from "@/lib/orchestrator-hybrid-classifier";
import { detectBareConfirmation } from "@/lib/orchestrator-confirmation-detector";
import { detectCancellationRequest } from "@/lib/orchestrator-cancellation-detector";
import { extractCandidateClientName, matchClientNameCandidates } from "@/lib/orchestrator-client-name-resolver";
import { resolveWorkflowStage } from "@/lib/orchestrator-workflow-stage";
import { isOrchestratorActionAllowedForRole, ORCHESTRATOR_ACTION_REGISTRY } from "@/lib/orchestrator-action-registry";
import {
  cancelPlan,
  resolveVisualizeResultPlan,
  type ResolveVisualizeResultPlanDependencies,
} from "@/lib/orchestrator-plan-service";
import { isOrchestrationPlan, isOrchestrationPlanGoal, type OrchestrationPlan, type OrchestrationPlanGoal } from "@/lib/orchestrator-plan-contracts";
import {
  isConciergePendingDecision,
  isOrchestratorDecision,
  type ConciergePendingDecision,
  type OrchestratorActionId,
  type OrchestratorClientCandidate,
  type OrchestratorContext,
  type OrchestratorDecision,
  type OrchestratorIntent,
  type OrchestratorReasonCode,
  type OrchestratorRoleClass,
} from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 1 -- the service layer. This is the
// ONLY place that touches the database or trusts caller-supplied ids; the
// contracts and action-registry modules are pure. Mirrors
// video-generation-execution-service.ts's own dependency-injection shape
// (every real lookup is injectable, defaulting to the real implementation)
// so tests can prove behavior against a real, owner-scoped repository call
// without needing a live HTTP session.
//
// SECURITY (task section 11): currentClientId/currentAnalysisId are never
// trusted merely because a caller (UI, or eventually a model) supplied
// them. Both are re-resolved here through the EXISTING, already-tested,
// owner-scoped repository functions every other feature in this codebase
// already relies on for the same guarantee (findClientForOwner,
// findAnalysisForOwner) -- a forged or foreign id silently resolves to
// "not present" rather than ever appearing in the returned decision or
// being leaked back to the caller as "found but not yours".

export interface ResolveOrchestratorDecisionInput {
  // Stage 2: optional. A caller with a genuine free-text goal ("show me
  // the result") sends one; the NEW system-triggered check (a real,
  // server-verified COMPLETED Photo Preview) sends none at all -- there is
  // no user utterance to classify, and inventing a fake one just to
  // satisfy a "message required" rule would make CONCIERGE_ORCHESTRATION's
  // own observability dishonest (see logOrchestratorDecision's own
  // `trigger` field below, which distinguishes the two cases for real).
  message?: string;
  roleClass: OrchestratorRoleClass;
  ownerUserId: string;
  currentClientId?: string | null;
  currentAnalysisId?: string | null;
  hasCompletedPhotoPreview?: boolean;
  // Stage 4 (task section 3): a client-remembered hint of what
  // presentational question was last asked -- e.g. after a decision with
  // recommendedAction "OFFER_VIDEO", the caller may remember
  // "VIDEO_OFFER" and echo it back on the NEXT turn so a bare "Da"/"Nu"
  // can be interpreted correctly. Raw/untrusted (any string, or garbage) --
  // validated by isConciergePendingDecision inside buildDecision, and
  // even once validated, NEVER treated as authority: see this file's own
  // header comment and orchestrator-contracts.ts's own doc comment on
  // ConciergePendingDecision.
  pendingDecision?: string | null;
  // Stage 5 (task section 2/13): a client-remembered hint of which
  // OrchestrationPlanGoal (if any) is still being tracked -- e.g. once a
  // decision comes back with a non-null `plan`, the caller may remember
  // `plan.goal` and echo it back so the SAME plan keeps being resolved
  // (freshly, from real state -- see orchestrator-plan-service.ts) even
  // on a turn whose own message doesn't itself re-trigger it. Raw/
  // untrusted, validated by isOrchestrationPlanGoal inside buildDecision;
  // never authority -- the plan it produces is recomputed from real DB
  // state every time, never assumed to still be accurate.
  activePlanGoal?: string | null;
}

export interface ResolveOrchestratorDecisionDependencies {
  findClientForOwner?: typeof findClientForOwner;
  findAnalysisForOwner?: typeof findAnalysisForOwner;
  // Production Fix #1 (client name resolution): the ONLY repository read
  // the name-candidate resolver ever needs -- see this file's own
  // resolveClientNameForMessage below. Same injection convention as every
  // other real lookup in this dependencies bag.
  listClientsForOwner?: typeof listClientsForOwner;
  // Stage 3: replaces the old, never-externally-used `classifyIntent`
  // hook. Tests inject the full hybrid pipeline directly (real messages
  // resolve deterministically with zero AI dependency in every existing
  // Stage 1/2 test -- see classifyOrchestratorIntentHybrid's own header
  // comment) or inject `aiClassifierDependencies` below to reach the AI
  // path specifically (fake provider, fake env) without needing a real
  // network call.
  classifyIntentHybrid?: typeof classifyOrchestratorIntentHybrid;
  aiClassifierDependencies?: HybridClassifierDependencies;
  // Stage 5: reaches resolveVisualizeResultPlan's own
  // findCurrentConfirmedProposal injection, so a plan-triggering test can
  // fake the Proposal read without needing a real Postgres fixture.
  planDependencies?: ResolveVisualizeResultPlanDependencies;
}

// Stage 5: the plan-aware entry point (used by the HTTP route). Shares
// buildDecision's own single evaluation with resolveOrchestratorDecision
// below -- never a second, independently-computed path that could
// disagree with it.
export async function resolveOrchestratorDecisionAndPlan(
  input: ResolveOrchestratorDecisionInput,
  dependencies: ResolveOrchestratorDecisionDependencies = {},
): Promise<{ decision: OrchestratorDecision; plan: OrchestrationPlan | null }> {
  const startedAt = Date.now();
  const { decision, plan, pendingDecision, classifierSource } = await buildDecision(input, dependencies);
  logOrchestratorDecision(input, decision, plan, pendingDecision, classifierSource, Date.now() - startedAt);
  return { decision, plan };
}

// Stage 1-4's own entry point, UNCHANGED in signature and observable
// decision output -- every existing caller/test keeps working exactly as
// before. Internally now also resolves the Stage 5 plan (for logging/
// consistency -- see resolveOrchestratorDecisionAndPlan above), but never
// returns it here.
export async function resolveOrchestratorDecision(
  input: ResolveOrchestratorDecisionInput,
  dependencies: ResolveOrchestratorDecisionDependencies = {},
): Promise<OrchestratorDecision> {
  const { decision } = await resolveOrchestratorDecisionAndPlan(input, dependencies);
  return decision;
}

async function buildDecision(
  input: ResolveOrchestratorDecisionInput,
  dependencies: ResolveOrchestratorDecisionDependencies,
): Promise<{
  decision: OrchestratorDecision;
  plan: OrchestrationPlan | null;
  pendingDecision: ConciergePendingDecision | null;
  classifierSource: ConciergeClassifierSource | null;
}> {
  const resolveClient = dependencies.findClientForOwner ?? findClientForOwner;
  const resolveAnalysis = dependencies.findAnalysisForOwner ?? findAnalysisForOwner;
  const listClients = dependencies.listClientsForOwner ?? listClientsForOwner;
  const classifyHybrid = dependencies.classifyIntentHybrid ?? classifyOrchestratorIntentHybrid;

  // Re-verify ownership -- never trust the caller's own claim.
  let clientId: string | null = null;
  if (input.currentClientId) {
    const client = await resolveClient(input.ownerUserId, input.currentClientId);
    clientId = client ? client.id : null;
  }

  // Production Fix #1 (client name resolution): only attempted when no
  // client is already established via currentClientId (never overrides an
  // already-active context from a name mentioned in passing -- deliberately
  // narrow scope, see this file's own report), and only for the
  // professional role class (mirrors classifyOrchestratorIntentHybrid's own
  // role gating one level up -- no action a resolved client could ever lead
  // to is available to a public-role caller either). The candidate NAME
  // (untrusted free text) is extracted here; matchClientNameCandidates then
  // compares it ONLY against real fullName values on rows listClients
  // already scoped to input.ownerUserId -- there is no path from this
  // candidate string to a client id that did not already come from that
  // owner-scoped read (task's own required rule: "AI must never choose,
  // invent, return, or authorize a client ID" -- here, nothing but a real
  // DB row's own id is ever assigned to clientId).
  let clientNameMatch: ReturnType<typeof matchClientNameCandidates> | null = null;
  if (!clientId && input.roleClass === "professional") {
    const candidateName = extractCandidateClientName(input.message ?? "");
    if (candidateName) {
      const ownerClients = await listClients(input.ownerUserId);
      clientNameMatch = matchClientNameCandidates(candidateName, ownerClients);
      if (clientNameMatch.kind === "resolved") {
        // From here on this turn behaves EXACTLY as if the caller had
        // supplied this id as currentClientId to begin with -- it flows
        // through analysisId lookup, context, workflow-continuity memory,
        // and every downstream decision branch completely unmodified. No
        // second continuity mechanism, per the task's own explicit rule.
        clientId = clientNameMatch.clientId;
      }
    }
  }

  let analysisId: string | null = null;
  if (clientId && input.currentAnalysisId) {
    const analysis = await resolveAnalysis(input.ownerUserId, input.currentAnalysisId);
    // Owner-scoped alone is not enough here: also require the analysis to
    // genuinely belong to THIS client, not merely to this owner (an owner
    // can have many clients, and a stale/forged analysisId from a
    // different client of the same owner must not silently attach here).
    analysisId = analysis && analysis.clientId === clientId ? analysis.id : null;
  }

  const context: OrchestratorContext = {
    roleClass: input.roleClass,
    currentClientId: clientId,
    currentAnalysisId: analysisId,
    hasCompletedPhotoPreview: Boolean(input.hasCompletedPhotoPreview) && analysisId !== null,
  };

  // Stage 4 (task section 3/4): a client-remembered pending decision is
  // only ever CONSULTED here, never trusted as-is -- an unrecognized/
  // garbage value fails closed to null, exactly like every other
  // untrusted input this service handles.
  const pendingDecision: ConciergePendingDecision | null = isConciergePendingDecision(input.pendingDecision) ? input.pendingDecision : null;
  // A BARE yes/no reply only ever means something when there IS a pending
  // decision to answer (task section 4: "without a pending VIDEO_OFFER, a
  // bare 'Da' must NOT magically authorize Video") -- for any other
  // message, or with no pending decision at all, this is always null and
  // every existing Stage 1-3 code path below runs completely unaffected.
  const confirmation = pendingDecision === "VIDEO_OFFER" ? detectBareConfirmation(input.message ?? "") : null;
  // Stage 5 (task section 11): checked before EVERYTHING else below --
  // "Stop."/"Anulează." always takes priority over a pending-decision
  // answer or normal classification. Never reaches into Video/Photo
  // Preview provider code (see orchestrator-cancellation-detector.ts's
  // own header comment) -- this can only ever mean "stop suggesting
  // future Concierge steps," never a real engine cancel.
  const cancellationRequested = detectCancellationRequest(input.message ?? "");
  // Stage 5 (task section 2/13): same fail-closed validation pattern as
  // pendingDecision above.
  const activePlanGoal: OrchestrationPlanGoal | null = isOrchestrationPlanGoal(input.activePlanGoal) ? input.activePlanGoal : null;

  let decision: OrchestratorDecision;
  let classifierSource: ConciergeClassifierSource | null;

  if (cancellationRequested) {
    decision = planCancelledDecision(context);
    classifierSource = "cancellation";
  } else if (confirmation === "yes") {
    // Answering "yes" to a REMEMBERED offer is treated as EXACTLY the
    // same request_video intent a fresh "vreau un video" message already
    // produces (task section 4: "still only means open existing Video
    // cost confirmation") -- decideFromIntent's own request_video case
    // re-verifies currentClientId/currentAnalysisId THIS turn (already
    // done above, fresh, never carried over) before it can ever compose
    // REQUEST_VIDEO; a stale/forged/deleted client or analysis silently
    // falls back to noClientSelectedDecision, exactly like any other
    // intent would (task section 6/7, test I).
    decision = decideFromIntent("request_video", context);
    classifierSource = "pending_decision";
  } else if (confirmation === "no") {
    // Task section 3/17, test C: zero Video calls, pending decision
    // cleared (the client clears its own remembered pendingDecision after
    // ANY decision that isn't itself a fresh OFFER_VIDEO -- see
    // concierge-workflow-memory-logic.ts).
    decision = videoOfferDeclinedDecision(context);
    classifierSource = "pending_decision";
  } else if (videoOfferApplies(context)) {
    // Stage 2 priority (still wins over normal classification, exactly as
    // before) -- but only reached once a pending-decision answer has
    // already had first refusal above, so a real "yes"/"no" reply is
    // never re-asked the same question instead of being honored.
    decision = composeDecision(
      "request_video",
      "video",
      context,
      "OFFER_VIDEO",
      ["OPEN_ANALYSIS", "REQUEST_VIDEO"],
      "video_offer_after_completed_preview",
      "video_offer_after_completed_preview",
    );
    classifierSource = null;
  } else if (clientNameMatch?.kind === "ambiguous") {
    // Production Fix #1: never proceeds to intent classification with a
    // still-unresolved client -- would otherwise silently fall through to
    // the generic "no client selected" copy, losing the real, honest
    // distinction the task requires between "no name was ever mentioned"
    // and "a name was mentioned but matched more than one real client."
    decision = clientNameAmbiguousDecision(context, clientNameMatch.candidates);
    classifierSource = "client_name_resolution";
  } else if (clientNameMatch?.kind === "not_found") {
    decision = clientNameNotFoundDecision(context);
    classifierSource = "client_name_resolution";
  } else {
    const classification = await classifyHybrid(
      input.message ?? "",
      {
        ownerUserId: input.ownerUserId,
        roleClass: context.roleClass,
        clientId,
        analysisId,
        // Stage 4 (task section 10): the ONLY contextual metadata the AI
        // classifier ever receives, both derived fresh from THIS turn's
        // already-verified context -- never a remembered/stale value.
        workflowStage: resolveWorkflowStage(context),
        hasPendingDecision: pendingDecision !== null,
      },
      dependencies.aiClassifierDependencies,
    );
    classifierSource = classification.source;
    decision = classification.source === "clarification" ? clarificationDecision(context) : decideFromIntent(classification.intent, context);
  }

  if (!isOrchestratorDecision(decision)) {
    // Defense in depth (task section 2/3) -- should be structurally
    // unreachable given decideFromIntent's/clarificationDecision's own
    // return types, but this is the exact seam an AI-influenced decision
    // must also pass through, so it is exercised for real here, not
    // assumed.
    decision = unsupportedDecision(context);
  }

  // Stage 5 (task section 2/6): a plan is built whenever THIS turn's own
  // resolved DECISION already points at one of the "visualize_result"
  // journey's own real steps, OR the caller is still tracking an existing
  // plan (task section 5: "continue" must be able to resume it) -- either
  // way, ALWAYS freshly recomputed from real, already-verified state
  // (never the caller's own remembered plan shape). Never attempted for a
  // non-professional role (task section 3: every action this plan can
  // ever use is professional-only in today's registry -- see
  // orchestrator-plan-service.ts's own defense-in-depth check too).
  const planGoal: OrchestrationPlanGoal | null = resolvePlanGoalForDecision(decision) ?? activePlanGoal;
  let plan: OrchestrationPlan | null = null;
  if (planGoal && context.roleClass === "professional") {
    plan = await resolveVisualizeResultPlan(
      { ownerUserId: input.ownerUserId, context, pendingDecision, confirmation },
      dependencies.planDependencies,
    );
    if (cancellationRequested) {
      // Task section 11: stop future orchestration, but never erase or
      // fabricate real progress -- see cancelPlan's own doc comment.
      plan = cancelPlan(plan);
    }
    if (!isOrchestrationPlan(plan)) {
      // Defense in depth (task section 2/3), the exact same seam
      // isOrchestratorDecision above already guards for `decision` --
      // should be structurally unreachable given
      // resolveVisualizeResultPlan's/cancelPlan's own return types (a plan
      // is 100% server-authored, never AI-generated -- see
      // orchestrator-plan-service.ts's own header comment), but a plan is
      // an artifact this codebase hands to a real API response exactly
      // like a decision is, and nothing here is exempt from the same
      // fail-closed rule: never a malformed plan reaching a caller, an
      // honest "no plan" instead.
      plan = null;
    }
  }

  return { decision, plan, pendingDecision, classifierSource };
}

// Stage 5 (task section 6): every recommendedAction the "visualize_result"
// journey's own steps can ever produce (orchestrator-plan-service.ts's
// own fixed step sequence) -- checked on the FINAL decision's
// recommendedAction, not the pre-classification intent, so this correctly
// also covers the Stage 2 video-offer PRIORITY branch (whose own decision
// hardcodes intent to "request_video" but recommendedAction to
// "OFFER_VIDEO" -- that branch never goes through decideFromIntent at
// all, so deriving this from `intent` alone would silently miss it). No
// new intent value was added for this (task section 5: "the exact intent
// taxonomy should remain small") -- OPEN_CLIENTS/OPEN_CLIENT deliberately
// stay OUTSIDE this set: a bare "find my client" ask doesn't necessarily
// mean the user wants the full multi-step journey, only Stage 5's own
// example goals (which are all clearly about analysis/result/video) do.
const PLAN_TRIGGERING_ACTIONS: ReadonlySet<OrchestratorActionId> = new Set(["START_ANALYSIS", "OPEN_ANALYSIS", "OFFER_VIDEO", "REQUEST_VIDEO"]);

function resolvePlanGoalForDecision(decision: OrchestratorDecision): OrchestrationPlanGoal | null {
  return decision.recommendedAction && PLAN_TRIGGERING_ACTIONS.has(decision.recommendedAction) ? "visualize_result" : null;
}

function videoOfferApplies(context: OrchestratorContext): boolean {
  return Boolean(
    context.hasCompletedPhotoPreview &&
      context.currentClientId &&
      context.currentAnalysisId &&
      roleAllows("OFFER_VIDEO", context.roleClass) &&
      roleAllows("REQUEST_VIDEO", context.roleClass),
  );
}

// Pure -- maps an already-classified intent plus an already-verified
// context to a full OrchestratorDecision. No I/O, fully unit-testable.
// The video-offer priority check (Stage 2) now lives one level up, in
// buildDecision's own videoOfferApplies -- see that function's header
// comment for why (Stage 3: must win over a clarification outcome too,
// and must never spend an AI call it doesn't need).
function decideFromIntent(intent: OrchestratorIntent, context: OrchestratorContext): OrchestratorDecision {
  switch (intent) {
    case "request_video": {
      if (!roleAllows("REQUEST_VIDEO", context.roleClass)) return roleUnsupportedDecision(context);
      if (context.currentClientId && context.currentAnalysisId) {
        return composeDecision("request_video", "video", context, "REQUEST_VIDEO", ["OPEN_ANALYSIS", "REQUEST_VIDEO"], "client_and_analysis_identified", "client_and_analysis_identified");
      }
      return noClientSelectedDecision("request_video", context);
    }
    case "open_analysis": {
      if (!roleAllows("OPEN_ANALYSIS", context.roleClass)) return roleUnsupportedDecision(context);
      if (context.currentClientId && context.currentAnalysisId) {
        return composeDecision("open_analysis", "analysis", context, "OPEN_ANALYSIS", ["OPEN_ANALYSIS"], "client_and_analysis_identified", "client_and_analysis_identified");
      }
      if (context.currentClientId) {
        return composeDecision("open_analysis", "analysis", context, "START_ANALYSIS", ["START_ANALYSIS"], "client_identified_no_analysis_yet", "client_identified_no_analysis_yet");
      }
      return noClientSelectedDecision("open_analysis", context);
    }
    case "start_analysis": {
      if (!roleAllows("START_ANALYSIS", context.roleClass)) return roleUnsupportedDecision(context);
      if (context.currentClientId) {
        return composeDecision("start_analysis", "analysis", context, "START_ANALYSIS", ["START_ANALYSIS"], "client_identified_no_analysis_yet", "client_identified_no_analysis_yet");
      }
      return noClientSelectedDecision("start_analysis", context);
    }
    case "open_clients": {
      // A generic "client" mention while a specific client is ALREADY in
      // context (never guessed from the message itself -- see the
      // classifier's own scope note) is a real signal to jump straight to
      // that client rather than the full list.
      if (context.currentClientId && roleAllows("OPEN_CLIENT", context.roleClass)) {
        return composeDecision("open_clients", "clients", context, "OPEN_CLIENT", ["OPEN_CLIENT", "OPEN_CLIENTS"], "client_and_analysis_identified", "client_and_analysis_identified");
      }
      if (!roleAllows("OPEN_CLIENTS", context.roleClass)) return roleUnsupportedDecision(context);
      return composeDecision("open_clients", "clients", context, "OPEN_CLIENTS", ["OPEN_CLIENTS"], "no_client_selected", "no_client_selected");
    }
    case "unsupported":
    default:
      return unsupportedDecision(context);
  }
}

function roleAllows(actionId: OrchestratorActionId, roleClass: OrchestratorRoleClass): boolean {
  return isOrchestratorActionAllowedForRole(actionId, roleClass);
}

function noClientSelectedDecision(intent: OrchestratorIntent, context: OrchestratorContext): OrchestratorDecision {
  return composeDecision(intent, "clients", context, "OPEN_CLIENTS", ["OPEN_CLIENTS"], "no_client_selected", "no_client_selected");
}

function roleUnsupportedDecision(context: OrchestratorContext): OrchestratorDecision {
  return {
    intent: "unsupported",
    targetVertical: "none",
    targetClientId: null,
    targetAnalysisId: null,
    currentContext: context,
    recommendedAction: null,
    availableActions: [],
    requiresProfessionalApproval: false,
    requiresUserConsent: false,
    costClass: "NO_INCREMENTAL_COST",
    reasonCode: "role_not_yet_supported",
    nextStepCode: "role_not_yet_supported",
    ambiguousClientCandidates: [],
  };
}

// Stage 4: shared shape for every "no recommended action, zero cost/
// consent/approval implications" decision this service ever returns --
// unsupportedDecision, clarificationDecision, and videoOfferDeclinedDecision
// (below) differ ONLY in reasonCode. Kept as one function (rather than
// three near-duplicated object literals) so a future field added to this
// shape can never accidentally drift between them.
function honestNoActionDecision(context: OrchestratorContext, reasonCode: OrchestratorReasonCode): OrchestratorDecision {
  return {
    intent: "unsupported",
    targetVertical: "none",
    targetClientId: null,
    targetAnalysisId: null,
    currentContext: context,
    recommendedAction: null,
    availableActions: roleAllows("OPEN_CLIENTS", context.roleClass) ? ["OPEN_CLIENTS"] : [],
    requiresProfessionalApproval: false,
    requiresUserConsent: false,
    costClass: "NO_INCREMENTAL_COST",
    reasonCode,
    nextStepCode: reasonCode,
    ambiguousClientCandidates: [],
  };
}

function unsupportedDecision(context: OrchestratorContext): OrchestratorDecision {
  return honestNoActionDecision(context, "intent_not_understood");
}

// Stage 3 (task section 9): distinguishes "I genuinely don't understand"
// from "I see a few plausible things you might mean; please be more
// specific" (orchestrator-hybrid-classifier.ts's own "clarification"
// classifier source). Never guesses which of the plausible candidates to
// act on.
function clarificationDecision(context: OrchestratorContext): OrchestratorDecision {
  return honestNoActionDecision(context, "ambiguous_intent_needs_clarification");
}

// Stage 4 (task section 3/17, tests C/K): a bare "no" reply to a pending
// VIDEO_OFFER -- zero Video call, an honest, distinct acknowledgment
// (never conflated with "I didn't understand you").
function videoOfferDeclinedDecision(context: OrchestratorContext): OrchestratorDecision {
  return honestNoActionDecision(context, "video_offer_declined");
}

// Stage 5 (task section 11): a recognized "Stop."/"Anulează." -- an
// honest acknowledgment that future orchestration steps have stopped.
// Never implies a real provider operation was cancelled.
function planCancelledDecision(context: OrchestratorContext): OrchestratorDecision {
  return honestNoActionDecision(context, "plan_cancelled");
}

// Production Fix #1 (client name resolution): a candidate name matched
// MORE THAN ONE real, owner-scoped client. `candidates` are real DB rows
// (id + fullName) already scoped to input.ownerUserId by
// listClientsForOwner -- never chosen between here, only surfaced so the
// UI can render each as its own real "open this client" link (task's own
// "ask user which real matching client they mean").
function clientNameAmbiguousDecision(context: OrchestratorContext, candidates: OrchestratorClientCandidate[]): OrchestratorDecision {
  return { ...honestNoActionDecision(context, "client_name_ambiguous"), ambiguousClientCandidates: candidates };
}

// Production Fix #1: a candidate name matched NO real, owner-scoped
// client -- an honest, distinct acknowledgment from the generic
// no_client_selected (which also covers "no name was mentioned at all"),
// per the task's own required NOT FOUND behavior.
function clientNameNotFoundDecision(context: OrchestratorContext): OrchestratorDecision {
  return honestNoActionDecision(context, "client_name_not_found");
}

function composeDecision(
  intent: OrchestratorIntent,
  targetVertical: OrchestratorDecision["targetVertical"],
  context: OrchestratorContext,
  recommendedAction: OrchestratorActionId,
  availableActions: OrchestratorActionId[],
  reasonCode: OrchestratorReasonCode,
  nextStepCode: OrchestratorReasonCode,
): OrchestratorDecision {
  const definition = ORCHESTRATOR_ACTION_REGISTRY[recommendedAction];
  return {
    intent,
    targetVertical,
    targetClientId: definition.requiresClientId ? context.currentClientId : null,
    targetAnalysisId: definition.requiresAnalysisId ? context.currentAnalysisId : null,
    currentContext: context,
    recommendedAction,
    availableActions: availableActions.filter((id) => roleAllows(id, context.roleClass)),
    requiresProfessionalApproval: definition.requiresProfessionalApproval,
    requiresUserConsent: definition.requiresUserConsent,
    costClass: definition.costClass,
    reasonCode,
    nextStepCode,
    ambiguousClientCandidates: [],
  };
}

// Stage 2 (task section 11) + Stage 4 (task section 16): every event this
// server-side, PER-REQUEST log can honestly distinguish without any
// cross-turn memory (which only the caller's own browser session has --
// see concierge-workflow-memory-logic.ts for workflow_started/
// workflow_continued/context_switched, which genuinely need it and are
// logged client-side instead, exactly like this file's own
// video_offer_accepted/declined precedent from Stage 2).
// "video_offer_presented" (kept as-is, Stage 2's own established string --
// never renamed, since nothing about its meaning changed) IS this turn's
// pending_decision_created moment: a fresh OFFER_VIDEO recommendation.
// pending_decision_accepted/declined fire when THIS turn's decision came
// from resolving a real pending decision (classifierSource ==
// "pending_decision"); pending_decision_invalidated fires when the caller
// claimed one was pending but this turn's message didn't answer it (a
// stale/lapsed offer, silently superseded by whatever the message
// actually asked for -- never re-asked, never guessed at).
type OrchestratorEvent =
  | "video_offer_presented"
  | "pending_decision_accepted"
  | "pending_decision_declined"
  | "pending_decision_invalidated"
  | null;

function deriveOrchestrationEvent(
  decision: OrchestratorDecision,
  pendingDecision: ConciergePendingDecision | null,
  classifierSource: ConciergeClassifierSource | null,
): OrchestratorEvent {
  if (decision.recommendedAction === "OFFER_VIDEO") return "video_offer_presented";
  if (classifierSource === "pending_decision") {
    if (decision.reasonCode === "video_offer_declined") return "pending_decision_declined";
    if (decision.recommendedAction === "REQUEST_VIDEO") return "pending_decision_accepted";
  }
  if (pendingDecision !== null) return "pending_decision_invalidated";
  return null;
}

// Stage 5 (task section 17): a SEPARATE field from `event` above --
// deliberately not folded into the same union, since a single turn can
// legitimately have BOTH a pending-decision event (accepting the video
// offer) AND a plan-status event (the plan moving to
// WAITING_FOR_COST_CONFIRMATION) at once. Only the four of task section
// 17's own named events that are honestly derivable from THIS ONE plan
// object alone -- plan_created/plan_step_completed/plan_replanned
// genuinely need cross-turn memory (was there a plan before? which step
// was active last turn?) that only the caller's own browser session has,
// and are logged client-side instead, in
// concierge-workflow-memory-logic.ts -- exactly mirroring Stage 4's own
// workflow_started/workflow_continued/context_switched split.
// WAITING_FOR_COST_CONFIRMATION maps to plan_waiting_for_user (task
// section 17's own list has no dedicated event for it, and "the user
// needs to interact with something" is accurate either way -- it is the
// EXISTING Video dialog, not a Concierge question, that they interact
// with next). PLANNED/COMPLETED produce no event -- COMPLETED has
// nothing left to wait for, and PLANNED is never externally observed
// (see orchestrator-plan-contracts.ts's own doc comment).
type PlanEvent =
  | "plan_step_selected"
  | "plan_waiting_for_user"
  | "plan_waiting_for_approval"
  | "plan_waiting_for_engine"
  | "plan_blocked"
  | "plan_cancelled"
  | null;

function derivePlanEvent(plan: OrchestrationPlan | null): PlanEvent {
  if (!plan) return null;
  switch (plan.status) {
    case "ACTIVE":
      return "plan_step_selected";
    case "WAITING_FOR_USER":
    case "WAITING_FOR_COST_CONFIRMATION":
      return "plan_waiting_for_user";
    case "WAITING_FOR_APPROVAL":
      return "plan_waiting_for_approval";
    case "WAITING_FOR_ENGINE":
      return "plan_waiting_for_engine";
    case "BLOCKED":
      return "plan_blocked";
    case "CANCELLED":
      return "plan_cancelled";
    case "COMPLETED":
    case "PLANNED":
    default:
      return null;
  }
}

function logOrchestratorDecision(
  input: ResolveOrchestratorDecisionInput,
  decision: OrchestratorDecision,
  plan: OrchestrationPlan | null,
  pendingDecision: ConciergePendingDecision | null,
  classifierSource: ConciergeClassifierSource | null,
  totalLatencyMs: number,
): void {
  // Never logs the raw message content (task section 10: "Do not log
  // sensitive prompt/user content unnecessarily") -- only the structured,
  // already-classified outcome.
  const line = JSON.stringify({
    gate: "CONCIERGE_ORCHESTRATION",
    ownerUserId: input.ownerUserId,
    roleClass: input.roleClass,
    // Stage 2: distinguishes a real free-text ask from the system-observed
    // "a Photo Preview just completed" check -- never guessed, derived
    // directly from whether a message was actually sent.
    trigger: input.message && input.message.trim().length > 0 ? "message" : "context",
    // Stage 3 (task section 17): how the intent was actually produced --
    // null only for the video-offer priority path (buildDecision), which
    // never consults a classifier at all.
    classifierSource,
    // Stage 4: the caller's own claimed pending decision for THIS turn
    // (already validated -- see buildDecision's own isConciergePendingDecision
    // check), never trusted as authority, logged only for diagnosis.
    pendingDecision,
    intent: decision.intent,
    recommendedAction: decision.recommendedAction,
    event: deriveOrchestrationEvent(decision, pendingDecision, classifierSource),
    // Stage 5: null whenever no plan applies this turn.
    planGoal: plan?.goal ?? null,
    planStatus: plan?.status ?? null,
    planCurrentStepId: plan?.currentStepId ?? null,
    planEvent: derivePlanEvent(plan),
    requiresUserConsent: decision.requiresUserConsent,
    costClass: decision.costClass,
    totalLatencyMs,
  });
  console.log(line);
}
