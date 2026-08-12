import { useEffect, useState } from "react";

import type { AnalysisResultResponse } from "@/lib/contracts";

import { resolveAnalysisResultLoadStatus } from "./analysis-result-logic";

export type AnalysisResultState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ready"; result: AnalysisResultResponse };

// Mirrors useClientProfile's fetch-effect shape (same directory pattern one
// level up) so this stays consistent with how every other client-scoped
// detail page in this app resolves its data.
export function useAnalysisResult(analysisId: string): AnalysisResultState {
  const [state, setState] = useState<AnalysisResultState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/v1/analysis/${analysisId}/result`, { method: "GET" });
        if (cancelled) return;

        const loadStatus = resolveAnalysisResultLoadStatus(response);
        if (loadStatus !== "ready") {
          setState({ status: loadStatus });
          return;
        }

        const result = (await response.json()) as AnalysisResultResponse;
        setState({ status: "ready", result });
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  return state;
}
