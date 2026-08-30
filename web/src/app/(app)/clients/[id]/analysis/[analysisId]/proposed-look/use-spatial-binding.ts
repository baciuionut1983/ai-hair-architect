import { useCallback, useEffect, useRef, useState } from "react";

import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";
import type { SpatialBindingEditOperation } from "@/lib/technical-visual-map-spatial-validators";

import { mapSpatialBindingApiError, resolveSpatialBindingLoadStatus } from "./spatial-binding-logic";

// Technical Visual Map, Stage 5C -- the data-fetching/action hook. Mirrors
// use-technical-visual-map.ts's plain fetch+useState+useEffect style
// exactly. Scoped to one exact TechnicalVisualMap; the map-wide history is
// always fetched, while "current" additionally requires a selected
// (sourceImageAssetId, viewLabel) pair -- until the professional has chosen
// both, the hook stays in a distinct "no-selection" state rather than
// fetching or fabricating a scope.

export type SpatialBindingState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "no-selection" }
  | {
      status: "ready";
      current: TechnicalVisualMapSpatialBindingRecord | null;
      history: TechnicalVisualMapSpatialBindingRecord[];
    };

export interface SpatialBindingActionSuccess {
  ok: true;
  binding: TechnicalVisualMapSpatialBindingRecord;
}

export interface SpatialBindingActionFailure {
  ok: false;
  status: number;
  code?: string;
  message: string;
}

export type SpatialBindingActionOutcome = SpatialBindingActionSuccess | SpatialBindingActionFailure;

export interface UseSpatialBindingResult {
  state: SpatialBindingState;
  reload: () => void;
  createDraft: () => Promise<SpatialBindingActionOutcome>;
  applyEdits: (bindingId: string, operations: SpatialBindingEditOperation[]) => Promise<SpatialBindingActionOutcome>;
  confirmDraft: (bindingId: string, expectedCurrentConfirmedSpatialBindingId: string | null) => Promise<SpatialBindingActionOutcome>;
}

interface ParsedErrorBody {
  error?: string;
  message?: string;
}

async function toActionOutcome(response: Response): Promise<SpatialBindingActionOutcome> {
  if (response.ok) {
    const body = (await response.json()) as { binding: TechnicalVisualMapSpatialBindingRecord };
    return { ok: true, binding: body.binding };
  }

  let body: ParsedErrorBody = {};
  try {
    body = (await response.json()) as ParsedErrorBody;
  } catch {
    // best-effort -- an empty/non-JSON error body still maps to a safe message below.
  }

  return { ok: false, status: response.status, code: body.error, message: mapSpatialBindingApiError(response.status, body.error) };
}

// "No selection" is purely derived from props -- it never needs its own
// setState call (which would otherwise run synchronously at the top of the
// effect body, exactly the pattern Stage 4 already found and fixed once).
// Only once a real (image, view) scope exists does the effect below ever
// touch fetch-driven state at all.
type FetchState = Exclude<SpatialBindingState, { status: "no-selection" }>;

export function useSpatialBinding(
  clientId: string,
  proposalId: string,
  technicalVisualMapId: string,
  sourceImageAssetId: string | null,
  viewLabel: string | null,
): UseSpatialBindingResult {
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const hasSelection = Boolean(sourceImageAssetId && viewLabel);

  const scopedBaseUrl = `/api/v1/clients/${clientId}/analysis-proposals/${proposalId}/technical-visual-maps/${technicalVisualMapId}/spatial-bindings`;

  // Tracks the (sourceImageAssetId, viewLabel) scope the LAST effect run
  // actually fetched, so a plain reload() of the SAME scope (e.g. right
  // after a successful Save/Confirm) can be told apart from a genuine scope
  // change (the professional picked a different photo/view).
  const lastFetchedScopeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasSelection || !sourceImageAssetId || !viewLabel) return;

    const scopeKey = `${sourceImageAssetId}::${viewLabel}`;
    const scopeChanged = lastFetchedScopeRef.current !== null && lastFetchedScopeRef.current !== scopeKey;
    lastFetchedScopeRef.current = scopeKey;

    let cancelled = false;

    void (async () => {
      // Reset to "loading" ONLY when the scope itself changed -- inside the
      // async callback, not synchronously in the effect body -- so switching
      // scopes never briefly shows the PREVIOUS scope's stale binding
      // mislabeled as the new one's. A reload() of the SAME scope (e.g. the
      // one every mutation action triggers on success) must NOT do this:
      // resetting to "loading" would flip SpatialBindingSection's rendered
      // branch away from "ready" mid-flight, unmounting
      // SpatialBindingDraftEditor, and remounting a FRESH instance once the
      // refetch completes -- silently erasing the just-set "Saved"
      // indicator and any edit made while the refetch was in flight. This is
      // the exact Stage 4 remount-erasure bug class, caught live here during
      // Stage 5C's own save-then-reload validation.
      if (scopeChanged) {
        setFetchState({ status: "loading" });
      }
      try {
        const [currentResponse, listResponse] = await Promise.all([
          fetch(`${scopedBaseUrl}/current?sourceImageAssetId=${encodeURIComponent(sourceImageAssetId)}&viewLabel=${encodeURIComponent(viewLabel)}`),
          fetch(scopedBaseUrl),
        ]);
        if (cancelled) return;

        if (resolveSpatialBindingLoadStatus(currentResponse) !== "ready" || resolveSpatialBindingLoadStatus(listResponse) !== "ready") {
          setFetchState({ status: "error" });
          return;
        }

        const currentBody = (await currentResponse.json()) as { binding: TechnicalVisualMapSpatialBindingRecord | null };
        const listBody = (await listResponse.json()) as { bindings: TechnicalVisualMapSpatialBindingRecord[] };
        if (cancelled) return;

        setFetchState({ status: "ready", current: currentBody.binding, history: listBody.bindings });
      } catch {
        if (!cancelled) setFetchState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scopedBaseUrl, sourceImageAssetId, viewLabel, reloadToken, hasSelection]);

  const state: SpatialBindingState = hasSelection ? fetchState : { status: "no-selection" };

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const createDraft = useCallback(async (): Promise<SpatialBindingActionOutcome> => {
    if (!sourceImageAssetId || !viewLabel) {
      return { ok: false, status: 0, message: "Select a source image and view first." };
    }
    try {
      const response = await fetch(scopedBaseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceImageAssetId, viewLabel }),
      });
      const outcome = await toActionOutcome(response);
      reload();
      return outcome;
    } catch {
      reload();
      return { ok: false, status: 0, message: mapSpatialBindingApiError(0) };
    }
  }, [scopedBaseUrl, sourceImageAssetId, viewLabel, reload]);

  const applyEdits = useCallback(
    async (bindingId: string, operations: SpatialBindingEditOperation[]): Promise<SpatialBindingActionOutcome> => {
      try {
        const response = await fetch(`${scopedBaseUrl}/${bindingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operations }),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapSpatialBindingApiError(0) };
      }
    },
    [scopedBaseUrl, reload],
  );

  const confirmDraft = useCallback(
    async (bindingId: string, expectedCurrentConfirmedSpatialBindingId: string | null): Promise<SpatialBindingActionOutcome> => {
      try {
        const response = await fetch(`${scopedBaseUrl}/${bindingId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedCurrentConfirmedSpatialBindingId }),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapSpatialBindingApiError(0) };
      }
    },
    [scopedBaseUrl, reload],
  );

  return { state, reload, createDraft, applyEdits, confirmDraft };
}
