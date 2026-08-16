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
// onTranscript callback, and ONLY with a real, non-empty transcript (see
// shouldAutoSubmitTranscript) -- it has no knowledge of Teach the AI's
// draft/transcriptId state, never calls its save endpoint, and never
// proposes or saves a ProfessionalMemory.
//
// Natural-conversation upgrade: recording now auto-stops on its own after
// ~2s of silence following detected speech (Voice Activity Detection, via
// Web Audio API's AnalyserNode -- see voice-activity-logic.ts for the pure,
// unit-tested stop/no-stop decision itself; this file only supplies the
// real audio-level samples, which cannot be unit tested without a browser).
// The caller is expected to auto-submit whenever onTranscript fires --
// this hook fires it identically whether the recording ended by VAD or by
// a manual Stop click, so both behave the same way ("Stop manual încă
// funcționează", not a second, different code path).

import { useCallback, useEffect, useRef, useState } from "react";

import { bindFetch, finishRecording, logClient } from "./teach-ai-panel-logic";
import { evaluateVadSample, initVadState, shouldAutoSubmitTranscript, type VadState } from "./voice-activity-logic";

const AUDIO_LEVEL_SAMPLE_INTERVAL_MS = 100;
const ANALYSER_FFT_SIZE = 512;

const VOICE_INPUT_UNSUPPORTED_MESSAGE = "Voice input is not supported here. You can still type your message.";
const MICROPHONE_UNAVAILABLE_MESSAGE = "Microphone access was not available. You can still type your message.";

export interface UseVoiceRecordingOptions {
  clientId: string;
  // The current STT language hint (mirrors the conversation's language
  // selector) -- forwarded straight through to finishRecording's own
  // trailing optional param, prompt-text-only, never a forced constraint.
  language?: "en" | "ro";
  // Fired ONLY with a real, non-empty transcript -- never for a failed
  // transcription, never for an empty one. The caller is expected to treat
  // this as "the stylist finished speaking a real message" and act on it
  // immediately (e.g. auto-submit), same as a typed Send.
  onTranscript: (transcript: string) => void;
}

export interface UseVoiceRecordingResult {
  // True only while actively capturing audio -- drives the Mic/Square
  // button icon and whether a manual Stop click does anything.
  recording: boolean;
  // True while the recorded audio is being transcribed (no audio capture
  // happening anymore, but not yet ready to record again either).
  processing: boolean;
  // The last recording/transcription failure, if any (unsupported
  // browser, permission denied, transcription failed) -- cleared the next
  // time the mic is pressed. Distinct from a status label: this is
  // specifically something that went wrong.
  error: string | null;
  toggleRecording: () => void;
}

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function computeRmsLevel(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer);
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const normalized = (buffer[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / buffer.length);
}

export function useVoiceRecording({ clientId, language, onTranscript }: UseVoiceRecordingOptions): UseVoiceRecordingResult {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // Guards against the VAD sampling loop (which polls every ~100ms) and a
  // manual Stop click racing to trigger the same stop twice -- MediaRecorder
  // itself only fires onstop once per session regardless, but this also
  // stops the VAD interval from doing any further work once a stop has
  // already been decided.
  const hasStoppedRef = useRef(false);
  const vadCleanupRef = useRef<(() => void) | null>(null);

  const toggleRecording = useCallback(() => {
    if (recording) {
      // Guards a rare race: VAD's own interval (see below) may have
      // already decided to stop in the same tick as a manual click.
      // MediaRecorder.stop() throws if called on an already-inactive/
      // stopping recorder, so this must never call it a second time --
      // onstop (and therefore finishRecording/auto-submit) already only
      // ever runs once regardless, this just avoids the redundant call.
      if (!hasStoppedRef.current) {
        hasStoppedRef.current = true;
        recorder.current?.stop();
      }
      return;
    }

    setError(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(VOICE_INPUT_UNSUPPORTED_MESSAGE);
      return;
    }

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
          vadCleanupRef.current?.();
          vadCleanupRef.current = null;
          streamRef.current = null;
          void finishRecording(
            stream,
            chunks.current,
            media.mimeType,
            clientId,
            {
              onStopped: () => {
                setRecording(false);
                setProcessing(true);
              },
              onFailure: (message) => {
                setProcessing(false);
                setError(message);
              },
              onSuccess: (transcript) => {
                setProcessing(false);
                // Empty/whitespace-only would only ever come from a
                // genuinely unexpected backend response (the route itself
                // already fails closed on an empty transcript) -- this is
                // belt-and-suspenders, not the primary guard.
                if (shouldAutoSubmitTranscript(transcript)) {
                  onTranscript(transcript);
                }
              },
            },
            { fetch: bindFetch(fetch) },
            language,
          );
        };
        media.start();
        setRecording(true);
        logClient("recording_started", { mimeType: media.mimeType || null, source: "chat_composer" });

        const AudioContextCtor = resolveAudioContextConstructor();
        if (AudioContextCtor) {
          try {
            const audioContext = new AudioContextCtor();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = ANALYSER_FFT_SIZE;
            source.connect(analyser);
            const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
            let vadState: VadState = initVadState(performance.now());

            const intervalId = window.setInterval(() => {
              if (hasStoppedRef.current) return;
              const level = computeRmsLevel(analyser, buffer);
              const { state, decision } = evaluateVadSample(vadState, level, performance.now());
              vadState = state;
              if (decision !== "continue") {
                hasStoppedRef.current = true;
                recorder.current?.stop();
              }
            }, AUDIO_LEVEL_SAMPLE_INTERVAL_MS);

            vadCleanupRef.current = () => {
              window.clearInterval(intervalId);
              void audioContext.close().catch(() => {});
            };
          } catch (vadError) {
            // VAD is a nice-to-have on top of a working mic, never a
            // requirement for it -- if the audio graph fails to set up for
            // any reason, recording continues normally via manual Stop only.
            logClient("vad_setup_failed", {
              errorName: vadError instanceof Error ? vadError.name : "unknown",
              source: "chat_composer",
            });
          }
        }
      } catch (error) {
        logClient("recording_start_failed", {
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : String(error),
          source: "chat_composer",
        });
        setError(MICROPHONE_UNAVAILABLE_MESSAGE);
      }
    })();
  }, [recording, clientId, language, onTranscript]);

  // Cleanup on unmount: release the microphone and stop VAD sampling even
  // if the component goes away mid-recording -- detaching the recorder's
  // own handlers first so a track-stop-triggered onstop can never run
  // finishRecording (and therefore setState) after this component is gone.
  useEffect(() => {
    return () => {
      hasStoppedRef.current = true;
      vadCleanupRef.current?.();
      vadCleanupRef.current = null;
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { recording, processing, error, toggleRecording };
}
