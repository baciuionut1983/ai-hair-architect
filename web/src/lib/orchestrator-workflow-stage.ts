import type { OrchestratorContext } from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 4 -- "what stage is this workflow
// really in," derived ONLY from an already server-verified
// OrchestratorContext (task section 6: never invented, never trusted from
// remembered conversational state alone -- see orchestrator-service.ts's
// own buildDecision, which always rebuilds this context fresh, every
// turn, from real ownership-checked ids). Deliberately the SAME 4-way
// granularity Stage 2's existing hasCompletedPhotoPreview signal already
// supports -- this task explicitly warns "do NOT invent missing workflow
// state" (task section 5), and this app has no existing, safe way to
// independently re-derive finer-grained states ("Photo Preview
// processing" vs "Video processing" vs "Video completed") without
// reaching into the Photo Preview/Spatial Mapping/Video engines this
// stage is explicitly forbidden from touching (task section 19). A finer
// breakdown is a real, legitimate candidate for a LATER stage, once (or
// if) the Concierge is given its own safe, narrow read path into that
// deeper chain -- not invented here from a boolean this stage doesn't
// own.
export type ConciergeWorkflowStage = "no_client" | "no_analysis" | "analysis_in_progress" | "result_available";

export function resolveWorkflowStage(context: OrchestratorContext): ConciergeWorkflowStage {
  if (!context.currentClientId) return "no_client";
  if (!context.currentAnalysisId) return "no_analysis";
  if (context.hasCompletedPhotoPreview) return "result_available";
  return "analysis_in_progress";
}
