"use client";

import { useState } from "react";

import { Alert, Badge, Card } from "@/components/ui";
import type { PhotoPreviewGenerationRecord } from "@/lib/photo-preview-generation-repository";

import { formatPhotoPreviewTimestamp, getPhotoPreviewViewLabel, summarizePhotoPreviewTarget } from "./photo-preview-logic";

export interface PhotoPreviewComparisonProps {
  generation: PhotoPreviewGenerationRecord & { generatedImageAssetId: string };
}

function contentUrl(imageAssetId: string): string {
  return `/api/v1/image-assets/${imageAssetId}/content`;
}

// Real AI Photo Preview, Stage 3 -- the completed-generation comparison view
// (tasks #12/#13/#14/#15/#19/#24/#25). SOURCE and AI PHOTO PREVIEW are always
// rendered together, each under its own unambiguous label -- neither ever
// replaces the other, and the generated panel is never presented as an
// actual/finished result (task #13/#15).
//
// EXIF note (task #25): this component renders both images through plain
// <img> tags and never applies any rotation/orientation correction of its
// own -- it displays exactly what the browser's own image decoder produces
// from the bytes served by the existing, unmodified image-asset content
// route. The pre-existing EXIF-orientation-metadata issue discovered during
// the real-human live validation (a stale orientation tag surviving on an
// already-reoriented pixel buffer) is a source-upload-pipeline issue, not a
// Photo Preview one, and is deliberately NOT patched here -- see the Stage 3
// final report's own EXIF ISSUE STATUS section for what live testing showed.
export function PhotoPreviewComparison({ generation }: PhotoPreviewComparisonProps) {
  const [sourceFailed, setSourceFailed] = useState(false);
  const [generatedFailed, setGeneratedFailed] = useState(false);

  const targetSummary = summarizePhotoPreviewTarget(generation.sealedRequest.target);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{getPhotoPreviewViewLabel(generation.viewLabel)}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{targetSummary}</span>
        <span aria-hidden="true">&middot;</span>
        <span>Generated {formatPhotoPreviewTimestamp(generation.completedAt ?? generation.updatedAt)}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <figure className="flex flex-col gap-2">
          <figcaption className="text-sm font-semibold text-foreground">Source photo</figcaption>
          <div className="flex max-h-[480px] min-h-[220px] items-center justify-center overflow-hidden rounded-lg bg-surface-alt">
            {sourceFailed ? (
              <p className="p-4 text-center text-xs text-muted">Source photo is no longer available.</p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- served through an authenticated API route, not a build-time-known asset for next/image
              <img
                src={contentUrl(generation.sourceImageAssetId)}
                alt="Source photo used for this AI Photo Preview"
                className="max-h-[480px] w-full object-contain"
                onError={() => setSourceFailed(true)}
              />
            )}
          </div>
        </figure>

        <figure className="flex flex-col gap-2">
          <figcaption className="flex items-center gap-2 text-sm font-semibold text-foreground">
            AI Photo Preview
            <Badge variant="neutral">AI-generated</Badge>
          </figcaption>
          <div className="flex max-h-[480px] min-h-[220px] items-center justify-center overflow-hidden rounded-lg bg-surface-alt">
            {generatedFailed ? (
              <p className="p-4 text-center text-xs text-muted">AI Photo Preview is no longer available.</p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- served through an authenticated API route, not a build-time-known asset for next/image
              <img
                src={contentUrl(generation.generatedImageAssetId)}
                alt="AI-generated Photo Preview -- a visualization, not a real photograph"
                className="max-h-[480px] w-full object-contain"
                onError={() => setGeneratedFailed(true)}
              />
            )}
          </div>
        </figure>
      </div>

      <Alert variant="info">
        AI-generated visualization of the confirmed professional direction. Actual results may vary.
      </Alert>
    </Card>
  );
}
