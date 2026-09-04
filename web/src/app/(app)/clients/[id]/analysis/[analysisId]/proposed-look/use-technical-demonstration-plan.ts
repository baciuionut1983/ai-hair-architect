import { useCallback, useEffect, useState } from "react";

import type { TechnicalDemonstrationPlanRecord, TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import type { CuttingStepOverrideInput } from "@/lib/technical-demonstration-cutting-overrides";

import { findExistingDraftPlan, mapTechnicalDemonstrationPlanApiError, resolveTechnicalDemonstrationPlanLoadStatus } from "./technical-demonstration-plan-logic";

// Technical Demonstration, Stage 2 -- the data-fetching/action hook. Mirrors
// use-technical-visual-map.ts's plain fetch+useState+useEffect style exactly
// (no SWR/React Query -- none is used anywhere in this codebase). Scoped to
// one exact (clientId, proposalId) pair -- the CONFIRMED proposal a plan is
// derived from. A caller must pass the LIVE current confirmed proposal id;
// if that proposal is later superseded by a new one, the parent naturally
// passes a new proposalId (and a new `key`), and this hook re-fetches a
// fresh, unrelated scope -- an old plan for a superseded proposal can never
// masquerade as current, because it is simply never fetched once the scope
// changes.

export interface TechnicalDemonstrationPlanWithSteps {
  plan: TechnicalDemonstrationPlanRecord;
  steps: TechnicalDemonstrationStepRecord[];
  // Stage 2.5.b -- steps + professionalOverrides applied, resolved
  // server-side (technical-demonstration-repository.ts's own
  // resolveEffectiveCuttingStepsForRecord). The UI always renders THIS,
  // never `steps` directly.
  effectiveSteps: TechnicalDemonstrationStepRecord[];
}

export type TechnicalDemonstrationPlanState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      // The CONFIRMED plan for this scope, if any -- authoritative, sourced
      // from the /current endpoint, never re-derived from history/"latest"
      // ordering client-side.
      current: TechnicalDemonstrationPlanWithSteps | null;
      // A DRAFT plan awaiting professional review, if any -- found via the
      // history list, its own steps fetched separately (the list endpoint
      // returns bare metadata only).
      draft: TechnicalDemonstrationPlanWithSteps | null;
      history: TechnicalDemonstrationPlanRecord[];
    };

export interface TechnicalDemonstrationPlanActionSuccess {
  ok: true;
  plan: TechnicalDemonstrationPlanRecord;
  steps: TechnicalDemonstrationStepRecord[];
  effectiveSteps: TechnicalDemonstrationStepRecord[];
}

export interface TechnicalDemonstrationPlanActionFailure {
  ok: false;
  status: number;
  code?: string;
  message: string;
}

export type TechnicalDemonstrationPlanActionOutcome = TechnicalDemonstrationPlanActionSuccess | TechnicalDemonstrationPlanActionFailure;

export interface UseTechnicalDemonstrationPlanResult {
  state: TechnicalDemonstrationPlanState;
  reload: () => void;
  deriveOrOpen: () => Promise<TechnicalDemonstrationPlanActionOutcome>;
  confirmPlan: (planId: string, expectedCurrentConfirmedPlanId: string | null) => Promise<TechnicalDemonstrationPlanActionOutcome>;
  // Stage 2.5.b -- append professional overrides to a DRAFT plan. Legal
  // only while DRAFT (server-enforced; see applyOverridesToDraft's own
  // guard) -- the route/repository reject a CONFIRMED plan's own attempt
  // with a 409, never silently reopening it.
  applyOverrides: (planId: string, overrides: CuttingStepOverrideInput[]) => Promise<TechnicalDemonstrationPlanActionOutcome>;
}

interface ParsedErrorBody {
  error?: string;
  message?: string;
}

async function toActionOutcome(response: Response): Promise<TechnicalDemonstrationPlanActionOutcome> {
  if (response.ok) {
    const body = (await response.json()) as {
      plan: TechnicalDemonstrationPlanRecord;
      steps: TechnicalDemonstrationStepRecord[];
      effectiveSteps: TechnicalDemonstrationStepRecord[];
    };
    return { ok: true, plan: body.plan, steps: body.steps, effectiveSteps: body.effectiveSteps };
  }

  let body: ParsedErrorBody = {};
  try {
    body = (await response.json()) as ParsedErrorBody;
  } catch {
    // best-effort -- an empty/non-JSON error body still maps to a safe message below.
  }

  return {
    ok: false,
    status: response.status,
    code: body.error,
    message: mapTechnicalDemonstrationPlanApiError(response.status, body.error),
  };
}

function baseUrl(clientId: string, proposalId: string): string {
  return `/api/v1/clients/${clientId}/analysis-proposals/${proposalId}/technical-demonstration-plans`;
}

export function useTechnicalDemonstrationPlan(clientId: string, proposalId: string): UseTechnicalDemonstrationPlanResult {
  const [state, setState] = useState<TechnicalDemonstrationPlanState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [currentResponse, listResponse] = await Promise.all([
          fetch(`${baseUrl(clientId, proposalId)}/current`, { method: "GET" }),
          fetch(baseUrl(clientId, proposalId), { method: "GET" }),
        ]);
        if (cancelled) return;

        if (
          resolveTechnicalDemonstrationPlanLoadStatus(currentResponse) !== "ready" ||
          resolveTechnicalDemonstrationPlanLoadStatus(listResponse) !== "ready"
        ) {
          setState({ status: "error" });
          return;
        }

        const currentBody = (await currentResponse.json()) as {
          plan: TechnicalDemonstrationPlanRecord | null;
          steps: TechnicalDemonstrationStepRecord[];
          effectiveSteps: TechnicalDemonstrationStepRecord[];
        };
        const listBody = (await listResponse.json()) as { plans: TechnicalDemonstrationPlanRecord[] };
        if (cancelled) return;

        const draftMeta = findExistingDraftPlan(listBody.plans);
        let draft: TechnicalDemonstrationPlanWithSteps | null = null;
        if (draftMeta) {
          const draftResponse = await fetch(`${baseUrl(clientId, proposalId)}/${draftMeta.id}`, { method: "GET" });
          if (cancelled) return;
          if (resolveTechnicalDemonstrationPlanLoadStatus(draftResponse) === "ready") {
            const draftBody = (await draftResponse.json()) as {
              plan: TechnicalDemonstrationPlanRecord;
              steps: TechnicalDemonstrationStepRecord[];
              effectiveSteps: TechnicalDemonstrationStepRecord[];
            };
            draft = { plan: draftBody.plan, steps: draftBody.steps, effectiveSteps: draftBody.effectiveSteps };
          }
        }
        if (cancelled) return;

        setState({
          status: "ready",
          current: currentBody.plan ? { plan: currentBody.plan, steps: currentBody.steps, effectiveSteps: currentBody.effectiveSteps } : null,
          draft,
          history: listBody.plans,
        });
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, proposalId, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // Idempotent by construction (the Stage 1 repository resolves an
  // already-derived plan for the same confirmed proposal instead of
  // duplicating it) -- safe to call from an explicit "Open Technical
  // Demonstration Plan" action without risking a duplicate write.
  const deriveOrOpen = useCallback(async (): Promise<TechnicalDemonstrationPlanActionOutcome> => {
    try {
      const response = await fetch(baseUrl(clientId, proposalId), { method: "POST" });
      const outcome = await toActionOutcome(response);
      reload();
      return outcome;
    } catch {
      reload();
      return { ok: false, status: 0, message: mapTechnicalDemonstrationPlanApiError(0) };
    }
  }, [clientId, proposalId, reload]);

  const confirmPlan = useCallback(
    async (planId: string, expectedCurrentConfirmedPlanId: string | null): Promise<TechnicalDemonstrationPlanActionOutcome> => {
      try {
        const response = await fetch(`${baseUrl(clientId, proposalId)}/${planId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedCurrentConfirmedPlanId }),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapTechnicalDemonstrationPlanApiError(0) };
      }
    },
    [clientId, proposalId, reload],
  );

  // Stage 2.5.b -- PATCH the DRAFT plan's own professionalOverrides.
  // `overrides` are the caller-suppliable CuttingStepOverrideInput shape
  // only (op/stepNumber/field/value?/reason?) -- source/setAt are always
  // server-stamped, never sent from here.
  const applyOverrides = useCallback(
    async (planId: string, overrides: CuttingStepOverrideInput[]): Promise<TechnicalDemonstrationPlanActionOutcome> => {
      try {
        const response = await fetch(`${baseUrl(clientId, proposalId)}/${planId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides }),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapTechnicalDemonstrationPlanApiError(0) };
      }
    },
    [clientId, proposalId, reload],
  );

  return { state, reload, deriveOrOpen, confirmPlan, applyOverrides };
}
