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

import type { LanguageCode } from "@/lib/language-registry";
import type { TranslationKey } from "@/lib/translations";

import { decodeBlobAsWav } from "./audio-wav-encode";
import {
  bindFetch,
  classifyMicrophoneStartError,
  finishRecording,
  generateAttemptId,
  logClient,
  type VoiceTranscriptionFailureReason,
} from "./teach-ai-panel-logic";
import { evaluateVadSample, initVadState, shouldAutoSubmitTranscript, type VadState } from "./voice-activity-logic";
import {
  computeVoiceLatencySummary,
  logVoiceLatencySummary,
  markVoiceLatencyStage,
  mergeVoiceLatencyMarks,
  type VoiceLatencyMarks,
} from "./voice-latency-logic";

const AUDIO_LEVEL_SAMPLE_INTERVAL_MS = 100;
const ANALYSER_FFT_SIZE = 512;

// Voice reliability hardening (2026-08-18): maps finishRecording's own
// honest failure reason to this app's centralized i18n dictionary (see
// translations.ts's consultAi.voiceError.* keys) -- the caller's `t`
// translates it into the stylist's own UI language. A getUserMedia/
// MediaRecorder unsupported-browser failure (never reaches finishRecording
// at all) reuses "microphoneUnavailable": from the stylist's point of
// view, "voice input doesn't work here" and "the mic isn't available" are
// the same honest situation.
function translationKeyForReason(reason: VoiceTranscriptionFailureReason): TranslationKey {
  switch (reason) {
    case "providerUnavailable":
      return "consultAi.voiceError.providerUnavailable";
    case "saveUnavailable":
      return "consultAi.voiceError.saveUnavailable";
    case "unsupportedFormat":
      return "consultAi.voiceError.unsupportedFormat";
    case "invalidAudio":
      return "consultAi.voiceError.invalidAudio";
    case "emptyRecording":
      return "consultAi.voiceError.emptyRecording";
    case "unknown":
    default:
      return "consultAi.voiceError.unknown";
  }
}

export interface UseVoiceRecordingOptions {
  clientId: string;
  // The current STT language hint (mirrors the conversation's language
  // selector) -- forwarded straight through to finishRecording's own
  // trailing optional param, prompt-text-only, never a forced constraint.
  language?: LanguageCode;
  // The app's own UI-language translator (see useUiLanguage) -- every
  // stylist-facing failure message this hook produces is translated
  // through it, never a hardcoded English string, so a stylist working in
  // any of the app's supported UI languages sees an honest message in
  // their own language, not just en/ro.
  t: (key: TranslationKey) => string;
  // Fired ONLY with a real, non-empty transcript -- never for a failed
  // transcription, never for an empty one. The caller is expected to treat
  // this as "the stylist finished speaking a real message" and act on it
  // immediately (e.g. auto-submit), same as a typed Send.
  //
  // Voice latency audit (2026-08-18): `latency` carries the mic+STT phase
  // marks/attemptId for this exact turn, so the caller (consultation-
  // chat.tsx) can continue the SAME turn's instrumentation through
  // Consult AI and TTS, ending in one combined VOICE_LATENCY summary --
  // see voice-latency-logic.ts's own module comment for why this is
  // threaded through callbacks rather than a shared event bus.
  onTranscript: (transcript: string, latency: VoiceTurnLatencyInfo) => void;
}

export interface VoiceTurnLatencyInfo {
  attemptId: string;
  marks: VoiceLatencyMarks;
  sttProviderMs: number | null;
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

export function useVoiceRecording({ clientId, language, t, onTranscript }: UseVoiceRecordingOptions): UseVoiceRecordingResult {
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
  // Voice reliability hardening (2026-08-18): guards the async window
  // between a click and getUserMedia's own promise resolving -- `recording`
  // (React state) does not flip to true until AFTER that promise settles,
  // so a rapid second click in that window would otherwise see
  // `recording === false` and start a SECOND, fully independent
  // getUserMedia()/MediaRecorder setup, racing the first one for the same
  // physical microphone. A plain ref (not state) so the check is exact and
  // synchronous, unlike a state update which only takes effect on the next
  // render.
  const startingRef = useRef(false);
  // One id per logical mic-press-to-result cycle, generated the moment a
  // start is actually accepted (not on every click, which could double-
  // generate if startingRef already rejected the click) -- carried through
  // every log event for this cycle, including into finishRecording, so a
  // stylist-reported incident can be found by this one id end to end.
  const attemptIdRef = useRef<string | null>(null);
  // Voice latency audit (2026-08-18): mic-phase marks (mic_requested,
  // mic_ready, recording_started) for the CURRENT attempt cycle only --
  // reset the moment a new attemptId is generated. Merged with
  // finishRecording's own (recording_stopped..transcript_ready) marks at
  // the onSuccess/onFailure boundary below, since those are the two
  // structurally separate layers this turn's timeline spans before
  // Consult AI/TTS (see use-voice-recording.ts's own onTranscript doc
  // comment above).
  const micMarksRef = useRef<VoiceLatencyMarks>({});

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

    // See startingRef's own doc comment -- rejects a second start attempt
    // that lands while the first one's getUserMedia() promise is still
    // pending, before `recording` state has had a chance to become true.
    if (startingRef.current) {
      return;
    }
    startingRef.current = true;

    setError(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      startingRef.current = false;
      setError(t("consultAi.voiceError.microphoneUnavailable"));
      return;
    }

    const attemptId = generateAttemptId();
    attemptIdRef.current = attemptId;
    micMarksRef.current = {};

    void (async () => {
      try {
        logClient("mic_requested", { attemptId, source: "chat_composer" });
        micMarksRef.current = markVoiceLatencyStage(micMarksRef.current, "mic_requested", performance.now());
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        logClient("mic_granted", { attemptId, source: "chat_composer" });
        micMarksRef.current = markVoiceLatencyStage(micMarksRef.current, "mic_ready", performance.now());
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
          // The MediaRecorder instance itself is genuinely done the
          // moment onstop fires, regardless of how long the async
          // upload below takes -- nulling it here (not just on unmount)
          // guarantees the NEXT toggleRecording call always constructs a
          // fully fresh MediaRecorder rather than retaining any
          // reference to this now-inactive one.
          recorder.current = null;
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
              onFailure: (_message, reason, marks) => {
                setProcessing(false);
                setError(t(translationKeyForReason(reason)));
                // The turn ends here (no Consult AI/TTS stage will ever
                // run for a failed transcription) -- log the summary now
                // rather than deferring to a caller that will never
                // receive this attempt at all.
                const mergedMarks = mergeVoiceLatencyMarks(micMarksRef.current, marks);
                logVoiceLatencySummary(attemptId, computeVoiceLatencySummary(mergedMarks));
              },
              onSuccess: (transcript, _transcriptId, marks, sttProviderMs) => {
                setProcessing(false);
                const mergedMarks = mergeVoiceLatencyMarks(micMarksRef.current, marks);
                // Empty/whitespace-only would only ever come from a
                // genuinely unexpected backend response (the route itself
                // already fails closed on an empty transcript) -- this is
                // belt-and-suspenders, not the primary guard.
                if (shouldAutoSubmitTranscript(transcript)) {
                  onTranscript(transcript, { attemptId, marks: mergedMarks, sttProviderMs });
                } else {
                  // Same reasoning as the onFailure branch above: this
                  // turn also ends here, since onTranscript (and therefore
                  // any downstream Consult AI/TTS instrumentation) is
                  // never reached.
                  logVoiceLatencySummary(
                    attemptId,
                    computeVoiceLatencySummary(mergedMarks, { sttProviderMs: sttProviderMs ?? undefined }),
                  );
                }
              },
            },
            { fetch: bindFetch(fetch), encodeAsWav: decodeBlobAsWav },
            language,
            attemptId,
          );
        };
        media.start();
        setRecording(true);
        startingRef.current = false;
        logClient("recorder_started", { attemptId, mimeType: media.mimeType || null, source: "chat_composer" });
        micMarksRef.current = markVoiceLatencyStage(micMarksRef.current, "recording_started", performance.now());

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
        const reason = classifyMicrophoneStartError(error);
        logClient(reason === "denied" ? "mic_denied" : "recording_start_failed", {
          attemptId,
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : String(error),
          source: "chat_composer",
        });
        logClient("cleanup_completed", { attemptId });
        startingRef.current = false;
        setError(t(reason === "denied" ? "consultAi.voiceError.permissionDenied" : "consultAi.voiceError.microphoneUnavailable"));
      }
    })();
  }, [recording, clientId, language, t, onTranscript]);

  // Cleanup on unmount: release the microphone and stop VAD sampling even
  // if the component goes away mid-recording -- detaching the recorder's
  // own handlers first so a track-stop-triggered onstop can never run
  // finishRecording (and therefore setState) after this component is gone.
  useEffect(() => {
    return () => {
      hasStoppedRef.current = true;
      startingRef.current = false;
      vadCleanupRef.current?.();
      vadCleanupRef.current = null;
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
      }
      recorder.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { recording, processing, error, toggleRecording };
}
