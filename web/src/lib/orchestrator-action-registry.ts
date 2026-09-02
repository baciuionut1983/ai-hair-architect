import type { OrchestratorActionId, OrchestratorCostClass, OrchestratorRoleClass } from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 1 -- the allowlisted action registry
// (task section 4). This is the ONLY place a caller (the API route, the
// UI) may look up what an action id means -- there is no path from a raw
// string to an executed effect that does not go through this table.
//
// Every action in Stage 1 is `kind: "navigate"` -- client-side routing to
// an EXISTING page only, never a direct call into an engine's own
// create/execute endpoint. This is deliberate, not a placeholder: it is
// what makes "intent != execution" (task section 3) true by construction
// for this whole stage -- there is categorically no code path here that
// can submit a paid Video generation, mutate a client record, or do
// anything beyond telling the browser which existing, already-authority-
// checked page to go to. The actual mutation (creating an analysis,
// confirming a proposal, requesting a video) still only ever happens
// through the EXISTING pages/APIs those routes render, with their own
// EXISTING consent/approval gates completely intact.

export interface OrchestratorActionDefinition {
  id: OrchestratorActionId;
  allowedRoleClasses: readonly OrchestratorRoleClass[];
  requiresClientId: boolean;
  requiresAnalysisId: boolean;
  // Whether the action itself, in this stage, ever mutates data. Always
  // false today -- see the file header. Kept as an explicit field (rather
  // than omitted) so a future kind: "execute" action added in a later
  // stage has an obvious place to declare true, and every consumer of this
  // registry already has to handle the field.
  changesData: boolean;
  requiresProfessionalApproval: boolean;
  requiresUserConsent: boolean;
  costClass: OrchestratorCostClass;
  // Stage 1: always false. Nothing in this registry may run without a
  // human clicking the resulting navigation button -- there is no
  // autonomous execution path yet.
  canExecuteAutomatically: boolean;
  kind: "navigate";
}

export const ORCHESTRATOR_ACTION_REGISTRY: Record<OrchestratorActionId, OrchestratorActionDefinition> = {
  OPEN_CLIENTS: {
    id: "OPEN_CLIENTS",
    allowedRoleClasses: ["professional"],
    requiresClientId: false,
    requiresAnalysisId: false,
    changesData: false,
    requiresProfessionalApproval: false,
    requiresUserConsent: false,
    costClass: "NO_INCREMENTAL_COST",
    canExecuteAutomatically: false,
    kind: "navigate",
  },
  OPEN_CLIENT: {
    id: "OPEN_CLIENT",
    allowedRoleClasses: ["professional"],
    requiresClientId: true,
    requiresAnalysisId: false,
    changesData: false,
    requiresProfessionalApproval: false,
    requiresUserConsent: false,
    costClass: "NO_INCREMENTAL_COST",
    canExecuteAutomatically: false,
    kind: "navigate",
  },
  START_ANALYSIS: {
    id: "START_ANALYSIS",
    allowedRoleClasses: ["professional"],
    requiresClientId: true,
    requiresAnalysisId: false,
    // Navigating here does not itself create anything -- the existing
    // analysis/new page is what actually starts an analysis, under its own
    // existing authority checks. Marked true anyway: reaching this page IS
    // the deliberate first step of a data-creating workflow, and a future
    // stage that lets the Orchestrator skip the intermediate page entirely
    // must not silently inherit "false" from this one.
    changesData: true,
    requiresProfessionalApproval: false,
    requiresUserConsent: false,
    costClass: "NO_INCREMENTAL_COST",
    canExecuteAutomatically: false,
    kind: "navigate",
  },
  OPEN_ANALYSIS: {
    id: "OPEN_ANALYSIS",
    allowedRoleClasses: ["professional"],
    requiresClientId: true,
    requiresAnalysisId: true,
    changesData: false,
    requiresProfessionalApproval: false,
    requiresUserConsent: false,
    costClass: "NO_INCREMENTAL_COST",
    canExecuteAutomatically: false,
    kind: "navigate",
  },
  REQUEST_VIDEO: {
    id: "REQUEST_VIDEO",
    allowedRoleClasses: ["professional"],
    requiresClientId: true,
    requiresAnalysisId: true,
    // The navigation itself changes nothing -- it lands on the exact same
    // analysis page OPEN_ANALYSIS does, where the EXISTING Video
    // Result-Visualization UI (video-demonstration-section.tsx, untouched
    // by this stage) owns its own real cost-consent dialog and its own
    // create/execute calls. This action can never itself submit a Video
    // generation.
    changesData: false,
    requiresProfessionalApproval: false,
    // Task section 5's own required safety principle: CONVERSATIONAL
    // INTENT -> EXPLICIT COST CONFIRMATION -> PAID ENGINE CALL. A "yes" to
    // the Concierge's own offer is conversational intent, not the explicit
    // confirmation -- this flag documents that consent is still owed
    // (satisfied by the existing Video UI's own dialog, never bypassed
    // here) even though this action's own effect is just navigation.
    requiresUserConsent: true,
    costClass: "MEANINGFUL_COST",
    canExecuteAutomatically: false,
    kind: "navigate",
  },
};

export function isOrchestratorActionAllowedForRole(actionId: OrchestratorActionId, roleClass: OrchestratorRoleClass): boolean {
  return ORCHESTRATOR_ACTION_REGISTRY[actionId].allowedRoleClasses.includes(roleClass);
}

export interface OrchestratorActionHrefContext {
  clientId: string | null;
  analysisId: string | null;
}

// Builds the real navigation target for an action, using ONLY ids already
// present in the (server-side, ownership-verified -- see
// orchestrator-service.ts) context passed in. Returns null whenever the
// action's own declared requirements (requiresClientId/requiresAnalysisId)
// are not met by that context -- never falls back to a caller-supplied
// raw string that has not been through resolveOrchestratorDecision's own
// ownership check.
export function resolveOrchestratorActionHref(actionId: OrchestratorActionId, context: OrchestratorActionHrefContext): string | null {
  const definition = ORCHESTRATOR_ACTION_REGISTRY[actionId];
  if (definition.requiresClientId && !context.clientId) return null;
  if (definition.requiresAnalysisId && !context.analysisId) return null;

  switch (actionId) {
    case "OPEN_CLIENTS":
      return "/clients";
    case "OPEN_CLIENT":
      return `/clients/${context.clientId}`;
    case "START_ANALYSIS":
      return `/clients/${context.clientId}/analysis/new`;
    case "OPEN_ANALYSIS":
    case "REQUEST_VIDEO":
      return `/clients/${context.clientId}/analysis/${context.analysisId}`;
    default: {
      const exhaustiveCheck: never = actionId;
      return exhaustiveCheck;
    }
  }
}
