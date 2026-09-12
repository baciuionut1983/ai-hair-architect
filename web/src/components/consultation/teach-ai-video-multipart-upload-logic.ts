// Teach the AI, Professional Learning Evidence -- LARGE VIDEO UPLOAD
// (Stage 8.5L3.1). Pulled out of teach-ai-panel.tsx for the same reason
// every other logic module in this folder already is: no .test.tsx
// convention exists in this repo.
//
// THE APPLICATION NEVER SEES THE VIDEO BYTES: every part is uploaded
// DIRECTLY from the browser to the presigned URL the server hands back --
// this module's own fetch(url, { method: "PUT", body: blob }) call goes
// straight to object storage, never to this app's own server (Part 31's
// own absolute rule, enforced client-side here exactly as it is
// server-side in professional-learning-video-multipart-upload-service.ts).
//
// PROGRESS UX (task Part 19): only ever one of these five honest phases
// -- never "Analyzing"/"Learning"/"Understanding", because those stages
// do not exist yet.
export type VideoUploadProgressPhase = "preparing" | "uploading" | "finalizing" | "saved" | "failed" | "canceled";

export interface VideoUploadProgressState {
  readonly phase: VideoUploadProgressPhase;
  readonly percent: number;
}

// Task Part 19's own exact vocabulary: Preparing / Uploading X% /
// Finalizing / Saved privately / Upload failed-retry / Upload canceled --
// never "Analyzing"/"Learning"/"Understanding".
export function describeVideoUploadProgress(state: VideoUploadProgressState): string {
  switch (state.phase) {
    case "preparing":
      return "Se pregătește încărcarea...";
    case "uploading":
      return `Se încarcă... ${state.percent}%`;
    case "finalizing":
      return "Se finalizează...";
    case "saved":
      return "Salvat privat.";
    case "failed":
      return "Încărcare eșuată -- poți încerca din nou.";
    case "canceled":
      return "Încărcare anulată.";
  }
}

export function generateVideoUploadSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `video-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Part 20: "use File/Blob slice semantics" -- never reads the whole file
// into an ArrayBuffer/memory buffer up front. Each slice is a lightweight
// Blob view; its bytes are only actually read when that ONE part's PUT
// request streams it.
export function computeUploadPartRanges(fileSizeBytes: number, partSizeBytes: number): readonly { partNumber: number; start: number; end: number }[] {
  const partCount = Math.ceil(fileSizeBytes / partSizeBytes);
  const ranges: { partNumber: number; start: number; end: number }[] = [];
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    const start = (partNumber - 1) * partSizeBytes;
    const end = Math.min(start + partSizeBytes, fileSizeBytes);
    ranges.push({ partNumber, start, end });
  }
  return ranges;
}

export interface VideoUploadEvidenceSummary {
  id: string;
  evidenceType: string;
  title: string | null;
  vertical: string;
  status: string;
  createdAt: string;
}

export interface VideoMultipartUploadDeps {
  fetch: typeof fetch;
  // Stage 8.5L3.1 Part 18: multipart is the ONE video ingestion
  // architecture wherever a multipart-capable backend (S3) is configured
  // -- which production always requires. This is the one, narrow
  // exception: a local-development environment with no object storage
  // configured at all has no multipart-capable backend to speak of (the
  // local-disk backend has none). When the initiate call reports that
  // specific, distinguishable "unavailable" condition, this optional
  // callback -- if provided -- is invoked instead of failing outright, so
  // the caller can fall back to the small-file buffered endpoint that
  // exists specifically for this one case
  // (learning-evidence-video-upload.ts). Never invoked for any OTHER
  // failure reason (a genuine validation error, a provider error, an
  // oversized file) -- those are always reported as real failures.
  fallbackUpload?: (file: File, meta: VideoMultipartUploadMeta) => Promise<VideoUploadEvidenceSummary>;
}

export interface VideoMultipartUploadCallbacks {
  onProgress: (state: VideoUploadProgressState) => void;
  onSuccess: (evidence: VideoUploadEvidenceSummary) => void;
  onFailure: (message: string) => void;
  onCanceled: () => void;
}

export interface VideoMultipartUploadMeta {
  readonly title?: string;
  readonly vertical?: string;
}

const GENERIC_UPLOAD_FAILURE_MESSAGE = "Videoclipul nu a putut fi încărcat acum. Poți încerca din nou.";

// Orchestrates the full initiate -> per-part-PUT -> complete lifecycle.
// Every uploadedPartNumbers entry already reported by the server (a
// resumed session, Part 9) is skipped -- a page refresh never re-uploads
// bytes that already genuinely arrived.
export async function uploadVideoViaMultipart(
  clientId: string,
  file: File,
  meta: VideoMultipartUploadMeta,
  deps: VideoMultipartUploadDeps,
  callbacks: VideoMultipartUploadCallbacks,
  abortSignal: AbortSignal,
  sessionId: string = generateVideoUploadSessionId(),
): Promise<void> {
  callbacks.onProgress({ phase: "preparing", percent: 0 });

  let partSizeBytes: number;
  let partCount: number;
  try {
    const initiateResponse = await deps.fetch(`/api/v1/clients/${clientId}/learning-evidence/video-upload-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, fileName: file.name, contentType: file.type, expectedSizeBytes: file.size }),
    });
    if (!initiateResponse.ok) {
      const payload = await initiateResponse.json().catch(() => ({}));
      if (initiateResponse.status === 503 && payload.error === "LARGE_VIDEO_UPLOAD_UNAVAILABLE" && deps.fallbackUpload) {
        callbacks.onProgress({ phase: "uploading", percent: 0 });
        try {
          const evidence = await deps.fallbackUpload(file, meta);
          callbacks.onProgress({ phase: "saved", percent: 100 });
          callbacks.onSuccess(evidence);
        } catch {
          callbacks.onFailure(GENERIC_UPLOAD_FAILURE_MESSAGE);
        }
        return;
      }
      callbacks.onFailure(typeof payload.message === "string" ? payload.message : GENERIC_UPLOAD_FAILURE_MESSAGE);
      return;
    }
    const initiated = await initiateResponse.json();
    partSizeBytes = initiated.partSizeBytes;
    partCount = initiated.partCount;
  } catch {
    callbacks.onFailure(GENERIC_UPLOAD_FAILURE_MESSAGE);
    return;
  }

  const ranges = computeUploadPartRanges(file.size, partSizeBytes);
  const parts: { partNumber: number; etag: string }[] = [];

  callbacks.onProgress({ phase: "uploading", percent: 0 });
  for (const range of ranges) {
    if (abortSignal.aborted) {
      await tryAbortSession(clientId, sessionId, deps);
      callbacks.onCanceled();
      return;
    }

    try {
      const urlResponse = await deps.fetch(`/api/v1/learning-evidence/video-upload-sessions/${sessionId}/parts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partNumber: range.partNumber }),
      });
      if (!urlResponse.ok) {
        callbacks.onFailure(GENERIC_UPLOAD_FAILURE_MESSAGE);
        return;
      }
      const { url } = await urlResponse.json();

      const blob = file.slice(range.start, range.end);
      // DIRECT to object storage -- never through this application's own
      // server (Part 31).
      const putResponse = await deps.fetch(url, { method: "PUT", body: blob });
      if (!putResponse.ok) {
        callbacks.onFailure(GENERIC_UPLOAD_FAILURE_MESSAGE);
        return;
      }
      const etag = putResponse.headers.get("ETag") ?? "";
      parts.push({ partNumber: range.partNumber, etag: etag.replace(/^"|"$/g, "") });
    } catch {
      callbacks.onFailure(GENERIC_UPLOAD_FAILURE_MESSAGE);
      return;
    }

    callbacks.onProgress({ phase: "uploading", percent: Math.round((range.partNumber / partCount) * 100) });
  }

  callbacks.onProgress({ phase: "finalizing", percent: 100 });
  try {
    const completeResponse = await deps.fetch(`/api/v1/learning-evidence/video-upload-sessions/${sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts, title: meta.title, vertical: meta.vertical }),
    });
    if (!completeResponse.ok) {
      const payload = await completeResponse.json().catch(() => ({}));
      callbacks.onFailure(typeof payload.message === "string" ? payload.message : GENERIC_UPLOAD_FAILURE_MESSAGE);
      return;
    }
    const { evidence } = await completeResponse.json();
    callbacks.onProgress({ phase: "saved", percent: 100 });
    callbacks.onSuccess(evidence);
  } catch {
    callbacks.onFailure(GENERIC_UPLOAD_FAILURE_MESSAGE);
  }
}

async function tryAbortSession(clientId: string, sessionId: string, deps: VideoMultipartUploadDeps): Promise<void> {
  try {
    await deps.fetch(`/api/v1/learning-evidence/video-upload-sessions/${sessionId}/abort`, { method: "POST" });
  } catch {
    // Best-effort -- the caller already reports "canceled" to the
    // professional regardless.
  }
}
