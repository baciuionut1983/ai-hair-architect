"use client";

import { useState } from "react";

import { Card } from "@/components/ui";

import { buildOriginalPhotoSrc } from "./analysis-original-photo-logic";

export interface AnalysisOriginalPhotoProps {
  imageAssetId?: string | null;
}

// Sub-milestone 1 (AI Visual Analysis): the original client photo used for
// this analysis, served through the existing authenticated
// /api/v1/image-assets/{id}/content endpoint -- never a raw storage
// key/path/bucket or a signed/public URL. Renders nothing for a manual
// analysis (no imageAssetId) and falls back to a neutral message, rather
// than a broken image, if the asset can no longer be served (soft-deleted,
// purged, or any other fetch failure).
export function AnalysisOriginalPhoto({ imageAssetId }: AnalysisOriginalPhotoProps) {
  const [failed, setFailed] = useState(false);
  const src = buildOriginalPhotoSrc(imageAssetId);

  if (!src) {
    return null;
  }

  return (
    <Card className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">Original photo</h3>
      {failed ? (
        <p className="text-xs text-muted">Original photo is no longer available.</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- served through an authenticated API route, not a build-time-known asset for next/image
        <img
          src={src}
          alt="Original photo used for this analysis"
          className="w-full max-h-[420px] rounded-lg object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </Card>
  );
}
