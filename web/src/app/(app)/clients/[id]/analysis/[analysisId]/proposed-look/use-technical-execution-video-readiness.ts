import { useEffect, useState } from "react";

import type { PlanReadinessResult } from "@/lib/technical-demonstration-cutting-video-readiness";

// Technical Demonstration, Stage 2.5.c -- the readiness-gate fetch hook.
// Mirrors use-technical-demonstration-plan.ts's own plain fetch+useState+
// useEffect style exactly (no SWR/React Query anywhere in this codebase).
// Deliberately its OWN small hook, not folded into
// useTechnicalDemonstrationPlan -- readiness is a separate, derived
// concern (its own GET endpoint) with no write actions of its own, unlike
// that hook's own deriveOrOpen/confirmPlan/applyOverrides.
//
// `planId` is null whenever there is no plan to ask about at all -- this
// hook then stays "idle" and never fetches. The caller (DRAFT readiness
// visibility fix) resolves WHICH plan's id to pass via
// resolveReadinessTargetPlan (technical-demonstration-plan-logic.ts) --
// this hook itself has no opinion on DRAFT vs CONFIRMED; it fetches
// whatever plan id it is given and renders the server's own answer
// verbatim (a DRAFT's own answer is always `ready: false` with a
// READINESS_PLAN_NOT_CONFIRMED reason, computed server-side by
// evaluatePlanReadiness -- never assumed or special-cased here).
//
// `planUpdatedAt` (Stage 2.5.c DRAFT readiness visibility fix) -- an
// additional effect dependency, independent of `planId`. A professional
// edit (applyOverrides) never changes the plan's own id, only its
// `updatedAt` (and its professionalOverrides) -- so without this, editing
// a field would correctly trigger useTechnicalDemonstrationPlan's own
// reload() but would NOT re-trigger THIS hook's effect (same planId as
// before), leaving a stale readiness result on screen. Passing the
// target plan's own `updatedAt` alongside its id means a genuine write
// (which always bumps `updatedAt`) reliably refetches, while a reload
// that changed nothing (e.g. after a failed edit) correctly does not.

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
  planUpdatedAt?: string | null,
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
  }, [clientId, proposalId, planId, planUpdatedAt]);

  if (!planId) return { status: "idle" };
  return fetchState;
}
