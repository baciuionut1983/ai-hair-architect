import { isVideoOfferDecision } from "@/components/concierge-logic";
import type { OrchestratorDecision } from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 2 -- pure logic for the contextual
// video offer (task section 4/13 test A/B). No React, no fetch. Mirrors
// concierge-logic.ts's own established split (pure, tested logic;
// hook/component are not) -- reuses isVideoOfferDecision directly rather
// than re-implementing the same check a second time.

export interface VideoOfferCheckRequestBody {
  currentClientId: string;
  currentAnalysisId: string;
  hasCompletedPhotoPreview: true;
}

// Deliberately NO `message` field at all (task section 11's own
// distinction, mirrored in orchestrator-service.ts's own header comment):
// this is a system-observed context check, never a fabricated user
// utterance.
export function buildVideoOfferCheckRequestBody(clientId: string, analysisId: string): VideoOfferCheckRequestBody {
  return { currentClientId: clientId, currentAnalysisId: analysisId, hasCompletedPhotoPreview: true };
}

export type VideoOfferInterpretation = "offered" | "not_offered";

// Test A/B (task section 13): a real decision from a COMPLETED Photo
// Preview interprets as "offered"; anything else (role not supported,
// context didn't resolve, not actually completed) interprets as
// "not_offered" -- the UI renders nothing in that case, never a
// degraded/partial offer.
export function interpretVideoOfferDecision(decision: OrchestratorDecision): VideoOfferInterpretation {
  return isVideoOfferDecision(decision) ? "offered" : "not_offered";
}
