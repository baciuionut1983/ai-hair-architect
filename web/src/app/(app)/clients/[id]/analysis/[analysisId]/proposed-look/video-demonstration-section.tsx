"use client";

import { Film, Loader2 } from "lucide-react";
import { useState } from "react";

import { Alert, Button, Dialog, ErrorState, LoadingState } from "@/components/ui";
import type { VideoDemonstrationStatusView } from "@/lib/video-demonstration-status-view";

import { VideoDemonstrationPlayer } from "./video-demonstration-player";
import { VideoDemonstrationStatusBadge } from "./video-demonstration-status-badge";
import { getVideoDemonstrationStatusLabel, isVideoDemonstrationInFlight, resolveLatestVideoDemonstration } from "./video-demonstration-logic";
import { type VideoDemonstrationActionOutcome, useVideoDemonstration } from "./use-video-demonstration";

export interface VideoDemonstrationSectionProps {
  clientId: string;
  // The exact, already-COMPLETED Photo Preview generation this Video
  // visualizes (task §11: "Photo Preview -> Result Video", never a new AI
  // recommendation of its own). The caller (photo-preview-history.tsx) only
  // ever renders this component for a generation it has already confirmed
  // is COMPLETED -- this component performs no additional client-side
  // eligibility check of its own (task §2: "frontend poate ghida UX-ul, dar
  // backend-ul rămâne authority" -- the server independently re-verifies
  // the full authority chain at creation time regardless, every time).
  photoPreviewGenerationId: string;
}

type ConfirmIntent = "create" | "retry" | null;

// Video UI, Result Visualization -- the top-level orchestrator (mirrors
// photo-preview-section.tsx's own role exactly: the ONE component that
// calls useVideoDemonstration and owns the explicit create/retry actions
// and their cost-consent confirmation; every child below is presentational).
export function VideoDemonstrationSection({ clientId, photoPreviewGenerationId }: VideoDemonstrationSectionProps) {
  const { state, create, createVariation } = useVideoDemonstration(clientId, photoPreviewGenerationId);
  const [confirmIntent, setConfirmIntent] = useState<ConfirmIntent>(null);
  const [pendingIntent, setPendingIntent] = useState<ConfirmIntent>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function applyActionOutcome(outcome: VideoDemonstrationActionOutcome) {
    if (!outcome.ok) {
      setActionError(outcome.message);
    } else {
      setActionError(null);
    }
  }

  async function confirmAndSubmit() {
    const intent = confirmIntent;
    setConfirmIntent(null);
    if (!intent) return;
    setPendingIntent(intent);
    setActionError(null);
    const outcome = intent === "retry" ? await createVariation() : await create();
    applyActionOutcome(outcome);
    setPendingIntent(null);
  }

  if (state.status === "loading") {
    return <LoadingState label="Loading result video..." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Couldn't load the result video" description="Please try refreshing the page." />;
  }

  const { history, pollingIssue } = state;
  const latest = resolveLatestVideoDemonstration(history);
  const isSubmitting = pendingIntent !== null;

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <div>
        <h4 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Film className="h-4 w-4 text-muted" aria-hidden="true" />
          Result Video
        </h4>
        <p className="text-xs text-muted">
          Turn this result into a short video visualization. This is a visualization of the result above -- not a new
          recommendation, and not a styling tutorial.
        </p>
      </div>

      {actionError ? <Alert variant="error">{actionError}</Alert> : null}

      {!latest ? (
        <VideoDemonstrationCreateCta disabled={isSubmitting} onRequestConfirm={() => setConfirmIntent("create")} />
      ) : (
        <VideoDemonstrationCurrent
          generation={latest}
          pollingIssue={pollingIssue}
          isSubmitting={isSubmitting}
          onRetry={() => setConfirmIntent("retry")}
        />
      )}

      <VideoDemonstrationCostConsentDialog
        open={confirmIntent !== null}
        intent={confirmIntent}
        onCancel={() => setConfirmIntent(null)}
        onConfirm={confirmAndSubmit}
      />
    </div>
  );
}

// task §2/§13 -- the entry-point CTA. Disabled (not merely visually, via
// the real `disabled` attribute) while any submission is outstanding, so a
// duplicate click can never fire a second real request from this button
// (task §13's own frontend-side duplicate-click protection -- the backend's
// own idempotency/claim logic remains the REAL protection regardless).
function VideoDemonstrationCreateCta({ disabled, onRequestConfirm }: { disabled: boolean; onRequestConfirm: () => void }) {
  return (
    <Button type="button" onClick={onRequestConfirm} disabled={disabled}>
      Create Result Video
    </Button>
  );
}

function VideoDemonstrationCurrent({
  generation,
  pollingIssue,
  isSubmitting,
  onRetry,
}: {
  generation: VideoDemonstrationStatusView;
  pollingIssue: boolean;
  isSubmitting: boolean;
  onRetry: () => void;
}) {
  if (generation.status === "COMPLETED" && generation.resultAsset) {
    return (
      <div className="flex flex-col gap-2">
        <VideoDemonstrationStatusBadge status={generation.status} />
        <VideoDemonstrationPlayer assetId={generation.resultAsset.assetId} completedAt={generation.completedAt} />
      </div>
    );
  }

  if (generation.status === "FAILED") {
    return (
      <div className="flex flex-col gap-2">
        <VideoDemonstrationStatusBadge status={generation.status} />
        <Alert variant="error">{generation.failureMessage ?? getVideoDemonstrationStatusLabel(generation.status)}</Alert>
        {generation.retryEligible ? (
          <div className="flex flex-col gap-2">
            <Button type="button" onClick={onRetry} disabled={isSubmitting} loading={isSubmitting}>
              Try again
            </Button>
            <p className="text-xs text-muted">This starts a new video generation attempt.</p>
          </div>
        ) : null}
      </div>
    );
  }

  // REQUESTED or PROCESSING -- indeterminate status only (task §6), never a
  // fabricated percentage or a promised completion time.
  const inFlight = isVideoDemonstrationInFlight(generation.status);
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <VideoDemonstrationStatusBadge status={generation.status} />
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>{getVideoDemonstrationStatusLabel(generation.status)}</span>
      </div>
      {inFlight ? (
        <p className="text-xs text-muted">
          This can take a few minutes. You can leave this page -- your video will continue processing, and you&apos;ll
          see it here when you come back.
        </p>
      ) : null}
      {pollingIssue ? (
        <p className="text-xs text-muted" role="status">
          Having trouble checking the latest status. Still trying...
        </p>
      ) : null}
    </div>
  );
}

// task §4 -- cost consent. No invented/hardcoded price: this environment
// has no authoritative, live cost-estimate contract available yet (see
// this stage's own completion report, section H), so this dialog states
// plainly that generation has a real cost, without a fabricated figure --
// never silently skipped.
function VideoDemonstrationCostConsentDialog({
  open,
  intent,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  intent: ConfirmIntent;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={intent === "retry" ? "Generate a new video attempt?" : "Generate a result video?"}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Generate video
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-foreground">
        <p>
          This uses AI video generation, which has a real cost to your account. We don&apos;t yet show an exact
          estimated cost here -- generation will proceed at the standard rate for this feature.
        </p>
        <p className="text-xs text-muted">This can take a few minutes to complete, and you can leave the page while it runs.</p>
      </div>
    </Dialog>
  );
}
