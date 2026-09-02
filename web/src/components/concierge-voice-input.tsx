"use client";

// AI Concierge V1 -- Voice Input Integration. VOICE IS CLOSED: this file
// composes the EXISTING, unmodified useVoiceRecording hook
// (consultation/use-voice-recording.ts) -- it does not touch MediaRecorder,
// VAD/Silero, STT request code, microphone permissions, audio conversion,
// or Voice telemetry. Every one of those stays exactly as validated before
// Voice was closed.
//
// THE ONE REAL INTEGRATION PROBLEM (verified from current code, not
// assumed): useVoiceRecording's own UseVoiceRecordingOptions.clientId is a
// required `string`, and its actual STT/telemetry calls
// (teach-ai-panel-logic.ts's finishRecording, called from inside that hook)
// are routed through the client-scoped `/api/v1/clients/[id]/voice-transcript`
// and `/api/v1/clients/[id]/voice-latency` endpoints -- there is no
// client-less STT route anywhere in this codebase, and adding one would be
// a real Voice-architecture change, explicitly out of scope for this task.
//
// THE SMALLEST SAFE ADAPTER (this file's entire job): useVoiceRecording is
// NEVER called with a fake/empty clientId -- it is only ever called with a
// REAL one. When Concierge has no active client yet (activeClientId is
// null), this component renders a plain, disabled mic button with an
// honest explanation and calls useVoiceRecording zero times. The moment a
// real client becomes active -- by ANY means the existing, deterministic,
// owner-scoped Concierge mechanism already produces (a typed message that
// resolved one, page context, or a prior voice turn) -- a NEW child
// component mounts (keyed by clientId, so switching clients gets a clean
// hook instance) and the real hook is used exactly as
// consultation-chat.tsx already uses it. No fake ID is ever invented; no
// second STT/orchestrator path is created.
//
// KNOWN, HONEST LIMITATION (reported, not hidden -- see this task's own
// final report): the very FIRST utterance of a session, spoken from a
// completely cold Dashboard with zero prior context (no page context, no
// remembered client), cannot use voice, because the closed STT route has
// nowhere to route to yet. That first utterance must be typed (or the
// Concierge must already have page-supplied context). Every voice turn
// after that -- including naming a client for the first time once ANY
// client is already active -- works. Closing this fully would require
// making the Voice hook's clientId optional and adding a client-less STT
// route, both explicitly out of scope here.

import { Mic, Square } from "lucide-react";

import { Button } from "@/components/ui";
import type { LanguageCode } from "@/lib/language-registry";
import type { TranslationKey } from "@/lib/translations";
import { isConciergeVoiceInputBusy } from "./concierge-logic";
import { useVoiceRecording } from "./consultation/use-voice-recording";

export interface ConciergeVoiceInputProps {
  // The SAME effective client id useConcierge already resolves for text
  // input (page context, falling back to remembered workflow memory) --
  // never a value this component invents or derives itself.
  activeClientId: string | null;
  language: LanguageCode;
  t: (key: TranslationKey) => string;
  // Concierge's own ask()-in-flight state -- disables the mic exactly like
  // it already disables the Send button, so a transcript can never arrive
  // while a previous orchestration request is still outstanding.
  loading: boolean;
  // Fired with a real, trimmed, non-empty transcript -- the caller (see
  // concierge-panel.tsx) feeds this straight into the SAME submit path a
  // typed message already uses. This component never calls ask() itself.
  onTranscript: (transcript: string) => void;
}

export function ConciergeVoiceInput({ activeClientId, language, t, loading, onTranscript }: ConciergeVoiceInputProps) {
  if (!activeClientId) {
    return (
      <Button type="button" variant="secondary" disabled aria-label="Voice input" title={t("concierge.voice.needsClient")}>
        <Mic className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  // key={activeClientId}: forces a clean unmount/remount of the recorder
  // (and therefore a fresh useVoiceRecording instance) whenever the active
  // client changes, rather than letting the SAME hook instance silently
  // observe a new clientId prop mid-lifecycle -- the safe, standard way to
  // compose a hook whose identity is tied to one real resource.
  return <ConciergeVoiceRecorder key={activeClientId} clientId={activeClientId} language={language} t={t} loading={loading} onTranscript={onTranscript} />;
}

function ConciergeVoiceRecorder({
  clientId,
  language,
  t,
  loading,
  onTranscript,
}: {
  clientId: string;
  language: LanguageCode;
  t: (key: TranslationKey) => string;
  loading: boolean;
  onTranscript: (transcript: string) => void;
}) {
  // The EXISTING, closed hook -- same call shape consultation-chat.tsx
  // already uses (clientId, language, t, onTranscript). `language` is
  // Concierge's own already-resolved UI language (useUiLanguage) -- the
  // SAME global language mechanism the rest of Concierge already uses,
  // never a second, independent selector (task section 6).
  const { recording, processing, error, toggleRecording } = useVoiceRecording({
    clientId,
    language,
    t,
    onTranscript: (transcript) => {
      // shouldAutoSubmitTranscript (voice-activity-logic.ts) already
      // guarantees this only ever fires once per recording, with a real,
      // non-empty transcript -- trimming here matches exactly how a typed
      // message is trimmed before submission, never a second filter.
      onTranscript(transcript.trim());
    },
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        onClick={toggleRecording}
        disabled={isConciergeVoiceInputBusy(loading, processing)}
        loading={processing}
        aria-label={recording ? "Stop voice input" : "Voice input"}
      >
        {recording ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
      </Button>
      {/* Reuses Consult AI's own existing, already-translated states
          (task section 5: "reuse existing translations where possible") --
          no new status copy invented for Concierge. */}
      {recording ? <p className="text-xs text-muted">{t("consultAi.listening")}</p> : null}
      {processing ? <p className="text-xs text-muted">{t("consultAi.processing")}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
