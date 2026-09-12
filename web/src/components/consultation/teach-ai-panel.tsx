"use client";

import { Brain, Image as ImageIcon, Images, Mic, Square, Trash2, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Textarea } from "@/components/ui";
import { decodeBlobAsWav } from "./audio-wav-encode";
import { bindFetch, classifyMicrophoneStartError, finishRecording, generateAttemptId, logClient } from "./teach-ai-panel-logic";
import {
  buildLearningEvidenceImageFormData,
  buildLearningEvidenceImageSetFormData,
  buildLearningEvidenceVideoFormData,
  generateLearningEvidenceSubmissionId,
  LEARNING_EVIDENCE_STATUS_TEXT,
  type LearningEvidenceSummary,
} from "./teach-ai-learning-evidence-logic";
import { describeVideoUploadProgress, uploadVideoViaMultipart, type VideoUploadProgressState } from "./teach-ai-video-multipart-upload-logic";

type Action = "save_client_memory" | "save_professional_rule" | "mark_preference" | "save_outcome";

const PERMISSION_DENIED_STATUS = "Microphone access was denied. Allow microphone access in your browser's site settings to use voice input.";
const UNAVAILABLE_STATUS = "Microphone access was not available. You can still type your note.";

export function TeachAiPanel({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [transcriptId, setTranscriptId] = useState<string>();
  const [recording, setRecording] = useState(false);
  // Voice reliability hardening (2026-08-18): this panel previously had no
  // "transcribing" state at all -- the "Speak to AI" button stayed
  // clickable the entire time a recording was being uploaded/transcribed,
  // so a second click during that window started a fully independent
  // second getUserMedia()/MediaRecorder session racing the first one for
  // the same microphone. Mirrors use-voice-recording.ts's own processing
  // state and button-disable convention.
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string>();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);
  const hasStoppedRef = useRef(false);

  // Stage 8.5L3 -- Professional Learning Evidence. Kept fully separate
  // from the memory-save state above: this is a DISTINCT, additive action
  // (see savingEvidence's own save handler below), never a silent
  // duplicate of save(). The same reviewed `draft`/`transcriptId` is
  // reused for the text/voice-transcript evidence path only.
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingImageSet, setUploadingImageSet] = useState(false);
  // Stage 8.5L3.1 -- real upload progress (Preparing/Uploading X%/
  // Finalizing/Saved privately), never a fake "Analyzing"/"Learning"
  // phase (task Part 19/22).
  const [videoUploadProgress, setVideoUploadProgress] = useState<VideoUploadProgressState | null>(null);
  const [recentEvidence, setRecentEvidence] = useState<LearningEvidenceSummary[]>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageSetInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const videoUploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/v1/learning-evidence");
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { evidence?: LearningEvidenceSummary[] };
        if (!cancelled) setRecentEvidence(payload.evidence ?? []);
      } catch {
        // Best-effort only -- an empty/stale history list is never worse
        // than blocking the panel from opening.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function saveAsLearningEvidence() {
    if (!draft.trim()) return;
    if (!window.confirm("Confirm that you want to save this as private learning evidence?")) return;

    setSavingEvidence(true);
    try {
      const response = await fetch(`/api/v1/clients/${clientId}/learning-evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidenceType: transcriptId ? "VOICE_TRANSCRIPT" : "TEXT",
          content: draft.trim(),
          transcriptId,
          submissionId: generateLearningEvidenceSubmissionId(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { evidence?: LearningEvidenceSummary };
      setStatus(response.ok ? LEARNING_EVIDENCE_STATUS_TEXT.savedText : LEARNING_EVIDENCE_STATUS_TEXT.genericFailure);
      if (response.ok) {
        setDraft("");
        setTranscriptId(undefined);
        if (payload.evidence) setRecentEvidence((prev) => [payload.evidence as LearningEvidenceSummary, ...prev]);
      }
    } catch {
      setStatus(LEARNING_EVIDENCE_STATUS_TEXT.genericFailure);
    } finally {
      setSavingEvidence(false);
    }
  }

  async function uploadImage(file: File) {
    setUploadingImage(true);
    try {
      const form = buildLearningEvidenceImageFormData(file, { submissionId: generateLearningEvidenceSubmissionId() });
      const response = await fetch(`/api/v1/clients/${clientId}/learning-evidence/image`, { method: "POST", body: form });
      const payload = (await response.json().catch(() => ({}))) as { evidence?: LearningEvidenceSummary };
      setStatus(response.ok ? LEARNING_EVIDENCE_STATUS_TEXT.uploadedImage : LEARNING_EVIDENCE_STATUS_TEXT.genericFailure);
      if (response.ok && payload.evidence) setRecentEvidence((prev) => [payload.evidence as LearningEvidenceSummary, ...prev]);
    } catch {
      setStatus(LEARNING_EVIDENCE_STATUS_TEXT.genericFailure);
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function uploadImageSet(files: File[]) {
    setUploadingImageSet(true);
    try {
      const form = buildLearningEvidenceImageSetFormData(files, { submissionId: generateLearningEvidenceSubmissionId() });
      const response = await fetch(`/api/v1/clients/${clientId}/learning-evidence/image-set`, { method: "POST", body: form });
      const payload = (await response.json().catch(() => ({}))) as { evidence?: LearningEvidenceSummary };
      setStatus(response.ok ? LEARNING_EVIDENCE_STATUS_TEXT.uploadedImageSet : LEARNING_EVIDENCE_STATUS_TEXT.genericFailure);
      if (response.ok && payload.evidence) setRecentEvidence((prev) => [payload.evidence as LearningEvidenceSummary, ...prev]);
    } catch {
      setStatus(LEARNING_EVIDENCE_STATUS_TEXT.genericFailure);
    } finally {
      setUploadingImageSet(false);
      if (imageSetInputRef.current) imageSetInputRef.current.value = "";
    }
  }

  // Stage 8.5L3.1 -- real multipart direct-to-S3 upload. This function
  // never reads the video's own bytes into a request THIS app's server
  // receives: uploadVideoViaMultipart uploads every part directly to a
  // presigned object-storage URL (Part 31's own absolute rule).
  async function uploadVideo(file: File) {
    const controller = new AbortController();
    videoUploadAbortRef.current = controller;
    try {
      await uploadVideoViaMultipart(
        clientId,
        file,
        {},
        {
          fetch: bindFetch(fetch),
          // Stage 8.5L3.1 Part 18: the ONE narrow fallback -- a local
          // environment with no object storage configured at all has no
          // multipart-capable backend. Reuses the small-file buffered
          // endpoint that exists specifically for that case; never
          // invoked when S3 is genuinely configured (real production
          // always requires it).
          fallbackUpload: async (fallbackFile) => {
            const form = buildLearningEvidenceVideoFormData(fallbackFile, { submissionId: generateLearningEvidenceSubmissionId() });
            const response = await fetch(`/api/v1/clients/${clientId}/learning-evidence/video`, { method: "POST", body: form });
            if (!response.ok) throw new Error("fallback video upload failed");
            const payload = (await response.json()) as { evidence: LearningEvidenceSummary };
            return payload.evidence;
          },
        },
        {
          onProgress: (state) => setVideoUploadProgress(state),
          onSuccess: (evidence) => {
            setStatus(LEARNING_EVIDENCE_STATUS_TEXT.uploadedVideo);
            setRecentEvidence((prev) => [evidence as LearningEvidenceSummary, ...prev]);
          },
          onFailure: (message) => setStatus(message),
          onCanceled: () => setStatus(LEARNING_EVIDENCE_STATUS_TEXT.videoUploadCanceled),
        },
        controller.signal,
      );
    } finally {
      videoUploadAbortRef.current = null;
      setVideoUploadProgress(null);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  function cancelVideoUpload() {
    videoUploadAbortRef.current?.abort();
  }

  async function revokeEvidence(evidenceId: string) {
    if (!window.confirm("Revoke this learning evidence? It will no longer be used for future processing.")) return;
    try {
      const response = await fetch(`/api/v1/learning-evidence?evidenceId=${encodeURIComponent(evidenceId)}`, { method: "DELETE" });
      if (response.ok) {
        setStatus(LEARNING_EVIDENCE_STATUS_TEXT.revoked);
        setRecentEvidence((prev) => prev.map((item) => (item.id === evidenceId ? { ...item, status: "REVOKED" } : item)));
      }
    } catch {
      // Best-effort -- a failed revoke leaves the row exactly as it was;
      // the professional can simply try again.
    }
  }

  async function save(action: Action) {
    if (!draft.trim()) return;
    // The explicit-confirm gate the backend also enforces (confirmed: true
    // below) -- the stylist must actively approve this exact text before it
    // is ever sent, whether it came from typing or a voice transcript.
    if (!window.confirm("Confirm that you want to save this as persistent AI memory?")) return;

    const response = await fetch(`/api/v1/clients/${clientId}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, content: draft.trim(), confirmed: true, transcriptId })
    });

    setStatus(response.ok ? "Saved with provenance and audit history." : "The memory could not be saved.");
    if (response.ok) {
      setDraft("");
      setTranscriptId(undefined);
    }
  }

  async function toggleRecording() {
    if (recording) {
      // Recording/status resets happen in onstop below (the single source
      // of truth for "the recorder actually stopped"), not here -- so a
      // stop triggered by the browser/OS ending the track itself (not just
      // this button) always resets the UI too, not only a manual click.
      if (!hasStoppedRef.current) {
        hasStoppedRef.current = true;
        recorder.current?.stop();
      }
      return;
    }

    // Voice reliability hardening: rejects a second start attempt landing
    // while the first one's getUserMedia() promise is still pending --
    // see use-voice-recording.ts's identical startingRef for the full
    // reasoning (React state has not committed yet in that window).
    if (startingRef.current) {
      return;
    }
    startingRef.current = true;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      startingRef.current = false;
      setStatus("Voice recording is not supported here. You can still type your note.");
      return;
    }

    const attemptId = generateAttemptId();

    try {
      logClient("mic_requested", { attemptId });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      logClient("mic_granted", { attemptId });
      streamRef.current = stream;
      chunks.current = [];
      hasStoppedRef.current = false;
      const media = new MediaRecorder(stream);
      recorder.current = media;
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      media.onstop = () => {
        hasStoppedRef.current = true;
        streamRef.current = null;
        // Genuinely done the moment onstop fires, regardless of how long
        // the async transcription below takes -- see
        // use-voice-recording.ts's identical reasoning.
        recorder.current = null;
        void finishRecording(stream, chunks.current, media.mimeType, clientId, {
          onStopped: () => {
            setRecording(false);
            setProcessing(true);
            setStatus("Transcribing...");
          },
          onFailure: (message) => {
            setProcessing(false);
            setStatus(message);
          },
          onSuccess: (transcript, id) => {
            setProcessing(false);
            setDraft(transcript);
            setTranscriptId(id);
            setStatus("Transcript ready for review. It has not been saved as memory.");
          },
        }, { fetch: bindFetch(fetch), encodeAsWav: decodeBlobAsWav }, undefined, attemptId);
      };
      media.start();
      setRecording(true);
      startingRef.current = false;
      setStatus("Listening...");
      logClient("recorder_started", { attemptId, mimeType: media.mimeType || null });
    } catch (error) {
      const reason = classifyMicrophoneStartError(error);
      logClient(reason === "denied" ? "mic_denied" : "recording_start_failed", {
        attemptId,
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      logClient("cleanup_completed", { attemptId });
      startingRef.current = false;
      setStatus(reason === "denied" ? PERMISSION_DENIED_STATUS : UNAVAILABLE_STATUS);
    }
  }

  // Voice reliability hardening: this panel previously had NO cleanup on
  // unmount at all -- closing it (setOpen(false) is a sibling control, not
  // a full unmount, but this component can still unmount via its parent,
  // e.g. navigating away mid-recording) left the microphone stream
  // captured and never released. Mirrors use-voice-recording.ts's own
  // unmount cleanup.
  useEffect(() => {
    return () => {
      hasStoppedRef.current = true;
      startingRef.current = false;
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
      }
      recorder.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Brain className="h-4 w-4" aria-hidden="true" />
        Teach the AI
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface-alt p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">Teach the AI</strong>
        <Button type="button" variant="secondary" onClick={toggleRecording} disabled={processing} loading={processing}>
          {recording ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
          {recording ? "Stop" : "Speak to AI"}
        </Button>
      </div>
      <Textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setTranscriptId(undefined);
        }}
        rows={3}
        placeholder="Write an observation, a rule, a preference, or an outcome..."
      />
      <p className="my-2 text-xs text-muted">
        Text and transcripts never become facts automatically. Choose an action below and confirm explicitly.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => save("save_client_memory")}>Save to client memory</Button>
        <Button type="button" variant="secondary" onClick={() => save("save_professional_rule")}>Save as professional rule</Button>
        <Button type="button" variant="secondary" onClick={() => save("mark_preference")}>Mark as preference</Button>
        <Button type="button" variant="secondary" onClick={() => save("save_outcome")}>Save outcome</Button>
      </div>

      {/* Stage 8.5L3 -- Professional Learning Evidence. A DISTINCT,
          additive path from the four memory actions above: this creates a
          ProfessionalLearningEvidence row (Stage 8.5L2), never a
          ProfessionalMemory row, and never influences Consultation Chat.
          The professional chooses this INSTEAD OF or IN ADDITION TO a
          memory action -- never both automatically from one click. */}
      <div className="mt-3 border-t border-border pt-3">
        {/* PURPOSE LOCK (product correction): this section exists for
            exactly one intent -- teaching the professional AI. Never
            presented as a generic upload/media-library/file-save area. */}
        <p className="text-sm font-medium">Încarcă materiale pentru a învăța AI-ul profesional</p>
        <p className="mb-2 text-xs text-muted">
          Materialele încărcate aici sunt dovezi private pentru învățarea profesională.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void saveAsLearningEvidence()}
            disabled={savingEvidence || !draft.trim()}
            loading={savingEvidence}
          >
            <Brain className="h-4 w-4" aria-hidden="true" />
            Save as learning evidence
          </Button>
          <Button type="button" variant="secondary" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage} loading={uploadingImage}>
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            Photo
          </Button>
          <Button type="button" variant="secondary" onClick={() => imageSetInputRef.current?.click()} disabled={uploadingImageSet} loading={uploadingImageSet}>
            <Images className="h-4 w-4" aria-hidden="true" />
            Multiple photos
          </Button>
          <Button type="button" variant="secondary" onClick={() => videoInputRef.current?.click()} disabled={videoUploadProgress !== null} loading={videoUploadProgress !== null}>
            <Video className="h-4 w-4" aria-hidden="true" />
            Video
          </Button>
          {videoUploadProgress ? (
            <Button type="button" variant="secondary" onClick={cancelVideoUpload}>
              Cancel upload
            </Button>
          ) : null}
        </div>
        {videoUploadProgress ? (
          <p className="mt-1 text-xs text-muted">{describeVideoUploadProgress(videoUploadProgress)}</p>
        ) : null}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadImage(file);
          }}
        />
        <input
          ref={imageSetInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length >= 2) void uploadImageSet(files);
          }}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadVideo(file);
          }}
        />

        {recentEvidence.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {recentEvidence.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs">
                <span className="truncate">
                  {item.evidenceType} · {item.title || item.vertical} · {item.status}
                </span>
                {item.status === "ACTIVE" ? (
                  <button type="button" onClick={() => void revokeEvidence(item.id)} className="shrink-0 text-muted hover:text-foreground" aria-label="Revoke">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {status ? (
        <div className="mt-2">
          <Alert>{status}</Alert>
        </div>
      ) : null}
    </div>
  );
}
