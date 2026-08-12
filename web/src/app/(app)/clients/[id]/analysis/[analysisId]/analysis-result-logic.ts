export type AnalysisResultLoadStatus = "ready" | "not-found" | "error";

// Analysis.confidenceScore is a coarse, overall-readiness gate (see
// analysis-engine.ts's isLikelyLowConfidence) -- a completely different
// metric from each plan's own confidence (calculateRecommendationConfidence,
// labeled via RecommendationPlanBase's formatPlanConfidenceLabel). Labeled
// "Overall analysis" here specifically so the two are never presented as
// the same number under the same word.
export function formatOverallConfidenceLabel(confidenceScore: number): string {
  return `Overall analysis confidence: ${Math.round(confidenceScore * 100)}%`;
}

// GET /api/v1/analysis/[id]/result scopes lookups by owner (see
// findAnalysisForOwner) -- an analysis that exists but belongs to someone
// else already comes back as a plain 404, same as one that never existed.
// That's exactly the behavior this maps to "not-found", so no separate
// "forbidden" state is needed here.
export function resolveAnalysisResultLoadStatus(response: { ok: boolean; status: number }): AnalysisResultLoadStatus {
  if (response.status === 404) return "not-found";
  if (!response.ok) return "error";
  return "ready";
}
