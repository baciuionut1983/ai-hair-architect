"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Alert, Button, ErrorState, LoadingState } from "@/components/ui";
import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";

import { PhotoPreviewHistoryList } from "./photo-preview-history";
import {
  getPhotoPreviewViewLabel,
  isPhotoPreviewGenerationActivelyInFlight,
  isPhotoPreviewGenerationRecoverable,
  mapPhotoPreviewFailureCodeToMessage,
} from "./photo-preview-logic";
import { type PhotoPreviewActionOutcome, usePhotoPreview } from "./use-photo-preview";

export interface PhotoPreviewSectionProps {
  clientId: string;
  proposalId: string;
  technicalVisualMapId: string;
  // The CONFIRMED spatial binding this section is scoped to -- the caller
  // (spatial-binding-section.tsx) only ever renders this component when
  // `current` (a real CONFIRMED binding) exists, matching the locked
  // hierarchy: Analysis -> Current Approved Look -> Technical Visual Map ->
  // Spatial Mapping -> AI Photo Preview (task #1). Eligibility is never
  // re-derived here: the create/variation API calls this section makes
  // re-verify the FULL confirmed chain server-side on every request (task
  // #2) -- this prop only decides whether the section renders at all.
  binding: TechnicalVisualMapSpatialBindingRecord;
}

type PendingAction = "generate" | "variation" | "retry" | null;

// Real AI Photo Preview, Stage 3 -- the top-level orchestrator. Rendered
// immediately downstream of the confirmed Spatial Binding. This is the ONLY
// component that calls usePhotoPreview and owns the explicit Generate/
// variation actions and their transient result messaging -- every child
// below is presentational.
export function PhotoPreviewSection({ clientId, proposalId, technicalVisualMapId, binding }: PhotoPreviewSectionProps) {
  const { state, generate, generateVariation, retry } = usePhotoPreview(clientId, proposalId, technicalVisualMapId, binding.id);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionMessage, setActionMessage] = useState<{ variant: "error" | "info"; text: string } | null>(null);

  function applyActionOutcome(outcome: PhotoPreviewActionOutcome) {
    if (!outcome.ok) {
      setActionMessage({ variant: "error", text: outcome.message });
      return;
    }
    if (outcome.executionOutcome.outcome === "failed") {
      setActionMessage({ variant: "error", text: mapPhotoPreviewFailureCodeToMessage(outcome.executionOutcome.code) });
      return;
    }
    if (outcome.executionOutcome.outcome === "requeued_for_retry") {
      // The row is safely back to REQUESTED for a later attempt (task #21 --
      // never an automatic in-process retry). The history row below already
      // reflects this; this message just explains WHY nothing visibly
      // changed after a multi-second wait.
      setActionMessage({ variant: "info", text: "The first attempt did not complete. You can try generating again." });
      return;
    }
    // Completed -- the new comparison card in history is the feedback; no
    // separate banner needed.
    setActionMessage(null);
  }

  async function handleGenerate() {
    setPendingAction("generate");
    setActionMessage(null);
    const outcome = await generate();
    applyActionOutcome(outcome);
    setPendingAction(null);
  }

  async function handleGenerateVariation() {
    setPendingAction("variation");
    setActionMessage(null);
    const outcome = await generateVariation();
    applyActionOutcome(outcome);
    setPendingAction(null);
  }

  // Stage 5 (task #16) -- resumes the EXACT stuck generation (same sealed
  // request/idempotency scope) via the existing `/execute` endpoint, rather
  // than spending a new attempt via variation.
  async function handleRetry(generationId: string) {
    setPendingAction("retry");
    setActionMessage(null);
    const outcome = await retry(generationId);
    applyActionOutcome(outcome);
    setPendingAction(null);
  }

  if (state.status === "loading") {
    return <LoadingState label="Loading AI Photo Preview..." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Couldn't load AI Photo Preview" description="Please try refreshing the page." />;
  }

  const { history } = state;
  const hasHistory = history.length > 0;
  // history is newest-first (server ordering, never re-sorted client-side).
  // "Actively" in flight (task #16) -- a PROCESSING row young enough that it
  // may genuinely still be running; a REQUESTED row is never actively
  // blocking (the backend accepts a claim on it immediately at any age).
  const latestActivelyInFlight = hasHistory && isPhotoPreviewGenerationActivelyInFlight(history[0]);
  // Recoverable (task #16) -- a REQUESTED row (no automatic trigger exists
  // to resume it otherwise), or a PROCESSING row old enough to match the
  // backend's own stale-reclaim eligibility.
  const latestRecoverable = hasHistory && isPhotoPreviewGenerationRecoverable(history[0]);
  const isSubmitting = pendingAction !== null;

  return (
    <div id="photo-preview-section" className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">AI Photo Preview</h3>
        <p className="text-xs text-muted">
          Generate an AI visualization of the confirmed plan on the {getPhotoPreviewViewLabel(binding.viewLabel)} photo. This
          starts a real AI image-generation call.
        </p>
      </div>

      {actionMessage ? <Alert variant={actionMessage.variant}>{actionMessage.text}</Alert> : null}

      {!hasHistory ? (
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={handleGenerate} loading={pendingAction === "generate"} disabled={isSubmitting}>
            Generate AI Photo Preview
          </Button>
          {pendingAction === "generate" ? <GeneratingHint /> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {latestRecoverable ? (
            <Button
              type="button"
              onClick={() => handleRetry(history[0].id)}
              loading={pendingAction === "retry"}
              disabled={isSubmitting}
            >
              Retry generation
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={handleGenerateVariation}
            loading={pendingAction === "variation"}
            disabled={isSubmitting || latestActivelyInFlight}
          >
            Generate another variation
          </Button>
          {pendingAction === "variation" || pendingAction === "retry" ? <GeneratingHint /> : null}
          {!isSubmitting && latestActivelyInFlight ? (
            <p className="text-xs text-muted">Wait for the current generation to finish before starting another.</p>
          ) : null}
        </div>
      )}

      <PhotoPreviewHistoryList history={history} />
    </div>
  );
}

// task #9 -- indeterminate status only, no fake percentage, no promised
// completion time; task #29 -- announced to assistive tech via aria-live.
// Stage 5 wording note: real measured latency is ~10-12s, but the provider
// timeout this app configures is up to 90s (task #14) -- this copy stays
// deliberately soft ("usually", "a bit longer") rather than promising an
// exact bound the system does not actually guarantee.
function GeneratingHint() {
  return (
    <p className="flex items-center gap-2 text-xs text-muted" role="status" aria-live="polite">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      Generating AI Photo Preview... this usually takes about 10-15 seconds, occasionally longer.
    </p>
  );
}
