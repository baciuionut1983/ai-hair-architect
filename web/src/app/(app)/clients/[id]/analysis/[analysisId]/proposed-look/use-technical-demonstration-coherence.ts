import { useEffect, useState } from "react";

import type { CoherenceEvaluation } from "@/lib/technical-demonstration-cutting-coherence";

// The route's own response shape (technical-demonstration-plans/[planId]/
// coherence/route.ts exports it as TechnicalDemonstrationCoherenceResponse)
// -- mirrored here rather than imported from that route module, matching
// this codebase's own established convention (the sibling readiness hook
// imports PlanReadinessResult from the LIB engine, never from
// readiness/route.ts). Both shapes are exactly CoherenceEvaluation plus
// the same 3 identity/version fields, so they stay structurally identical
// by construction.
export interface TechnicalDemonstrationCoherenceResult extends CoherenceEvaluation {
  planId: string;
  planVersion: number;
  coherenceRulesVersion: string;
}

// Technical Demonstration, Stage 2.5.g.2 -- the Professional Coherence
// fetch hook. Mirrors use-technical-execution-video-readiness.ts's own
// plain fetch+useState+useEffect style EXACTLY, including its own
// `planId`/`planUpdatedAt` dependency pair -- this is deliberate, not
// incidental: coherence needs the identical "which plan, has it changed"
// identity/refresh guarantee readiness already has, so reusing the same
// shape (rather than inventing a new one) is what makes the two guarantees
// (Stage 2.5.g.2's own "never show a stale/wrong plan's result" and
// "refetch after a professional edit" requirements) true by construction,
// already proven correct by readiness's own identical mechanism (see that
// hook's own header comment for the full reasoning).
//
// `planId` is null whenever there is no plan to ask about at all -- this
// hook then stays "idle" and never fetches, exactly like the readiness
// hook. The caller passes the SAME target plan (via
// resolveReadinessTargetPlan, technical-demonstration-plan-logic.ts) it
// already uses for readiness -- coherence and readiness always describe
// the exact same displayed plan, never two different ones.

export type TechnicalDemonstrationCoherenceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; coherence: TechnicalDemonstrationCoherenceResult };

type FetchState = Exclude<TechnicalDemonstrationCoherenceState, { status: "idle" }>;

export function useTechnicalDemonstrationCoherence(
  clientId: string,
  proposalId: string,
  planId: string | null,
  planUpdatedAt?: string | null,
): TechnicalDemonstrationCoherenceState {
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!planId) return; // "idle" is derived below -- nothing to fetch, nothing to set.

    let cancelled = false;

    void (async () => {
      setFetchState({ status: "loading" });
      try {
        const response = await fetch(
          `/api/v1/clients/${clientId}/analysis-proposals/${proposalId}/technical-demonstration-plans/${planId}/coherence`,
          { method: "GET" },
        );
        if (cancelled) return;
        if (!response.ok) {
          setFetchState({ status: "error" });
          return;
        }
        const body = (await response.json()) as { coherence: TechnicalDemonstrationCoherenceResult };
        if (cancelled) return;
        setFetchState({ status: "ready", coherence: body.coherence });
      } catch {
        if (!cancelled) setFetchState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, proposalId, planId, planUpdatedAt]);

  if (!planId) return { status: "idle" };
  return fetchState;
}
