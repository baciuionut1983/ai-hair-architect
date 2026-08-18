"use client";

import { Brain, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Textarea } from "@/components/ui";
import { decodeBlobAsWav } from "./audio-wav-encode";
import { bindFetch, classifyMicrophoneStartError, finishRecording, generateAttemptId, logClient } from "./teach-ai-panel-logic";

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
      {status ? (
        <div className="mt-2">
          <Alert>{status}</Alert>
        </div>
      ) : null}
    </div>
  );
}
