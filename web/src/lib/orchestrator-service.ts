import { findClientForOwner } from "@/lib/client-repository";
import { findAnalysisForOwner } from "@/lib/analysis-repository";
import {
  classifyOrchestratorIntentHybrid,
  type ConciergeClassifierSource,
  type HybridClassifierDependencies,
} from "@/lib/orchestrator-hybrid-classifier";
import { detectBareConfirmation } from "@/lib/orchestrator-confirmation-detector";
import { resolveWorkflowStage } from "@/lib/orchestrator-workflow-stage";
import { isOrchestratorActionAllowedForRole, ORCHESTRATOR_ACTION_REGISTRY } from "@/lib/orchestrator-action-registry";
import {
  isConciergePendingDecision,
  isOrchestratorDecision,
  type ConciergePendingDecision,
  type OrchestratorActionId,
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
}

export interface ResolveOrchestratorDecisionDependencies {
  findClientForOwner?: typeof findClientForOwner;
  findAnalysisForOwner?: typeof findAnalysisForOwner;
  // Stage 3: replaces the old, never-externally-used `classifyIntent`
  // hook. Tests inject the full hybrid pipeline directly (real messages
  // resolve deterministically with zero AI dependency in every existing
  // Stage 1/2 test -- see classifyOrchestratorIntentHybrid's own header
  // comment) or inject `aiClassifierDependencies` below to reach the AI
  // path specifically (fake provider, fake env) without needing a real
  // network call.
  classifyIntentHybrid?: typeof classifyOrchestratorIntentHybrid;
  aiClassifierDependencies?: HybridClassifierDependencies;
}

export async function resolveOrchestratorDecision(
  input: ResolveOrchestratorDecisionInput,
  dependencies: ResolveOrchestratorDecisionDependencies = {},
): Promise<OrchestratorDecision> {
  const startedAt = Date.now();
  const { decision, pendingDecision, classifierSource } = await buildDecision(input, dependencies);
  logOrchestratorDecision(input, decision, pendingDecision, classifierSource, Date.now() - startedAt);
  return decision;
}

async function buildDecision(
  input: ResolveOrchestratorDecisionInput,
  dependencies: ResolveOrchestratorDecisionDependencies,
): Promise<{ decision: OrchestratorDecision; pendingDecision: ConciergePendingDecision | null; classifierSource: ConciergeClassifierSource | null }> {
  const resolveClient = dependencies.findClientForOwner ?? findClientForOwner;
  const resolveAnalysis = dependencies.findAnalysisForOwner ?? findAnalysisForOwner;
  const classifyHybrid = dependencies.classifyIntentHybrid ?? classifyOrchestratorIntentHybrid;

  // Re-verify ownership -- never trust the caller's own claim.
  let clientId: string | null = null;
  if (input.currentClientId) {
    const client = await resolveClient(input.ownerUserId, input.currentClientId);
    clientId = client ? client.id : null;
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

  let decision: OrchestratorDecision;
  let classifierSource: ConciergeClassifierSource | null;

  if (confirmation === "yes") {
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
    return { decision: unsupportedDecision(context), pendingDecision, classifierSource };
  }

  return { decision, pendingDecision, classifierSource };
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

function logOrchestratorDecision(
  input: ResolveOrchestratorDecisionInput,
  decision: OrchestratorDecision,
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
    requiresUserConsent: decision.requiresUserConsent,
    costClass: decision.costClass,
    totalLatencyMs,
  });
  console.log(line);
}
