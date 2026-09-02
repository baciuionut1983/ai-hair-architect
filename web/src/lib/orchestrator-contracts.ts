import type { UserRole } from "@/lib/contracts";

// AI Concierge / Orchestrator, Stage 1 -- the pure domain layer. No DB, no
// provider, no React -- just validated types and hand-written type guards,
// mirroring this codebase's own established convention (e.g.
// isSealedVideoDemonstrationRequest in video-generation-contracts.ts) rather
// than introducing a new validation dependency (this repo has never used
// Zod or similar -- every other boundary here is a plain, explicit
// TypeScript type guard).
//
// PRODUCT PRINCIPLE (locked): USER STATES THE GOAL -> AI ORCHESTRATES ->
// ENGINES EXECUTE -> PROFESSIONAL APPROVES. This file defines the shape of
// "AI ORCHESTRATES" output only -- it never itself calls an engine. See
// orchestrator-action-registry.ts for the allowlisted actions an
// OrchestratorDecision may recommend, and orchestrator-service.ts for how a
// decision gets built and validated.

// Two role classes for Stage 1 (task's own "ROLE-AWARE ENTRY" section).
// This app's real UserRole has three values; "salon" behaves like
// "professional" for orchestration purposes (both are business-side
// accounts with client management access) -- only "consumer" maps to the
// public/client experience.
export type OrchestratorRoleClass = "professional" | "public";

export function resolveOrchestratorRoleClass(role: UserRole): OrchestratorRoleClass {
  return role === "consumer" ? "public" : "professional";
}

// Closed vocabulary -- an intent the classifier (or, in a later stage, a
// real model) can produce. Adding a new intent means adding it here AND to
// the action registry's own switch -- never an arbitrary string flowing
// through unchecked.
export type OrchestratorIntent = "open_clients" | "start_analysis" | "open_analysis" | "request_video" | "unsupported";

// The ONLY action ids an OrchestratorDecision may ever recommend or list as
// available -- the allowlist itself lives in orchestrator-action-registry.ts.
// This type is what makes "an LLM must never be able to invent a route/
// action name and have it executed" (task section 3) enforceable: nothing
// outside this union can type-check as an action id, and
// isOrchestratorDecision (below) rejects anything else at the runtime
// boundary too.
export type OrchestratorActionId = "OPEN_CLIENTS" | "OPEN_CLIENT" | "START_ANALYSIS" | "OPEN_ANALYSIS" | "REQUEST_VIDEO";

const ORCHESTRATOR_ACTION_IDS: readonly OrchestratorActionId[] = ["OPEN_CLIENTS", "OPEN_CLIENT", "START_ANALYSIS", "OPEN_ANALYSIS", "REQUEST_VIDEO"];

// Generic cost classification (task section 6) -- deliberately not Veo-
// specific, and deliberately not a monetary figure: no price is invented
// here. An action's real cost estimate, where one is authoritative, comes
// from the SAME provider/metering configuration every other AI feature in
// this codebase already uses (ai-usage-pricing.ts) -- this enum only
// decides whether explicit consent is required before an action may run,
// never what it costs.
export type OrchestratorCostClass = "NO_INCREMENTAL_COST" | "LOW_COST" | "MEANINGFUL_COST";

const ORCHESTRATOR_COST_CLASSES: readonly OrchestratorCostClass[] = ["NO_INCREMENTAL_COST", "LOW_COST", "MEANINGFUL_COST"];

// Closed vocabulary for WHY a decision was made and WHAT the suggested next
// step is -- codes, never literal strings, so the orchestration domain
// stays language-independent (task section 9). The UI layer maps each code
// to a TranslationKey via translations.ts (concierge.reason.<code> /
// concierge.nextStep.<code>) -- this file has no knowledge of any language.
export type OrchestratorReasonCode =
  | "client_and_analysis_identified"
  | "client_identified_no_analysis_yet"
  | "no_client_selected"
  | "video_offer_after_completed_preview"
  | "role_not_yet_supported"
  | "intent_not_understood";

const ORCHESTRATOR_REASON_CODES: readonly OrchestratorReasonCode[] = [
  "client_and_analysis_identified",
  "client_identified_no_analysis_yet",
  "no_client_selected",
  "video_offer_after_completed_preview",
  "role_not_yet_supported",
  "intent_not_understood",
];

// Current, already-validated (never client-supplied-and-trusted-blindly)
// context an OrchestratorDecision was built against. See
// orchestrator-service.ts's own resolveOrchestratorDecision for how
// currentClientId/currentAnalysisId get re-verified against real ownership
// before ever appearing here (task section 11).
export interface OrchestratorContext {
  roleClass: OrchestratorRoleClass;
  currentClientId: string | null;
  currentAnalysisId: string | null;
  hasCompletedPhotoPreview: boolean;
}

export interface OrchestratorDecision {
  intent: OrchestratorIntent;
  targetVertical: "clients" | "analysis" | "video" | "none";
  targetClientId: string | null;
  targetAnalysisId: string | null;
  currentContext: OrchestratorContext;
  recommendedAction: OrchestratorActionId | null;
  availableActions: OrchestratorActionId[];
  requiresProfessionalApproval: boolean;
  requiresUserConsent: boolean;
  costClass: OrchestratorCostClass;
  reasonCode: OrchestratorReasonCode;
  nextStepCode: OrchestratorReasonCode;
}

function isOrchestratorRoleClass(value: unknown): value is OrchestratorRoleClass {
  return value === "professional" || value === "public";
}

function isOrchestratorActionId(value: unknown): value is OrchestratorActionId {
  return typeof value === "string" && (ORCHESTRATOR_ACTION_IDS as readonly string[]).includes(value);
}

function isOrchestratorCostClass(value: unknown): value is OrchestratorCostClass {
  return typeof value === "string" && (ORCHESTRATOR_COST_CLASSES as readonly string[]).includes(value);
}

function isOrchestratorReasonCode(value: unknown): value is OrchestratorReasonCode {
  return typeof value === "string" && (ORCHESTRATOR_REASON_CODES as readonly string[]).includes(value);
}

function isOrchestratorContext(value: unknown): value is OrchestratorContext {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isOrchestratorRoleClass(candidate.roleClass) &&
    (candidate.currentClientId === null || typeof candidate.currentClientId === "string") &&
    (candidate.currentAnalysisId === null || typeof candidate.currentAnalysisId === "string") &&
    typeof candidate.hasCompletedPhotoPreview === "boolean"
  );
}

// The runtime boundary (task section 2/3): "avoid arbitrary unvalidated AI
// JSON crossing into execution code." Every OrchestratorDecision this
// codebase ever hands to an API response or a UI action button passes
// through this guard first -- in Stage 1 the decision is always built by
// our own deterministic code (see orchestrator-service.ts), so this can
// never actually fail today, but it is the exact seam a future real-model-
// backed classifier (Stage 2+) would have to pass through too, unchanged.
export function isOrchestratorDecision(value: unknown): value is OrchestratorDecision {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.intent !== "string") return false;
  if (!["open_clients", "start_analysis", "open_analysis", "request_video", "unsupported"].includes(candidate.intent)) return false;
  if (!["clients", "analysis", "video", "none"].includes(candidate.targetVertical as string)) return false;
  if (candidate.targetClientId !== null && typeof candidate.targetClientId !== "string") return false;
  if (candidate.targetAnalysisId !== null && typeof candidate.targetAnalysisId !== "string") return false;
  if (!isOrchestratorContext(candidate.currentContext)) return false;
  if (candidate.recommendedAction !== null && !isOrchestratorActionId(candidate.recommendedAction)) return false;
  if (!Array.isArray(candidate.availableActions) || !candidate.availableActions.every(isOrchestratorActionId)) return false;
  if (typeof candidate.requiresProfessionalApproval !== "boolean") return false;
  if (typeof candidate.requiresUserConsent !== "boolean") return false;
  if (!isOrchestratorCostClass(candidate.costClass)) return false;
  if (!isOrchestratorReasonCode(candidate.reasonCode)) return false;
  if (!isOrchestratorReasonCode(candidate.nextStepCode)) return false;

  return true;
}
