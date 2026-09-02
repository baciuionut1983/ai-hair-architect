import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Alert, Card } from "@/components/ui";
import type { PhotoPreviewGenerationRecord } from "@/lib/photo-preview-generation-repository";

import { ConciergeVideoOffer } from "./concierge-video-offer";
import { PhotoPreviewComparison } from "./photo-preview-comparison";
import {
  formatPhotoPreviewTimestamp,
  getPhotoPreviewStatusLabel,
  getPhotoPreviewVariationLabel,
  getPhotoPreviewViewLabel,
  mapPhotoPreviewFailureCodeToMessage,
} from "./photo-preview-logic";
import { PhotoPreviewStatusBadge } from "./photo-preview-status-badge";
import { VideoDemonstrationSection } from "./video-demonstration-section";

export interface PhotoPreviewHistoryListProps {
  clientId: string;
  history: PhotoPreviewGenerationRecord[];
}

// Real AI Photo Preview, Stage 3 -- the generation history (task #16/#17).
// Every generation is rendered as its own artifact, newest first (the list
// endpoint's own ordering is never re-sorted here) -- there is no "current
// approved preview" authority concept (task #17): a COMPLETED row is shown
// with its full comparison for as long as it exists, and multiple valid
// previews (including different variations) simply coexist in this list.
export function PhotoPreviewHistoryList({ clientId, history }: PhotoPreviewHistoryListProps) {
  if (history.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <h4 className="text-sm font-semibold text-foreground">Preview history</h4>
      {history.map((generation, index) => (
        // AI Concierge / Orchestrator, Stage 2: the video offer only ever
        // appears once, tied to the NEWEST (index 0) result -- history is
        // already newest-first (this file's own established ordering
        // comment above), so multiple prior COMPLETED previews never each
        // show their own redundant "want a video?" prompt.
        <PhotoPreviewHistoryRow key={generation.id} clientId={clientId} generation={generation} isLatest={index === 0} />
      ))}
    </div>
  );
}

function PhotoPreviewHistoryRow({
  clientId,
  generation,
  isLatest,
}: {
  clientId: string;
  generation: PhotoPreviewGenerationRecord;
  isLatest: boolean;
}) {
  const params = useParams<{ id: string; analysisId: string }>();
  const analysisId = params.analysisId;
  // AI Concierge / Orchestrator, Stage 2 (task section 6): local-only,
  // never persisted (task section 5: "persist nothing unless existing
  // architecture genuinely requires it") -- flips true on an explicit
  // "yes" click and hands off to VideoDemonstrationSection's own
  // requestConsentOnMount prop, which opens the SAME EXISTING cost-consent
  // dialog the manual "Create Result Video" button already uses. Scoped
  // to this exact mounted row (keyed on generation.id, like
  // VideoDemonstrationSection itself already is) -- never shared across a
  // different Photo Preview generation.
  const [videoConsentRequested, setVideoConsentRequested] = useState(false);
  const variationLabel = getPhotoPreviewVariationLabel(generation);

  const meta = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span>{getPhotoPreviewViewLabel(generation.viewLabel)}</span>
      {variationLabel ? (
        <>
          <span aria-hidden="true">&middot;</span>
          <span>{variationLabel}</span>
        </>
      ) : null}
      <span aria-hidden="true">&middot;</span>
      <span>Requested {formatPhotoPreviewTimestamp(generation.requestedAt)}</span>
      <span aria-hidden="true">&middot;</span>
      <span>
        {generation.provider} / {generation.model}
      </span>
    </div>
  );

  if (generation.status === "COMPLETED" && generation.generatedImageAssetId) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PhotoPreviewStatusBadge status={generation.status} />
        </div>
        {meta}
        <PhotoPreviewComparison generation={{ ...generation, generatedImageAssetId: generation.generatedImageAssetId }} />
        {/* AI Concierge / Orchestrator, Stage 2 (task section 4) -- the
            conversational offer, ONLY next to the newest COMPLETED result
            (isLatest, set by the caller's own .map() above), never on an
            older one already in history. Server-verified for real (see
            use-concierge-video-offer.ts) -- this component itself renders
            nothing until the orchestrator confirms the offer applies. */}
        {isLatest ? (
          <ConciergeVideoOffer clientId={clientId} analysisId={analysisId} onAccept={() => setVideoConsentRequested(true)} />
        ) : null}

        {/* Video UI, Result Visualization -- available ONLY for a COMPLETED
            Photo Preview (this exact branch's own condition), matching the
            product principle: Video visualizes an already-confirmed result,
            never a new AI recommendation. Keyed on the Photo Preview
            generation's own id -- a different COMPLETED generation is a
            genuinely different source result, never a continuation of a
            previous one's Video state. */}
        <VideoDemonstrationSection
          key={generation.id}
          clientId={clientId}
          photoPreviewGenerationId={generation.id}
          requestConsentOnMount={videoConsentRequested}
        />
      </div>
    );
  }

  if (generation.status === "FAILED") {
    return (
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PhotoPreviewStatusBadge status={generation.status} />
        </div>
        {meta}
        <Alert variant="error">{mapPhotoPreviewFailureCodeToMessage(generation.errorCode)}</Alert>
        <p className="text-xs text-muted">Use &quot;Generate another variation&quot; below to try again.</p>
      </Card>
    );
  }

  // REQUESTED or PROCESSING -- indeterminate status only (task #9), never a
  // fabricated percentage or a promised completion time.
  return (
    <Card className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <PhotoPreviewStatusBadge status={generation.status} />
      </div>
      {meta}
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>{getPhotoPreviewStatusLabel(generation.status)}</span>
      </div>
    </Card>
  );
}
