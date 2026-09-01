import { useCallback, useEffect, useRef, useState } from "react";

import type { VideoDemonstrationStatusView } from "@/lib/video-demonstration-status-view";

import { isVideoDemonstrationInFlight, mapVideoDemonstrationApiError, resolveLatestVideoDemonstration } from "./video-demonstration-logic";

// Video UI, Result Visualization -- the data-fetching/action hook. Mirrors
// use-photo-preview.ts's plain fetch+useState+useEffect style, adapted for
// a genuinely different async shape (task §5/§7/§8 of this task; Stage 1's
// own architecture): Photo Preview's create call executes SYNCHRONOUSLY to
// completion in one request; Video's create call only performs ONE submit
// attempt (Stage 1 §23's own async design -- real generation takes up to
// 6 minutes per Veo's documented range, never awaited inline). Advancing a
// PROCESSING job to COMPLETED requires calling the existing, already-secured
// `[generationId]/execute` endpoint again -- this hook's own poll loop
// below does exactly that, repeatedly, while a job remains in flight.
//
// This is UI-experience polling ONLY (task §7/§8): it exists to keep an
// OPEN tab's own view current and to give the open tab a way to nudge its
// own job forward faster than the backend's own recovery-worker sweep
// would otherwise reach it -- it is never the ONLY mechanism a job can
// progress through (the backend's own claim/poll state machine, and
// (once scheduled) its recovery worker, are what actually make "you can
// leave this page" true). Closing the tab stops this hook's own polling
// entirely and harms nothing -- the job's own durable state is unaffected.

// Deliberately much longer than Photo Preview's own 4s recovery-only
// interval: Video generation is documented (Stage 0 research) to take
// 11 seconds to up to 6 minutes, so polling every few seconds would mean
// dozens of real provider status checks per job for no real UX benefit --
// a person watching a multi-minute operation does not need sub-10-second
// granularity. Not a backoff curve (kept simple, matching this hook's own
// "reasonable, not a tight loop" mandate rather than replicating the
// backend's own nextPollAt cadence policy client-side).
const VIDEO_DEMONSTRATION_UI_POLL_INTERVAL_MS = 8000;

export type VideoDemonstrationState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; history: VideoDemonstrationStatusView[]; pollingIssue: boolean };

export interface VideoDemonstrationActionSuccess {
  ok: true;
  generation: VideoDemonstrationStatusView;
}

export interface VideoDemonstrationActionFailure {
  ok: false;
  status: number;
  code?: string;
  message: string;
}

export type VideoDemonstrationActionOutcome = VideoDemonstrationActionSuccess | VideoDemonstrationActionFailure;

export interface UseVideoDemonstrationResult {
  state: VideoDemonstrationState;
  reload: () => void;
  create: () => Promise<VideoDemonstrationActionOutcome>;
  createVariation: () => Promise<VideoDemonstrationActionOutcome>;
}

interface ParsedErrorBody {
  error?: string;
  message?: string;
}

async function toActionOutcome(response: Response): Promise<VideoDemonstrationActionOutcome> {
  if (response.ok) {
    const body = (await response.json()) as { generation: VideoDemonstrationStatusView };
    return { ok: true, generation: body.generation };
  }

  let body: ParsedErrorBody = {};
  try {
    body = (await response.json()) as ParsedErrorBody;
  } catch {
    // best-effort -- an empty/non-JSON error body still maps to a safe message below.
  }

  return { ok: false, status: response.status, code: body.error, message: mapVideoDemonstrationApiError(response.status, body.error) };
}

export function useVideoDemonstration(clientId: string, photoPreviewGenerationId: string): UseVideoDemonstrationResult {
  const [state, setState] = useState<VideoDemonstrationState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  // True only while a create()/createVariation() fetch OR the poll loop's
  // own advance call is outstanding -- prevents two overlapping calls
  // (e.g. a slow poll tick still in flight when the interval fires again).
  const inFlightRef = useRef(false);
  const hasFetchedOnceRef = useRef(false);

  const listUrl = `/api/v1/clients/${clientId}/photo-preview-generations/${photoPreviewGenerationId}/video-demonstrations`;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Only the very first fetch shows a loading state -- a reload (from
      // a successful action, or the poll loop below) must never flip the
      // section back to "loading" (task §9: reload/return must never lose
      // context or flash the whole section away).
      if (!hasFetchedOnceRef.current) {
        setState({ status: "loading" });
      }
      try {
        const response = await fetch(listUrl);
        if (cancelled) return;

        if (!response.ok) {
          setState({ status: "error" });
          return;
        }

        const body = (await response.json()) as { generations: VideoDemonstrationStatusView[] };
        if (cancelled) return;

        hasFetchedOnceRef.current = true;
        setState({ status: "ready", history: body.generations, pollingIssue: false });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listUrl, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const latest = state.status === "ready" ? resolveLatestVideoDemonstration(state.history) : null;
  const hasInFlightGeneration = latest !== null && isVideoDemonstrationInFlight(latest.status);

  // task §7/§8 -- the UI-experience poll loop: while the latest generation
  // for this Photo Preview is REQUESTED/PROCESSING, periodically call its
  // own `/execute` endpoint (advance-and-refresh in one call) and update
  // local state from the response directly (no extra GET round trip).
  // Stops the moment the job reaches a terminal state, or this component
  // unmounts (task §8's own explicit requirement) -- never a tight loop
  // (fixed, multi-second interval), and a transient network failure during
  // a poll tick is recorded as a soft `pollingIssue` flag, never presented
  // as if the generation itself had failed (task §8/§21).
  useEffect(() => {
    if (!hasInFlightGeneration || !latest) return;

    let cancelled = false;
    const generationId = latest.id;
    const executeUrl = `/api/v1/clients/${clientId}/video-demonstrations/${generationId}/execute`;

    const interval = setInterval(() => {
      if (inFlightRef.current || cancelled) return;
      inFlightRef.current = true;
      void (async () => {
        try {
          const response = await fetch(executeUrl, { method: "POST" });
          if (cancelled) return;
          if (!response.ok) {
            // A transient HTTP-level failure (e.g. a momentary 503) --
            // never treated as the video itself having failed. The next
            // tick simply tries again.
            setState((current) => (current.status === "ready" ? { ...current, pollingIssue: true } : current));
            return;
          }
          const body = (await response.json()) as { generation: VideoDemonstrationStatusView };
          setState((current) => {
            if (current.status !== "ready") return current;
            const updatedHistory = current.history.map((entry) => (entry.id === body.generation.id ? body.generation : entry));
            return { status: "ready", history: updatedHistory, pollingIssue: false };
          });
        } catch {
          if (!cancelled) {
            setState((current) => (current.status === "ready" ? { ...current, pollingIssue: true } : current));
          }
        } finally {
          inFlightRef.current = false;
        }
      })();
    }, VIDEO_DEMONSTRATION_UI_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `latest` is intentionally re-derived from `state` above, not listed directly: including the whole object would restart this effect (and its interval) on every poll tick's own state update, defeating the interval entirely. hasInFlightGeneration + latest.id + latest.status together capture every actual restart condition (a different generation becoming the "latest" one, or its status changing to/from terminal).
  }, [clientId, hasInFlightGeneration, latest?.id, latest?.status]);

  const submit = useCallback(
    async (body: Record<string, unknown>): Promise<VideoDemonstrationActionOutcome> => {
      inFlightRef.current = true;
      try {
        const response = await fetch(listUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapVideoDemonstrationApiError(0) };
      } finally {
        inFlightRef.current = false;
      }
    },
    [listUrl, reload],
  );

  // task §3 -- the ONLY body ever sent is `{}` (a fresh generation) or
  // `{variation: true}` (task §12's own retry contract: a brand-new,
  // auditable job, never a resurrection of a terminally-failed one's own
  // provider operation). No provider, no model, no asset id, no status --
  // the server resolves everything from photoPreviewGenerationId alone
  // (already embedded in `listUrl`, never re-sent in the body).
  const create = useCallback(() => submit({}), [submit]);
  const createVariation = useCallback(() => submit({ variation: true }), [submit]);

  return { state, reload, create, createVariation };
}
