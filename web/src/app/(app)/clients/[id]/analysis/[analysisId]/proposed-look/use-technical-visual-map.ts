import { useCallback, useEffect, useState } from "react";

import type { TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import type { MapAdjustmentEntry, TechnicalVisualMapPayload } from "@/lib/technical-visual-map-validators";

import { mapTechnicalVisualMapApiError, resolveTechnicalVisualMapLoadStatus } from "./technical-visual-map-logic";

// Technical Visual Map, Stage 4 -- the data-fetching/action hook. Mirrors
// use-proposed-look.ts's plain fetch+useState+useEffect style exactly (no
// SWR/React Query -- none is used anywhere in this codebase). Scoped to one
// exact (clientId, proposalId) pair -- the CONFIRMED proposal a map is bound
// to. A caller must pass the LIVE current confirmed proposal id; if that
// proposal is later superseded by a new one, the parent naturally passes a
// new proposalId and this hook re-fetches a fresh, unrelated scope -- it
// never silently retargets an existing map to a different proposal.

export type TechnicalVisualMapState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      current: TechnicalVisualMapRecord | null;
      currentEffective: TechnicalVisualMapPayload | null;
      history: TechnicalVisualMapRecord[];
    };

export interface TechnicalVisualMapActionSuccess {
  ok: true;
  map: TechnicalVisualMapRecord;
  effectiveMap: TechnicalVisualMapPayload;
}

export interface TechnicalVisualMapActionFailure {
  ok: false;
  status: number;
  code?: string;
  message: string;
}

export type TechnicalVisualMapActionOutcome = TechnicalVisualMapActionSuccess | TechnicalVisualMapActionFailure;

export interface UseTechnicalVisualMapResult {
  state: TechnicalVisualMapState;
  reload: () => void;
  createDraft: () => Promise<TechnicalVisualMapActionOutcome>;
  applyAdjustments: (mapId: string, adjustments: MapAdjustmentEntry[]) => Promise<TechnicalVisualMapActionOutcome>;
  confirmDraft: (mapId: string, expectedCurrentConfirmedMapId: string | null) => Promise<TechnicalVisualMapActionOutcome>;
}

interface ParsedErrorBody {
  error?: string;
  message?: string;
}

async function toActionOutcome(response: Response): Promise<TechnicalVisualMapActionOutcome> {
  if (response.ok) {
    const body = (await response.json()) as { map: TechnicalVisualMapRecord; effectiveMap: TechnicalVisualMapPayload };
    return { ok: true, map: body.map, effectiveMap: body.effectiveMap };
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
    message: mapTechnicalVisualMapApiError(response.status, body.error),
  };
}

function baseUrl(clientId: string, proposalId: string): string {
  return `/api/v1/clients/${clientId}/analysis-proposals/${proposalId}/technical-visual-maps`;
}

export function useTechnicalVisualMap(clientId: string, proposalId: string): UseTechnicalVisualMapResult {
  const [state, setState] = useState<TechnicalVisualMapState>({ status: "loading" });
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
          resolveTechnicalVisualMapLoadStatus(currentResponse) !== "ready" ||
          resolveTechnicalVisualMapLoadStatus(listResponse) !== "ready"
        ) {
          setState({ status: "error" });
          return;
        }

        const currentBody = (await currentResponse.json()) as {
          map: TechnicalVisualMapRecord | null;
          effectiveMap: TechnicalVisualMapPayload | null;
        };
        const listBody = (await listResponse.json()) as { maps: TechnicalVisualMapRecord[] };
        if (cancelled) return;

        setState({
          status: "ready",
          current: currentBody.map,
          currentEffective: currentBody.effectiveMap,
          history: listBody.maps,
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

  const createDraft = useCallback(async (): Promise<TechnicalVisualMapActionOutcome> => {
    try {
      const response = await fetch(baseUrl(clientId, proposalId), { method: "POST" });
      const outcome = await toActionOutcome(response);
      reload();
      return outcome;
    } catch {
      reload();
      return { ok: false, status: 0, message: mapTechnicalVisualMapApiError(0) };
    }
  }, [clientId, proposalId, reload]);

  const applyAdjustments = useCallback(
    async (mapId: string, adjustments: MapAdjustmentEntry[]): Promise<TechnicalVisualMapActionOutcome> => {
      try {
        const response = await fetch(`${baseUrl(clientId, proposalId)}/${mapId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adjustments }),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapTechnicalVisualMapApiError(0) };
      }
    },
    [clientId, proposalId, reload],
  );

  const confirmDraft = useCallback(
    async (mapId: string, expectedCurrentConfirmedMapId: string | null): Promise<TechnicalVisualMapActionOutcome> => {
      try {
        const response = await fetch(`${baseUrl(clientId, proposalId)}/${mapId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedCurrentConfirmedMapId }),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapTechnicalVisualMapApiError(0) };
      }
    },
    [clientId, proposalId, reload],
  );

  return { state, reload, createDraft, applyAdjustments, confirmDraft };
}
