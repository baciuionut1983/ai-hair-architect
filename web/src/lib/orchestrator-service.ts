import { findClientForOwner } from "@/lib/client-repository";
import { findAnalysisForOwner } from "@/lib/analysis-repository";
import { classifyOrchestratorIntent } from "@/lib/orchestrator-intent-classifier";
import { isOrchestratorActionAllowedForRole, ORCHESTRATOR_ACTION_REGISTRY } from "@/lib/orchestrator-action-registry";
import {
  isOrchestratorDecision,
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
  message: string;
  roleClass: OrchestratorRoleClass;
  ownerUserId: string;
  currentClientId?: string | null;
  currentAnalysisId?: string | null;
  hasCompletedPhotoPreview?: boolean;
}

export interface ResolveOrchestratorDecisionDependencies {
  findClientForOwner?: typeof findClientForOwner;
  findAnalysisForOwner?: typeof findAnalysisForOwner;
  classifyIntent?: typeof classifyOrchestratorIntent;
}

export async function resolveOrchestratorDecision(
  input: ResolveOrchestratorDecisionInput,
  dependencies: ResolveOrchestratorDecisionDependencies = {},
): Promise<OrchestratorDecision> {
  const startedAt = Date.now();
  const decision = await buildDecision(input, dependencies);
  logOrchestratorDecision(input, decision, Date.now() - startedAt);
  return decision;
}

async function buildDecision(input: ResolveOrchestratorDecisionInput, dependencies: ResolveOrchestratorDecisionDependencies): Promise<OrchestratorDecision> {
  const resolveClient = dependencies.findClientForOwner ?? findClientForOwner;
  const resolveAnalysis = dependencies.findAnalysisForOwner ?? findAnalysisForOwner;
  const classify = dependencies.classifyIntent ?? classifyOrchestratorIntent;

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

  const intent = classify(input.message);
  const decision = decideFromIntent(intent, context);

  if (!isOrchestratorDecision(decision)) {
    // Defense in depth (task section 2/3) -- should be structurally
    // unreachable given decideFromIntent's own return type, but this is
    // the exact seam a future non-deterministic classifier must also pass
    // through, so it is exercised for real here, not assumed.
    return unsupportedDecision(context);
  }

  return decision;
}

// Pure -- maps an already-classified intent plus an already-verified
// context to a full OrchestratorDecision. No I/O, fully unit-testable.
function decideFromIntent(intent: OrchestratorIntent, context: OrchestratorContext): OrchestratorDecision {
  // The video offer takes priority whenever the caller's own context says
  // a Photo Preview just completed, regardless of the free-text intent --
  // this is the conversational moment task section 5 describes ("Dorești
  // să îți generez și un video demonstrativ?"), not something the user
  // has to ask for by name.
  if (context.hasCompletedPhotoPreview && context.currentClientId && context.currentAnalysisId && roleAllows("REQUEST_VIDEO", context.roleClass)) {
    return composeDecision("request_video", "video", context, "REQUEST_VIDEO", ["OPEN_ANALYSIS", "REQUEST_VIDEO"], "video_offer_after_completed_preview", "video_offer_after_completed_preview");
  }

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

function unsupportedDecision(context: OrchestratorContext): OrchestratorDecision {
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
    reasonCode: "intent_not_understood",
    nextStepCode: "intent_not_understood",
  };
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

function logOrchestratorDecision(input: ResolveOrchestratorDecisionInput, decision: OrchestratorDecision, totalLatencyMs: number): void {
  // Never logs the raw message content (task section 10: "Do not log
  // sensitive prompt/user content unnecessarily") -- only the structured,
  // already-classified outcome.
  const line = JSON.stringify({
    gate: "CONCIERGE_ORCHESTRATION",
    ownerUserId: input.ownerUserId,
    roleClass: input.roleClass,
    intent: decision.intent,
    recommendedAction: decision.recommendedAction,
    requiresUserConsent: decision.requiresUserConsent,
    costClass: decision.costClass,
    totalLatencyMs,
  });
  console.log(line);
}
