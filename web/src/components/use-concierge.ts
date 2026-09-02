"use client";

import { useCallback, useState } from "react";

import type { OrchestratorDecision } from "@/lib/orchestrator-contracts";
import { buildOrchestrateRequestBody } from "./concierge-logic";

// AI Concierge / Orchestrator, Stage 1 -- the data-fetching hook. Plain
// fetch + useState, mirroring use-video-demonstration.ts's own style, but
// genuinely simpler: one request produces one decision, no in-flight job
// to poll -- there is nothing here that can ever call Video/Photo Preview's
// own create/execute endpoints (see orchestrator-action-registry.ts's own
// header comment: every action is navigation-only).

export type ConciergeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; decision: OrchestratorDecision };

export interface UseConciergeContext {
  currentClientId?: string | null;
  currentAnalysisId?: string | null;
  hasCompletedPhotoPreview?: boolean;
}

export function useConcierge(context: UseConciergeContext = {}) {
  const [state, setState] = useState<ConciergeState>({ status: "idle" });

  const ask = useCallback(
    async (rawMessage: string) => {
      const body = buildOrchestrateRequestBody(rawMessage, context);
      if (!body) return;

      setState({ status: "loading" });
      try {
        const response = await fetch("/api/v1/concierge/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          setState({ status: "error" });
          return;
        }
        const payload = (await response.json()) as { decision: OrchestratorDecision };
        setState({ status: "ready", decision: payload.decision });
      } catch {
        setState({ status: "error" });
      }
    },
    [context],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, ask, reset };
}
