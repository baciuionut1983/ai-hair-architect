import { Loader2 } from "lucide-react";

import { Alert, Card } from "@/components/ui";
import type { PhotoPreviewGenerationRecord } from "@/lib/photo-preview-generation-repository";

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
      {history.map((generation) => (
        <PhotoPreviewHistoryRow key={generation.id} clientId={clientId} generation={generation} />
      ))}
    </div>
  );
}

function PhotoPreviewHistoryRow({ clientId, generation }: { clientId: string; generation: PhotoPreviewGenerationRecord }) {
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
        {/* Video UI, Result Visualization -- available ONLY for a COMPLETED
            Photo Preview (this exact branch's own condition), matching the
            product principle: Video visualizes an already-confirmed result,
            never a new AI recommendation. Keyed on the Photo Preview
            generation's own id -- a different COMPLETED generation is a
            genuinely different source result, never a continuation of a
            previous one's Video state. */}
        <VideoDemonstrationSection key={generation.id} clientId={clientId} photoPreviewGenerationId={generation.id} />
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
