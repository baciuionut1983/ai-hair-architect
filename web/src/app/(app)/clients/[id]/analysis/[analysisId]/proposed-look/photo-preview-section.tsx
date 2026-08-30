"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Alert, Button, ErrorState, LoadingState } from "@/components/ui";
import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";

import { PhotoPreviewHistoryList } from "./photo-preview-history";
import {
  getPhotoPreviewViewLabel,
  isPhotoPreviewGenerationInFlight,
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

type PendingAction = "generate" | "variation" | null;

// Real AI Photo Preview, Stage 3 -- the top-level orchestrator. Rendered
// immediately downstream of the confirmed Spatial Binding. This is the ONLY
// component that calls usePhotoPreview and owns the explicit Generate/
// variation actions and their transient result messaging -- every child
// below is presentational.
export function PhotoPreviewSection({ clientId, proposalId, technicalVisualMapId, binding }: PhotoPreviewSectionProps) {
  const { state, generate, generateVariation } = usePhotoPreview(clientId, proposalId, technicalVisualMapId, binding.id);
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

  if (state.status === "loading") {
    return <LoadingState label="Loading AI Photo Preview..." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Couldn't load AI Photo Preview" description="Please try refreshing the page." />;
  }

  const { history } = state;
  const hasHistory = history.length > 0;
  // history is newest-first (server ordering, never re-sorted client-side).
  const latestInFlight = hasHistory && isPhotoPreviewGenerationInFlight(history[0].status);
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
          <Button
            type="button"
            variant="secondary"
            onClick={handleGenerateVariation}
            loading={pendingAction === "variation"}
            disabled={isSubmitting || latestInFlight}
          >
            Generate another variation
          </Button>
          {pendingAction === "variation" ? <GeneratingHint /> : null}
          {!isSubmitting && latestInFlight ? (
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
function GeneratingHint() {
  return (
    <p className="flex items-center gap-2 text-xs text-muted" role="status" aria-live="polite">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      Generating AI Photo Preview... this can take up to about 15 seconds.
    </p>
  );
}
