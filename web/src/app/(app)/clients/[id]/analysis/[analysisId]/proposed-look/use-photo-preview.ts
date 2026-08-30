import { useCallback, useEffect, useRef, useState } from "react";

import type { PhotoPreviewGenerationRecord } from "@/lib/photo-preview-generation-repository";
import type { PhotoPreviewExecutionResult } from "@/lib/photo-preview-execution-service";

import { findInFlightPhotoPreviewGenerationIds, mapPhotoPreviewApiError, resolvePhotoPreviewLoadStatus } from "./photo-preview-logic";

// Real AI Photo Preview, Stage 3 -- the data-fetching/action hook. Mirrors
// use-spatial-binding.ts's plain fetch+useState+useEffect style exactly.
// Scoped to one exact, already-CONFIRMED spatial binding (the caller --
// photo-preview-section.tsx -- is only ever rendered for one at a time, and
// remounts fresh via `key={current.id}` if the binding itself changes, the
// same convention spatial-binding-section.tsx already uses for
// technicalVisualMapId).
//
// task #10/#23 -- the POST create route executes SYNCHRONOUSLY (create, then
// immediately attempt execution, in the same request/response cycle). This
// hook's generate()/generateVariation() simply await that one fetch; no
// separate "kick off, then poll for completion" dance is needed for the
// professional's own click. Polling below exists for a genuinely different,
// narrower purpose (task #11): recovering a row that is still REQUESTED/
// PROCESSING because a PREVIOUS request was interrupted (e.g. the tab closed
// mid-flight) -- never for the current click's own in-flight fetch, which
// already owns its own result.

const PHOTO_PREVIEW_POLL_INTERVAL_MS = 4000;

export type PhotoPreviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; history: PhotoPreviewGenerationRecord[] };

export interface PhotoPreviewActionSuccess {
  ok: true;
  generation: PhotoPreviewGenerationRecord;
  executionOutcome: PhotoPreviewExecutionResult;
}

export interface PhotoPreviewActionFailure {
  ok: false;
  status: number;
  code?: string;
  message: string;
}

export type PhotoPreviewActionOutcome = PhotoPreviewActionSuccess | PhotoPreviewActionFailure;

export interface UsePhotoPreviewResult {
  state: PhotoPreviewState;
  reload: () => void;
  generate: () => Promise<PhotoPreviewActionOutcome>;
  generateVariation: () => Promise<PhotoPreviewActionOutcome>;
}

interface ParsedErrorBody {
  error?: string;
  message?: string;
}

async function toActionOutcome(response: Response): Promise<PhotoPreviewActionOutcome> {
  if (response.ok) {
    const body = (await response.json()) as { generation: PhotoPreviewGenerationRecord; executionOutcome: PhotoPreviewExecutionResult };
    return { ok: true, generation: body.generation, executionOutcome: body.executionOutcome };
  }

  let body: ParsedErrorBody = {};
  try {
    body = (await response.json()) as ParsedErrorBody;
  } catch {
    // best-effort -- an empty/non-JSON error body still maps to a safe message below.
  }

  return { ok: false, status: response.status, code: body.error, message: mapPhotoPreviewApiError(response.status, body.error) };
}

export function usePhotoPreview(
  clientId: string,
  proposalId: string,
  technicalVisualMapId: string,
  spatialBindingId: string,
): UsePhotoPreviewResult {
  const [state, setState] = useState<PhotoPreviewState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  // True only while THIS hook's own generate()/generateVariation() fetch is
  // outstanding -- the poll effect below skips its own reload while one is
  // in flight, since that fetch already owns bringing back the fresh result.
  const submittingRef = useRef(false);
  const hasFetchedOnceRef = useRef(false);

  const scopedBaseUrl = `/api/v1/clients/${clientId}/analysis-proposals/${proposalId}/technical-visual-maps/${technicalVisualMapId}/spatial-bindings/${spatialBindingId}/photo-preview-generations`;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Only the very FIRST fetch shows a loading state -- a reload (from a
      // successful generate/variation action, or from the recovery poll
      // below) must never flip the section back to "loading", which would
      // unmount and remount every child and erase any local, ephemeral UI
      // state (task #30's own regression class).
      if (!hasFetchedOnceRef.current) {
        setState({ status: "loading" });
      }
      try {
        const response = await fetch(scopedBaseUrl);
        if (cancelled) return;

        if (resolvePhotoPreviewLoadStatus(response) !== "ready") {
          setState({ status: "error" });
          return;
        }

        const body = (await response.json()) as { generations: PhotoPreviewGenerationRecord[] };
        if (cancelled) return;

        hasFetchedOnceRef.current = true;
        setState({ status: "ready", history: body.generations });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scopedBaseUrl, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // task #11 -- light recovery polling, only while a row is genuinely
  // in-flight, and only ever a plain history refetch (no per-row endpoint
  // needed at this cadence). Stops as soon as no row remains REQUESTED/
  // PROCESSING; cleaned up on unmount and whenever this flips back to false.
  const hasInFlightGeneration = state.status === "ready" && findInFlightPhotoPreviewGenerationIds(state.history).length > 0;

  useEffect(() => {
    if (!hasInFlightGeneration) return;

    const interval = setInterval(() => {
      if (!submittingRef.current) reload();
    }, PHOTO_PREVIEW_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [hasInFlightGeneration, reload]);

  const submit = useCallback(
    async (body: Record<string, unknown>): Promise<PhotoPreviewActionOutcome> => {
      submittingRef.current = true;
      try {
        const response = await fetch(scopedBaseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapPhotoPreviewApiError(0) };
      } finally {
        submittingRef.current = false;
      }
    },
    [scopedBaseUrl, reload],
  );

  const generate = useCallback(() => submit({}), [submit]);
  const generateVariation = useCallback(() => submit({ variation: true }), [submit]);

  return { state, reload, generate, generateVariation };
}
