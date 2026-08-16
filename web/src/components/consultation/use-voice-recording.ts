"use client";

// A microphone entry point for the NORMAL chat composer (Consult AI's "Type
// a message" box) -- structurally separate from Teach the AI's own
// recording orchestration in teach-ai-panel.tsx (left untouched, to avoid
// any regression risk to its already live-validated flow), but reusing the
// exact same core STT logic (finishRecording/bindFetch/logClient from
// teach-ai-panel-logic.ts) rather than duplicating a second parallel
// system. This hook is never imported by teach-ai-panel.tsx, and
// teach-ai-panel.tsx's own recorder/chunks refs are never shared with it --
// the only thing shared is the stateless transcription call itself.
//
// Isolation guarantee: this hook only ever calls the caller's own
// onTranscript callback with the resulting text. It has no knowledge of
// Teach the AI's draft/transcriptId state, never calls its save endpoint,
// and never proposes or saves a ProfessionalMemory -- so a chat-composer
// voice note can structurally never reach Teach the AI or trigger an
// accidental Proposed Memory/Confirm-Edit-Reject flow.

import { useCallback, useRef, useState } from "react";

import { bindFetch, finishRecording, logClient } from "./teach-ai-panel-logic";

export interface UseVoiceRecordingOptions {
  clientId: string;
  // The current STT language hint (mirrors the conversation's language
  // selector) -- forwarded straight through to finishRecording's own
  // trailing optional param, prompt-text-only, never a forced constraint.
  language?: "en" | "ro";
  onTranscript: (transcript: string) => void;
}

export interface UseVoiceRecordingResult {
  recording: boolean;
  status: string | undefined;
  toggleRecording: () => void;
}

export function useVoiceRecording({ clientId, language, onTranscript }: UseVoiceRecordingOptions): UseVoiceRecordingResult {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string>();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const toggleRecording = useCallback(() => {
    if (recording) {
      // As in teach-ai-panel.tsx: the actual state reset happens in onstop
      // below, so a stop triggered by the browser/OS ending the track
      // itself (not just this button) resets the UI too.
      recorder.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("Voice input is not supported here. You can still type your message.");
      return;
    }

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks.current = [];
        const media = new MediaRecorder(stream);
        recorder.current = media;
        media.ondataavailable = (event) => {
          if (event.data.size) chunks.current.push(event.data);
        };
        media.onstop = () => {
          void finishRecording(
            stream,
            chunks.current,
            media.mimeType,
            clientId,
            {
              onStopped: () => {
                setRecording(false);
                setStatus("Transcribing...");
              },
              onFailure: (message) => setStatus(message),
              onSuccess: (transcript) => {
                setStatus(undefined);
                // Only ever populates the caller's own composer state --
                // never Teach the AI's draft, never auto-sent, never
                // auto-saved as memory.
                onTranscript(transcript);
              },
            },
            { fetch: bindFetch(fetch) },
            language,
          );
        };
        media.start();
        setRecording(true);
        setStatus("Listening...");
        logClient("recording_started", { mimeType: media.mimeType || null, source: "chat_composer" });
      } catch (error) {
        logClient("recording_start_failed", {
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : String(error),
          source: "chat_composer",
        });
        setStatus("Microphone access was not available. You can still type your message.");
      }
    })();
  }, [recording, clientId, language, onTranscript]);

  return { recording, status, toggleRecording };
}
