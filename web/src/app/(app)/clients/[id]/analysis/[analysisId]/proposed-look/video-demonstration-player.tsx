"use client";

import { useState } from "react";

import { Alert, Card } from "@/components/ui";

import { formatVideoDemonstrationTimestamp, videoAssetContentUrl } from "./video-demonstration-logic";

export interface VideoDemonstrationPlayerProps {
  assetId: string;
  completedAt: string | null;
}

// Video UI, Result Visualization -- the COMPLETED result player (task §10).
// A native <video> element with browser-provided controls: play/pause,
// scrub/timeline, and fullscreen all come from the browser's own control
// surface (task §10's own minimum bar), so no custom control UI is built
// or maintained here. `playsInline` prevents iOS Safari from forcing
// fullscreen playback on tap (task §15's own mobile-usability requirement).
//
// `src` always points at the app's own durable video-assets content route
// (video-demonstration-logic.ts's own videoAssetContentUrl) -- never a raw
// provider URL or any other temporary/signed reference (task §10's own
// explicit prohibition).
//
// No <track> captions: the generated video has no audio track at all
// (Stage 2's own submit config: generateAudio: false) -- there is no
// dialogue or narration for a caption track to transcribe.
export function VideoDemonstrationPlayer({ assetId, completedAt }: VideoDemonstrationPlayerProps) {
  const [failed, setFailed] = useState(false);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>Result video</span>
        {completedAt ? (
          <>
            <span aria-hidden="true">&middot;</span>
            <span>Generated {formatVideoDemonstrationTimestamp(completedAt)}</span>
          </>
        ) : null}
      </div>

      <div className="flex max-h-[480px] min-h-[220px] items-center justify-center overflow-hidden rounded-lg bg-surface-alt">
        {failed ? (
          <p className="p-4 text-center text-xs text-muted">This video is no longer available.</p>
        ) : (
          <video
            controls
            playsInline
            preload="metadata"
            className="max-h-[480px] w-full"
            aria-label="AI-generated result video -- a visualization of the confirmed preview, not a real recording"
            src={videoAssetContentUrl(assetId)}
            onError={() => setFailed(true)}
          >
            Your browser does not support embedded video playback.
          </video>
        )}
      </div>

      <Alert variant="info">AI-generated visualization of the confirmed result. Actual results may vary.</Alert>
    </Card>
  );
}
