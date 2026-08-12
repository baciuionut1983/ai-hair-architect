export type AnalysisResultLoadStatus = "ready" | "not-found" | "error";

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
