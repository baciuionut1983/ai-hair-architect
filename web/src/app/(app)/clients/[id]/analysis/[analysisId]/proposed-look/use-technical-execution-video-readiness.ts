import { useEffect, useState } from "react";

import type { PlanReadinessResult } from "@/lib/technical-demonstration-cutting-video-readiness";

// Technical Demonstration, Stage 2.5.c -- the readiness-gate fetch hook.
// Mirrors use-technical-demonstration-plan.ts's own plain fetch+useState+
// useEffect style exactly (no SWR/React Query anywhere in this codebase).
// Deliberately its OWN small hook, not folded into
// useTechnicalDemonstrationPlan -- readiness is a separate, derived
// concern (its own GET endpoint, its own "only meaningful for a CONFIRMED
// plan" gating) with no write actions of its own, unlike that hook's own
// deriveOrOpen/confirmPlan/applyOverrides.
//
// `planId` is null whenever there is no CONFIRMED plan to ask about (the
// caller passes `current?.plan.id ?? null`) -- this hook then stays
// "idle" and never fetches, matching the Stage 2.5.c core semantic lock:
// only a CONFIRMED plan can ever be VIDEO_READY, so there is nothing
// honest to compute for a DRAFT/absent plan.

export type TechnicalExecutionVideoReadinessState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; readiness: PlanReadinessResult };

// "idle" is purely DERIVED from `planId` being null -- it never needs its
// own setState call (which would otherwise run synchronously at the top of
// the effect body, the exact react-hooks/set-state-in-effect pattern
// use-spatial-binding.ts's own "no-selection" state already found and
// fixed once). Only real fetch-driven states live in useState.
type FetchState = Exclude<TechnicalExecutionVideoReadinessState, { status: "idle" }>;

export function useTechnicalExecutionVideoReadiness(
  clientId: string,
  proposalId: string,
  planId: string | null,
): TechnicalExecutionVideoReadinessState {
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!planId) return; // "idle" is derived below -- nothing to fetch, nothing to set.

    let cancelled = false;

    void (async () => {
      // Set inside the async callback, not synchronously in the effect
      // body -- matches use-spatial-binding.ts's own fix for the identical
      // react-hooks/set-state-in-effect pattern.
      setFetchState({ status: "loading" });
      try {
        const response = await fetch(
          `/api/v1/clients/${clientId}/analysis-proposals/${proposalId}/technical-demonstration-plans/${planId}/readiness`,
          { method: "GET" },
        );
        if (cancelled) return;
        if (!response.ok) {
          setFetchState({ status: "error" });
          return;
        }
        const body = (await response.json()) as { readiness: PlanReadinessResult };
        if (cancelled) return;
        setFetchState({ status: "ready", readiness: body.readiness });
      } catch {
        if (!cancelled) setFetchState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, proposalId, planId]);

  if (!planId) return { status: "idle" };
  return fetchState;
}
