import { useCallback, useEffect, useState } from "react";

import type { HairStateSnapshotRecord } from "@/lib/hair-state-snapshot-repository";
import type { HairStateDeltaSkillSelectionResult } from "@/lib/hair-state-delta-skill-candidate-selector";
import type { HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import type { ProfessionalBrainStylingGapReport } from "@/lib/professional-brain-styling-gap";

import { mapProfessionalBrainApiError } from "./professional-brain-logic";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW hook. Mirrors
// use-proposed-look.ts's own exact skeleton: ONE hook owns all
// server-derived state for this page; every mutating action funnels
// through a shared outcome shape and reloads on both success and failure,
// so the view is never left showing stale data after an action. Plain
// fetch + useState/useEffect (no SWR/React Query -- none is used anywhere
// in this codebase).

export interface ProfessionalBrainEvaluationData {
  currentSnapshot: HairStateSnapshotRecord | null;
  targetSnapshot: HairStateSnapshotRecord | null;
  evaluation: HairStateDeltaSkillSelectionResult | null;
  // "CORECȚIE B2.2 ÎNAINTE DE RELEASE" -- non-null exactly when both
  // states are confirmed AND the active domain intent includes STYLING
  // (which has no engine); `evaluation` stays null in that case, this
  // carries the real, itemized gap report instead. See the evaluation
  // route's own header.
  stylingGap: ProfessionalBrainStylingGapReport | null;
}

export type ProfessionalBrainState = { status: "loading" } | { status: "error" } | ({ status: "ready" } & ProfessionalBrainEvaluationData);

export interface ProfessionalBrainActionSuccess {
  ok: true;
  // B2.1 -- carries the created/confirmed row straight back to the
  // caller, independent of what the next `evaluation` GET's own
  // pickSnapshot (CONFIRMED-always-wins) would return. This is what lets
  // the page track a brand-new DRAFT round-2 snapshot locally while an
  // older CONFIRMED pair is still what `state.currentSnapshot`/
  // `targetSnapshot` report -- see page.tsx's own "start a new
  // evaluation" flow.
  snapshot: HairStateSnapshotRecord;
}
export interface ProfessionalBrainActionFailure {
  ok: false;
  status: number;
  code?: string;
  message: string;
}
export type ProfessionalBrainActionOutcome = ProfessionalBrainActionSuccess | ProfessionalBrainActionFailure;

export interface UseProfessionalBrainEvaluationResult {
  state: ProfessionalBrainState;
  reload: () => void;
  createCurrentState: (payload: HairStateSnapshotPayload) => Promise<ProfessionalBrainActionOutcome>;
  createTargetState: (payload: HairStateSnapshotPayload) => Promise<ProfessionalBrainActionOutcome>;
  confirmSnapshot: (snapshotId: string, expectedCurrentConfirmedSnapshotId: string | null) => Promise<ProfessionalBrainActionOutcome>;
}

async function toActionOutcome(response: Response): Promise<ProfessionalBrainActionOutcome> {
  if (response.ok) {
    const body = (await response.json()) as { snapshot: HairStateSnapshotRecord };
    return { ok: true, snapshot: body.snapshot };
  }
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: string };
    code = body.error;
  } catch {
    code = undefined;
  }
  return { ok: false, status: response.status, code, message: mapProfessionalBrainApiError(response.status, code) };
}

export function useProfessionalBrainEvaluation(clientId: string): UseProfessionalBrainEvaluationResult {
  const [state, setState] = useState<ProfessionalBrainState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
      try {
        const response = await fetch(`/api/v1/clients/${clientId}/professional-brain/evaluation`, { method: "GET" });
        if (cancelled) return;
        if (!response.ok) {
          setState({ status: "error" });
          return;
        }
        const data = (await response.json()) as ProfessionalBrainEvaluationData;
        setState({ status: "ready", ...data });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const createCurrentState = useCallback(
    async (payload: HairStateSnapshotPayload): Promise<ProfessionalBrainActionOutcome> => {
      const response = await fetch(`/api/v1/clients/${clientId}/professional-brain/current-state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const outcome = await toActionOutcome(response);
      reload();
      return outcome;
    },
    [clientId, reload],
  );

  const createTargetState = useCallback(
    async (payload: HairStateSnapshotPayload): Promise<ProfessionalBrainActionOutcome> => {
      const response = await fetch(`/api/v1/clients/${clientId}/professional-brain/target-state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const outcome = await toActionOutcome(response);
      reload();
      return outcome;
    },
    [clientId, reload],
  );

  const confirmSnapshot = useCallback(
    async (snapshotId: string, expectedCurrentConfirmedSnapshotId: string | null): Promise<ProfessionalBrainActionOutcome> => {
      const response = await fetch(`/api/v1/clients/${clientId}/professional-brain/snapshots/${snapshotId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedCurrentConfirmedSnapshotId }),
      });
      const outcome = await toActionOutcome(response);
      reload();
      return outcome;
    },
    [clientId, reload],
  );

  return { state, reload, createCurrentState, createTargetState, confirmSnapshot };
}
