"use client";

import { MessageCircle, Mic, Send, Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Alert, Badge, Button, Card, LanguageCombobox, LoadingState, Textarea } from "@/components/ui";
import type {
  ConsultationChatProposedCorrection,
  ConsultationChatRequest,
  ConsultationChatResponse,
  ConsultationMessageRecord
} from "@/lib/contracts";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import { conversationSupportedLanguages, getLanguageDefinition, isCloudTtsLanguageCode, toCloudTtsLanguageCode, type LanguageCode } from "@/lib/language-registry";
import type { TranslationKey } from "@/lib/translations";
import { useUiLanguage } from "@/lib/ui-language-context";

import { logVoiceReplyClientEvent, synthesizeCloudVoiceReply, type CloudVoiceReplyServerTiming } from "./consultation-chat-cloud-tts-logic";
import { AUDIO_UNLOCK_DATA_URI, dataUriToBlob, resolveVoiceReplyEnableOutcome } from "./voice-reply-unlock-logic";
import {
  buildChatLanguageFields,
  callOnce,
  canApplyCorrection,
  describeApplyCorrectionFailure,
  describeSendFailure,
  extractMemoryDecisionIds,
  formatMessageTime,
  isSendableMessage,
  isVoiceInputBusy,
  LANGUAGE_SELECTION_STORAGE_KEY,
  parseStoredLanguageSelection,
  resolveConsultationHistoryLoadStatus,
  resolveNoAnalysisGuidanceActionMode,
  resolveProposedDirectionPresentation,
  resolveSttLanguageHint,
  type LanguageSelection
} from "./consultation-chat-logic";
import {
  isSpeechSynthesisSupported,
  languageToSpeechLocale,
  resolveReplyLanguage,
  speakReply,
  stopSpeaking,
  type LanguagePreference,
  type SpeechSynthesisLike,
  type SpeechUtteranceLike
} from "./consultation-chat-tts-logic";
import { TeachAiPanel } from "./teach-ai-panel";
import { bindFetch } from "./teach-ai-panel-logic";
import { useVoiceRecording, vadDiagnosticsToReportFields, type VoiceTurnLatencyInfo } from "./use-voice-recording";
import type { VoiceActivityDiagnostics } from "./voice-activity-logic";
import {
  computeElapsedSinceMicRequestMs,
  computeVoiceLatencySummary,
  logVoiceLatencySummary,
  markVoiceLatencyStage,
  reportVoiceLatencySummary,
  type VoiceLatencyMarks,
  type VoiceLatencyTurnOutcome,
} from "./voice-latency-logic";

export interface ConsultationChatProps {
  clientId: string;
  analysisId?: string;
  // Called after a proposed correction is successfully applied, so the
  // parent (e.g. the analysis result page) can refetch and show the
  // recomputed plan. Applying a correction always goes through the real
  // POST /api/v1/analysis/{id}/correct endpoint -- this component never
  // mutates analysis data itself.
  onCorrectionApplied?: () => void;
  // AI Proposed Look Phase 1 bug fix: the "AI Proposed Direction" card's
  // no-analysisId guidance (see ProposedDirectionCard below) needs a real
  // way to reach the client's analyses -- but the ONLY place that card
  // ever renders (no analysisId means the general, client-scoped Consult
  // AI tab) is already rendered at /clients/{clientId}, on the client
  // detail page's own "consult" tab. That page's tabs are local React
  // state, not routed (see clients/[id]/page.tsx's activeTab), so a
  // <Link href={`/clients/${clientId}`}> resolved to the exact URL the
  // browser was already on -- a same-route no-op Next.js doesn't remount,
  // so nothing ever visibly happened on click. This optional callback
  // lets the parent page switch its own local tab state instead of
  // attempting a real navigation; when absent (e.g. a future caller with
  // no such tab concept), ProposedDirectionCard falls back to the plain
  // cross-page Link, which is still a safe, valid destination.
  onNavigateToAnalyses?: () => void;
}

type HistoryStatus = "loading" | "ready" | "error";

// Voice latency audit (2026-08-18): carries a voice-initiated turn's marks
// and already-known provider timings (STT, Consult AI) into speakMessage,
// so the TTS phase can extend the SAME marks object rather than starting a
// second, disconnected one -- see sendMessage's own call sites below.
interface VoiceTurnLatencyContext {
  attemptId: string;
  marks: VoiceLatencyMarks;
  sttProviderMs: number | null;
  consultationProviderMs?: number;
  // Voice latency Round 12: the server's own full Consult AI timing
  // breakdown, threaded through the same way as consultationProviderMs --
  // see consultation-chat-service.ts's own SendConsultationMessageResult
  // doc comment for what closed the ~27.6s gap this exists to measure.
  consultationPreProviderMs?: number;
  consultationReplyWriteMs?: number;
  consultationFailedFirstAttemptMs?: number;
  consultationServerTotalMs?: number;
  consultationUnattributedMs?: number;
  // Round 11 (gemini-2.5-flash-lite STT evaluation): the server's own
  // resolved STT model string, carried through so the turn's FINAL
  // VOICE_LATENCY_SUMMARY (concluded from speakMessage, not just an
  // STT-only failure) can still be attributed to a model -- never
  // fabricated when absent.
  sttModel?: string | null;
  // End-of-speech hardening (2026-08-20): carried through the same way as
  // sttModel, for the same reason -- never fabricated when VAD never ran
  // for this attempt.
  vadDiagnostics?: VoiceActivityDiagnostics | null;
}

const MEMORY_ACTION_LABELS: Record<string, string> = {
  save_client_memory: "Save to client memory",
  save_professional_rule: "Save as professional rule",
  mark_preference: "Save as preference",
  save_outcome: "Save as outcome"
};

export function ConsultationChat({ clientId, analysisId, onCorrectionApplied, onNavigateToAnalyses }: ConsultationChatProps) {
  // The app's GLOBAL UI language (see (app)/layout.tsx) -- for this
  // component's own static chrome (Voice Reply/Stop/Send/composer
  // placeholder) only. Deliberately independent of languageSelection
  // below, which is the CONVERSATION's own language (point 2 of the
  // requirement: UI language and conversation language must be able to
  // differ, e.g. a Romanian UI with an Italian conversation).
  const { t } = useUiLanguage();
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("loading");
  const [messages, setMessages] = useState<ConsultationMessageRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [appliedCorrectionIds, setAppliedCorrectionIds] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);
  // Keyed by message id, like appliedCorrectionIds -- a live production
  // report found that a failed Apply attempt (e.g. the server correctly
  // rejecting an unrecognized proposed value) looked exactly like nothing
  // happening at all: the request WAS sent and WAS rejected, but the
  // client silently discarded any non-ok response. Cleared the moment a
  // fresh attempt starts, so a retry never shows a stale error.
  const [applyErrors, setApplyErrors] = useState<Record<string, string>>({});
  // Proposed-memory review state, keyed by the assistant message id that
  // carried the proposal. confirmedMemoryIds/rejectedMemoryIds are seeded
  // from each message's own persisted proposedMemoryDecision on every
  // history load below -- the database is the source of truth for whether
  // a card is still pending, not a Set that resets to empty on every mount.
  const [confirmedMemoryIds, setConfirmedMemoryIds] = useState<Set<string>>(new Set());
  const [rejectedMemoryIds, setRejectedMemoryIds] = useState<Set<string>>(new Set());
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [confirmingMemoryId, setConfirmingMemoryId] = useState<string | null>(null);
  const [rejectingMemoryId, setRejectingMemoryId] = useState<string | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  // AI Voice Reply (optional, OFF by default): reads the AI's own text
  // reply aloud, cloud TTS first, the browser's native speech synthesis as
  // fallback (see speakMessage below) -- never a second, separately-
  // generated response (both paths only ever read `content`, the exact
  // text already rendered below).
  //
  // Whether the Voice Reply toggle itself should even be shown. Cloud TTS
  // (the primary provider now) only needs the standard HTML5 Audio API,
  // NOT window.speechSynthesis -- gating the whole feature on Web Speech
  // support (as it was before cloud TTS existed) would wrongly hide Voice
  // Reply on a device with no Web Speech API installed that can still
  // perfectly well play the cloud-generated audio. Starts false and is
  // only set after mount (never read during SSR) to avoid a hydration
  // mismatch; a browser with neither capability just never shows the
  // toggle, degrading honestly to text-only.
  const [voiceReplyAvailable, setVoiceReplyAvailable] = useState(false);
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(false);
  // True only for the brief window while an unlock attempt (see
  // unlockAudioPlayback) is in flight -- disables the toggle so a second,
  // overlapping click can never race the first attempt's own state
  // update, and doubles as an honest "why is this disabled right now"
  // signal rather than the toggle just silently not responding.
  const [voiceReplyUnlocking, setVoiceReplyUnlocking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  // Cloud TTS is now the PRIMARY Voice Reply path (see
  // consultation-chat-cloud-tts-logic.ts); this tracks the "Generating
  // voice..." window between requesting audio and it actually starting to
  // play -- distinct from speakingMessageId (which covers BOTH cloud
  // playback and the local Web Speech fallback, since only one of the two
  // is ever active for a given message).
  const [voiceGeneratingMessageId, setVoiceGeneratingMessageId] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Distinct from voiceError (an actual playback failure): set when the
  // device simply has no installed voice for the requested language --
  // speech still plays best-effort, so this is an honest heads-up, not a
  // failure. Never silently implies the requested language's voice was
  // used when it wasn't (see selectVoiceForLocale's own regression note).
  const [voiceUnavailableNotice, setVoiceUnavailableNotice] = useState<string | null>(null);
  // The conversation's own "Language" selector -- Auto plus every
  // conversation-supported registry language (see language-registry.ts),
  // not a hardcoded Auto/English/Romanian list. Distinct from the
  // account/UI locale on purpose (see consultation-chat-service.ts's
  // ConsultationChatLanguageHint): a concrete choice here is a hard
  // override for this conversation only, never something the app-wide UI
  // language forces onto it. Starts "auto" (matching SSR) and is hydrated
  // from localStorage after mount, same hydration-safe pattern as
  // speechSupported above.
  const [languageSelection, setLanguageSelection] = useState<LanguageSelection>("auto");
  // The conversation's own currently-established language (a LanguageCode
  // -- the SAME currency as the STT hint and the AI-reply-language hint,
  // never a separately-tracked BCP-47 speech tag), updated whenever an AI
  // reply is confidently detected (see resolveReplyLanguage) -- used only
  // as a soft fallback (STT hint, ambiguous-reply TTS/reply language),
  // never a forced value.
  const [conversationLanguage, setConversationLanguage] = useState<LanguageCode | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  // The single, persistent cloud-TTS <audio> element -- created once (see
  // getOrCreateCloudAudioElement below) and reused for both the toggle's
  // own iOS unlock attempt and every reply's real playback, never
  // recreated per reply. Deliberately one long-lived element rather than
  // `new Audio()` per reply: iOS Safari's autoplay policy only grants
  // unlocked playback to an element that has already successfully played
  // once in direct response to a user gesture (see
  // voice-reply-unlock-logic.ts's module comment) -- reusing that exact
  // element for every later, asynchronously-triggered reply is the most
  // broadly WebKit-compatible way to keep relying on that unlock.
  // stopCloudAudio (below) never nulls this ref, for the same reason.
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null);
  // Voice reliability hardening (2026-08-18): a monotonic token,
  // incremented at the start of every speakMessage call AND by
  // handleStopSpeaking. A cloud TTS request/playback callback only ever
  // acts (plays audio, updates speaking/generating state) if the token it
  // captured when it started is STILL the current one -- otherwise a
  // second message sent while the first reply's audio is still being
  // generated (or an explicit Stop click) would let the FIRST, now-stale
  // attempt's response start playing audio for a message that is no
  // longer the active one, or resurrect audio after the stylist
  // explicitly said Stop. See speakMessage/handleStopSpeaking below.
  const voiceReplyAttemptRef = useRef(0);
  // Aborts a still-in-flight cloud TTS request the moment it's superseded
  // (a newer speakMessage call, or Stop) -- purely a network-efficiency
  // improvement; voiceReplyAttemptRef alone already guarantees a stale
  // response can never be acted on even without this.
  const voiceReplyAbortControllerRef = useRef<AbortController | null>(null);
  // Voice latency audit (2026-08-18): the in-progress voice turn's own
  // marks/attemptId, set the moment a chat-composer voice transcript
  // arrives and consumed (cleared) by the very next sendMessage call --
  // see sendMessage/speakMessage below for how this is carried through
  // Consult AI and TTS to one final VOICE_LATENCY summary. Always null for
  // a typed message, so typed sends never produce a latency log.
  const voiceTurnRef = useRef<VoiceTurnLatencyInfo | null>(null);

  const sttLanguageHint = resolveSttLanguageHint(languageSelection, conversationLanguage);
  const {
    recording: chatRecording,
    processing: chatProcessing,
    error: chatVoiceError,
    toggleRecording: toggleChatRecording,
  } = useVoiceRecording({
    clientId,
    language: sttLanguageHint,
    t,
    // Natural-conversation flow: speaking and pausing (or a manual Stop)
    // sends immediately, exactly like a typed Send -- no separate review
    // step. Still structurally isolated from Teach the AI: this hook has
    // no knowledge of its draft/transcriptId state at all, so a
    // chat-composer voice note can never reach it or trigger a memory
    // proposal.
    onTranscript: (transcript, latency) => {
      voiceTurnRef.current = latency;
      void sendMessage(transcript.trim());
    },
  });

  useEffect(() => {
    // Unavoidable: which voice capabilities exist is only knowable
    // client-side, and must be synced into state after mount (starting at
    // false, matching what SSR renders) to avoid a hydration mismatch --
    // the same pattern already used elsewhere in this codebase (see
    // milestone2-analysis-panel.tsx) for the same class of browser-only
    // capability check. Available if EITHER the standard Audio element
    // (cloud TTS playback) or window.speechSynthesis (local fallback)
    // exists -- in practice virtually always the Audio element.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoiceReplyAvailable(
      typeof window !== "undefined" && (typeof window.Audio !== "undefined" || isSpeechSynthesisSupported(window)),
    );
    // Same hydration-safe reasoning as voiceReplyAvailable above -- the stored
    // selection is only knowable client-side.
    if (typeof window !== "undefined") {
      setLanguageSelection(parseStoredLanguageSelection(window.localStorage.getItem(LANGUAGE_SELECTION_STORAGE_KEY)));
    }
    // Some browsers only start loading the installed voice list (which
    // getVoices() needs to find a ro-RO/en-US match -- see
    // consultation-chat-tts-logic.ts's selectVoiceForLocale) after the
    // first getVoices() call, and finish asynchronously via the
    // voiceschanged event. Nudging it here means the list is more likely
    // to already be populated by the time the first reply actually needs
    // to speak -- speakReply always re-reads getVoices() fresh at call
    // time, so nothing else needs to consume this value.
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }
    // Cleanup: never leave the browser still reading a reply aloud after
    // this component unmounts (e.g. navigating away mid-speech).
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        stopSpeaking(window.speechSynthesis as unknown as SpeechSynthesisLike);
      }
      stopCloudAudio();
    };
  }, []);

  // Tears down whatever cloud-TTS audio is currently playing/loading, if
  // any -- releases its object URL (never leaked) and detaches handlers
  // first so a stop/unmount/new-reply can never race with a still-in-
  // flight onended/onerror callback touching state after the fact.
  // Deliberately does NOT null out cloudAudioRef.current: this is the
  // same persistent, already-iOS-unlocked element (see
  // getOrCreateCloudAudioElement/unlockAudioPlayback below) reused for
  // every reply -- discarding it here would lose the unlock and silently
  // reintroduce "Voice Reply: On, but no audio plays" on iPhone the very
  // next time a reply arrives.
  function stopCloudAudio() {
    const audio = cloudAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.onplay = null;
    audio.onended = null;
    audio.onerror = null;
    if (audio.src.startsWith("blob:")) {
      URL.revokeObjectURL(audio.src);
    }
  }

  function getOrCreateCloudAudioElement(): HTMLAudioElement {
    if (!cloudAudioRef.current) {
      cloudAudioRef.current = new Audio();
    }
    return cloudAudioRef.current;
  }

  // Best-effort priming of the OTHER audio pathway (the local Web Speech
  // fallback -- see speakMessageLocally): WebKit gates
  // speechSynthesis.speak() behind the same kind of user-gesture
  // requirement as HTMLMediaElement.play(), as a wholly separate browser
  // subsystem from <audio> -- unlocking one does not unlock the other.
  // Never allowed to affect whether Voice Reply reports itself as on:
  // the cloud-audio unlock in unlockAudioPlayback below is what gates
  // that, since cloud TTS is the primary path (covers every registry
  // language) and the local path is only ever a fallback for it.
  function primeSpeechSynthesis(): void {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const utterance = new SpeechSynthesisUtterance(" ");
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.cancel();
    } catch {
      // No fallback needed here -- see the comment above.
    }
  }

  // Spends the toggle-on click's own user gesture immediately: plays a
  // real (silent) clip on the persistent cloud-audio element so iOS
  // Safari grants it (and, per WebKit's documented autoplay behavior, the
  // page more broadly) unlocked playback for the rest of the session --
  // see voice-reply-unlock-logic.ts's module comment for why this is
  // necessary at all (a real reply's own audio.play() call is only ever
  // reached after two real network round-trips, by which point iOS's
  // transient user-activation window has already expired).
  //
  // Regression this fixes (CONFIRMED, not theorized -- see
  // dataUriToBlob's own doc comment): this app's CSP is media-src 'self'
  // blob: -- it does NOT include data:. An earlier version set audio.src
  // directly to AUDIO_UNLOCK_DATA_URI (a data: URI), which CSP blocks at
  // the security-policy level before ever attempting to decode it, on
  // every CSP-enforcing browser, regardless of platform -- so audio.play()
  // rejected deterministically, every single click, and the toggle could
  // never report itself as on. Converting to a blob: URL (already
  // permitted; this app's own cloud TTS playback already proves that
  // scheme works) fixes it without touching CSP at all.
  //
  // A second, independent fix already landed here (e05aa0b): an earlier
  // version also called primeSpeechSynthesis() BEFORE audio.play(), which
  // per WebKit's documented "consumable" user-activation model could have
  // exhausted the click's gesture before audio.play() got to use it. That
  // ordering is kept even though the CSP block alone was sufficient to
  // explain the full production symptom -- both are real, independent
  // correctness issues, not alternatives to each other.
  function unlockAudioPlayback(): Promise<boolean> {
    const audio = getOrCreateCloudAudioElement();
    logVoiceReplyClientEvent("unlock_audio_element_ready", {
      readyState: audio.readyState,
      hadSrc: Boolean(audio.src),
    });

    const unlockUrl = URL.createObjectURL(dataUriToBlob(AUDIO_UNLOCK_DATA_URI));
    audio.src = unlockUrl;
    logVoiceReplyClientEvent("unlock_start", { readyState: audio.readyState });

    return audio
      .play()
      .then(() => {
        logVoiceReplyClientEvent("unlock_succeeded", { readyState: audio.readyState });
        return true;
      })
      .catch((error: unknown) => {
        logVoiceReplyClientEvent("unlock_failed", {
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : String(error),
          readyState: audio.readyState,
          networkState: audio.networkState,
          mediaErrorCode: audio.error?.code ?? null,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        });
        return false;
      })
      .finally(() => {
        URL.revokeObjectURL(unlockUrl);
        primeSpeechSynthesis();
      });
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/v1/clients/${clientId}/chat`, { method: "GET" });
        if (cancelled) return;

        const status = resolveConsultationHistoryLoadStatus(response);
        if (status !== "ready") {
          setHistoryStatus(status);
          return;
        }

        const payload = (await response.json()) as { messages: ConsultationMessageRecord[] };
        setMessages(payload.messages);
        const { confirmed, rejected } = extractMemoryDecisionIds(payload.messages);
        setConfirmedMemoryIds(confirmed);
        setRejectedMemoryIds(rejected);
        setHistoryStatus("ready");
      } catch {
        if (!cancelled) {
          setHistoryStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Extracted from the form's own submit handler so a chat-composer voice
  // message (see onTranscript above) can send itself through the EXACT
  // same pipeline as a typed message -- one send mechanism, not two --
  // including triggering Voice Reply's TTS on the new assistant reply
  // identically regardless of the message's origin.
  async function sendMessage(outgoing: string) {
    if (!isSendableMessage(outgoing) || sending) {
      return;
    }

    // Consumed here, synchronously, before any `await` -- onTranscript
    // (use-voice-recording.ts) sets voiceTurnRef and calls sendMessage in
    // the same tick, so no other code can run between the two. A typed
    // send always sees this as null (no voice turn ever set it).
    const voiceTurn = voiceTurnRef.current;
    voiceTurnRef.current = null;
    let marks: VoiceLatencyMarks = voiceTurn?.marks ?? {};
    // Logs locally (browser console) AND reports server-side (see
    // voice-latency-logic.ts's own doc comment for why both are needed --
    // the console.log alone never reaches Railway).
    const concludeVoiceTurn = (
      finalMarks: VoiceLatencyMarks,
      outcome: VoiceLatencyTurnOutcome,
      consultationProviderMs?: number,
      diagnostics: { errorCode?: string; providerAttemptCount?: number } = {},
    ) => {
      if (!voiceTurn) return;
      const summary = computeVoiceLatencySummary(finalMarks, {
        sttProviderMs: voiceTurn.sttProviderMs ?? undefined,
        consultationProviderMs,
      });
      logVoiceLatencySummary(voiceTurn.attemptId, summary);
      reportVoiceLatencySummary(clientId, voiceTurn.attemptId, outcome, summary, { fetch: bindFetch(fetch) }, {
        ...diagnostics,
        // Round 11: never fabricated -- undefined when the STT response
        // genuinely didn't include a model string.
        sttModel: voiceTurn.sttModel ?? undefined,
        elapsedSinceMicRequestMs: computeElapsedSinceMicRequestMs(finalMarks, performance.now()),
        ...vadDiagnosticsToReportFields(voiceTurn.vadDiagnostics ?? null),
      });
    };

    const optimistic: ConsultationMessageRecord = {
      id: `pending-${Date.now()}`,
      role: "stylist",
      content: outgoing,
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setSending(true);
    setSendError(null);

    try {
      const body: ConsultationChatRequest & {
        analysisId?: string;
        languagePreference?: LanguageCode;
        conversationLanguage?: LanguageCode;
        voiceTurnId?: string;
      } = {
        message: outgoing,
        ...(analysisId ? { analysisId } : {}),
        ...buildChatLanguageFields(languageSelection, conversationLanguage),
        ...(voiceTurn ? { voiceTurnId: voiceTurn.attemptId } : {}),
      };
      if (voiceTurn) marks = markVoiceLatencyStage(marks, "consultation_request_started", performance.now());
      const response = await fetch(`/api/v1/clients/${clientId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        setSendError(describeSendFailure(response.status));
        if (voiceTurn) {
          // The turn ends here -- Consult AI failed, so TTS is never
          // reached for this attempt.
          marks = markVoiceLatencyStage(marks, "consultation_response_received", performance.now());
          const errorBody = (await response.json().catch(() => null)) as
            | { error?: string; providerAttemptCount?: number }
            | null;
          concludeVoiceTurn(marks, "consultation_failed", undefined, {
            errorCode: errorBody?.error,
            providerAttemptCount: errorBody?.providerAttemptCount,
          });
        }
        return;
      }

      const payload = (await response.json()) as ConsultationChatResponse;
      if (voiceTurn) marks = markVoiceLatencyStage(marks, "consultation_response_received", performance.now());
      setMessages((prev) => [...prev, payload.reply]);
      if (voiceReplyEnabled) {
        speakMessage(
          payload.reply,
          voiceTurn
            ? {
                attemptId: voiceTurn.attemptId,
                marks,
                sttProviderMs: voiceTurn.sttProviderMs,
                sttModel: voiceTurn.sttModel,
                vadDiagnostics: voiceTurn.vadDiagnostics,
                consultationProviderMs: payload.providerLatencyMs,
                consultationPreProviderMs: payload.preProviderReadsMs,
                consultationReplyWriteMs: payload.replyWriteMs,
                consultationFailedFirstAttemptMs: payload.failedFirstAttemptMs,
                consultationServerTotalMs: payload.serverTotalMs,
                consultationUnattributedMs: payload.unattributedMs,
              }
            : undefined,
        );
      } else if (voiceTurn) {
        // Voice Reply is off -- the turn ends at the text reply, no TTS
        // stage will ever run.
        concludeVoiceTurn(marks, "consultation_succeeded_no_voice_reply", payload.providerLatencyMs, {
          providerAttemptCount: payload.providerAttemptCount,
        });
      }
    } catch {
      setSendError(describeSendFailure(0));
      if (voiceTurn) {
        concludeVoiceTurn(marks, "consultation_failed", undefined, { errorCode: "network_error" });
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(draft.trim());
  }

  // Reads exactly the reply text already shown in the bubble below --
  // never a second, separately-generated response. Never touches
  // proposedMemory/Confirm/Edit/Reject in any way: Voice Reply is purely
  // an optional way to hear this same content, not a new data flow.
  //
  // Provider order (requirement 4): cloud TTS first, local Web Speech as
  // fallback, text-only (already always true -- the reply text is on
  // screen regardless) as the last resort. Cloud failing for ANY reason
  // (network, rate-limited, unsupported language, provider error) falls
  // through to the exact same local path this component already had --
  // that path's own onVoiceUnavailable honesty guarantee is unchanged.
  function speakMessage(message: ConsultationMessageRecord, voiceLatency?: VoiceTurnLatencyContext) {
    // Voice reliability hardening: see voiceReplyAttemptRef's own doc
    // comment. Captured now so the async onSuccess/onFailure callbacks
    // below can tell, once their own network round-trip resolves, whether
    // THIS is still the most recent Voice Reply attempt -- a second
    // message arriving (or an explicit Stop) before this one's cloud TTS
    // response comes back must never start playing audio for a reply
    // that is no longer the active one.
    voiceReplyAttemptRef.current += 1;
    const myAttempt = voiceReplyAttemptRef.current;
    voiceReplyAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    voiceReplyAbortControllerRef.current = abortController;
    stopCloudAudio();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setVoiceGeneratingMessageId(null);
    setSpeakingMessageId(null);
    setVoiceError(null);
    setVoiceUnavailableNotice(null);

    // A concrete selector value always wins outright. Otherwise, prefer
    // message.replyLanguage -- the backend's own single canonical language
    // decision for this exact reply (see consultation-chat-service.ts,
    // itself preferring Gemini's own self-reported replyLanguageCode over
    // any local re-detection), computed once there and never re-guessed
    // here. Only when that is genuinely absent (e.g. an older cached
    // response) does this fall back to resolveReplyLanguage's own text
    // detection -- so the STT hint, the AI's reply, and the voice that
    // reads it are never three independent detectors that could disagree.
    const effectivePreference: LanguagePreference =
      languageSelection !== "auto" ? languageSelection : message.replyLanguage ?? "auto";
    const { language, conversationLanguage: nextConversationLanguage } = resolveReplyLanguage(
      message.content,
      effectivePreference,
      conversationLanguage,
    );
    setConversationLanguage(nextConversationLanguage);

    // Unconditional -- fires on EVERY Voice Reply attempt, before either
    // branch below runs. Diagnostic value: if this line is ever missing
    // from a live retest's console (filtered by tag VOICE_REPLY_CLIENT),
    // that is definitive proof the browser is running a bundle that
    // predates this file's current state entirely (a stale/failed
    // deployment), not a live bug in the branch logic itself -- settles
    // the question a prior retest could not, since only the OLDER local-
    // only logging (now "local_speak_requested") had appeared.
    const cloudSupported = isCloudTtsLanguageCode(language);
    logVoiceReplyClientEvent("speak_message_branch_decision", { language, cloudSupported });

    // Logs locally (browser console) AND reports server-side (see
    // voice-latency-logic.ts's own doc comment for why both are needed --
    // the console.log alone never reaches Railway).
    const concludeVoiceTurn = (
      finalMarks: VoiceLatencyMarks,
      outcome: VoiceLatencyTurnOutcome,
      // Round 7: the server's full breakdown, or null when TTS never
      // returned one at all (unsupported language, or a failure with no
      // successful response to read headers from) -- never fabricated.
      ttsTiming: CloudVoiceReplyServerTiming | null,
      errorCode?: string,
      providerAttemptCount?: number,
    ) => {
      if (!voiceLatency) return;
      const summary = computeVoiceLatencySummary(finalMarks, {
        sttProviderMs: voiceLatency.sttProviderMs ?? undefined,
        consultationProviderMs: voiceLatency.consultationProviderMs,
        consultationPreProviderMs: voiceLatency.consultationPreProviderMs,
        consultationReplyWriteMs: voiceLatency.consultationReplyWriteMs,
        consultationFailedFirstAttemptMs: voiceLatency.consultationFailedFirstAttemptMs,
        consultationServerTotalMs: voiceLatency.consultationServerTotalMs,
        consultationUnattributedMs: voiceLatency.consultationUnattributedMs,
        ttsProviderMs: ttsTiming?.ttsProviderMs ?? undefined,
        ttsPreProviderMs: ttsTiming?.preProviderMs ?? undefined,
        ttsUsageWriteMs: ttsTiming?.usageWriteMs ?? undefined,
        ttsAudioProcessingMs: ttsTiming?.audioProcessingMs ?? undefined,
        ttsServerTotalMs: ttsTiming?.serverTotalMs ?? undefined,
      });
      logVoiceLatencySummary(voiceLatency.attemptId, summary);
      reportVoiceLatencySummary(clientId, voiceLatency.attemptId, outcome, summary, { fetch: bindFetch(fetch) }, {
        errorCode,
        providerAttemptCount,
        elapsedSinceMicRequestMs: computeElapsedSinceMicRequestMs(finalMarks, performance.now()),
        // Round 8: only present when a real TTS response existed to
        // inspect (see CloudVoiceReplyServerTiming.responseHeaderNames) --
        // undefined for every non-TTS outcome, never fabricated.
        ttsResponseHeaders: ttsTiming?.responseHeaderNames,
        // Round 11: carried through from voiceLatency (see
        // VoiceTurnLatencyContext.sttModel) so the turn's FINAL summary --
        // tts_completed/tts_fallback_local/tts_failed, not just an
        // STT-only outcome -- still attributes to the STT model that ran.
        sttModel: voiceLatency.sttModel ?? undefined,
        ...vadDiagnosticsToReportFields(voiceLatency.vadDiagnostics ?? null),
      });
    };

    if (!cloudSupported) {
      speakMessageLocally(message, language, false);
      // No TTS provider is ever called for a language with no cloud
      // coverage -- the turn ends here with whatever stages were already
      // reached (STT, Consult AI), never a fabricated TTS mark.
      concludeVoiceTurn(voiceLatency?.marks ?? {}, "tts_unsupported_language", null);
      return;
    }

    setVoiceGeneratingMessageId(message.id);
    let ttsMarks: VoiceLatencyMarks = voiceLatency?.marks ?? {};
    if (voiceLatency) ttsMarks = markVoiceLatencyStage(ttsMarks, "tts_request_started", performance.now());
    void synthesizeCloudVoiceReply(
      clientId,
      message.content,
      toCloudTtsLanguageCode(language) as LanguageCode,
      // Regression: `{ fetch }` (object shorthand for `{ fetch: fetch }`)
      // stores fetch's bare function reference as a plain object's
      // property. A real browser's native fetch is a *branded* method --
      // calling it as `deps.fetch(...)` invokes it with `this === deps`
      // (plain method-call syntax always binds `this` to the object
      // before the dot), which throws "TypeError: Failed to execute
      // 'fetch' on 'Window': Illegal invocation" synchronously, before
      // any network request is ever made. Exactly the same root cause
      // teach-ai-panel-logic.ts's own bindFetch already exists to fix
      // (see its own regression note) -- reused here rather than
      // re-solving the same problem a second, differently-worded way.
      { fetch: bindFetch(fetch), signal: abortController.signal },
      {
        onSuccess: (audioBlob, ttsTiming) => {
          // Voice reliability hardening: a NEWER speakMessage call (a
          // second message sent, or handleStopSpeaking) already
          // superseded this one while its cloud TTS request was still in
          // flight -- acting on it now would start audio for a reply
          // that is no longer current, or resurrect audio after an
          // explicit Stop. A safe, logged no-op.
          if (voiceReplyAttemptRef.current !== myAttempt) {
            logVoiceReplyClientEvent("cloud_response_superseded", { stage: "success" });
            return;
          }
          setVoiceGeneratingMessageId((current) => (current === message.id ? null : current));
          logVoiceReplyClientEvent("cloud_audio_element_created", { audioBytes: audioBlob.size, blobType: audioBlob.type });
          if (voiceLatency) ttsMarks = markVoiceLatencyStage(ttsMarks, "tts_audio_received", performance.now());
          // Reuses the SAME element the toggle's own click already
          // unlocked (see getOrCreateCloudAudioElement/
          // unlockAudioPlayback) -- never `new Audio(...)` here, which
          // would be a fresh, un-unlocked element on iOS Safari.
          const audio = getOrCreateCloudAudioElement();
          audio.src = URL.createObjectURL(audioBlob);

          // Regression: audio.onerror (a genuine media decode/load
          // failure) and audio.play()'s own rejected promise are BOTH
          // legitimate signals for the very same underlying failure in
          // most browsers -- see callOnce's own doc comment
          // (consultation-chat-logic.ts) for the exact live symptom this
          // caused. callOnce guarantees the fallback fires exactly once
          // per attempt, regardless of which signal (or both) actually
          // fires -- generic for any language, not specific to this one
          // failure.
          const triggerLocalFallback = callOnce(() => {
            setSpeakingMessageId((current) => (current === message.id ? null : current));
            stopCloudAudio();
            speakMessageLocally(message, language, true);
            // Cloud audio never played -- the turn ends here (falling
            // back to the local Web Speech path, which has no provider
            // timing to report), with whatever real marks were reached.
            concludeVoiceTurn(ttsMarks, "tts_fallback_local", ttsTiming, "tts_playback_error", ttsTiming.providerAttemptCount ?? undefined);
          });

          // Playback-stage diagnostics (requirement: audio received ->
          // blob created -> decoder/load -> play requested -> playing ->
          // ended / playback error) -- safe fields only (byte counts,
          // durations, native error codes), never the conversation text.
          // audio.error.code is a native MediaError code (1=ABORTED,
          // 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED) -- exactly the
          // detail needed to tell a malformed/unsupported audio format
          // apart from an autoplay-policy rejection or a network hiccup,
          // which nothing before this logged at all.
          audio.onloadedmetadata = () => {
            logVoiceReplyClientEvent("cloud_loadedmetadata", { durationSeconds: audio.duration });
            if (voiceLatency) ttsMarks = markVoiceLatencyStage(ttsMarks, "audio_ready", performance.now());
          };
          audio.oncanplay = () => logVoiceReplyClientEvent("cloud_canplay");
          audio.onplay = () => {
            logVoiceReplyClientEvent("cloud_playing");
            setSpeakingMessageId(message.id);
            if (voiceLatency) ttsMarks = markVoiceLatencyStage(ttsMarks, "playback_started", performance.now());
          };
          audio.onended = () => {
            logVoiceReplyClientEvent("cloud_ended");
            setSpeakingMessageId((current) => (current === message.id ? null : current));
            stopCloudAudio();
            if (voiceLatency) {
              ttsMarks = markVoiceLatencyStage(ttsMarks, "playback_ended", performance.now());
              concludeVoiceTurn(ttsMarks, "tts_completed", ttsTiming, undefined, ttsTiming.providerAttemptCount ?? undefined);
            }
          };
          audio.onerror = () => {
            logVoiceReplyClientEvent("cloud_playback_error", {
              mediaErrorCode: audio.error?.code ?? null,
              mediaErrorMessage: audio.error?.message ?? null,
            });
            triggerLocalFallback();
          };

          logVoiceReplyClientEvent("cloud_play_requested");
          void audio.play().catch((error: unknown) => {
            logVoiceReplyClientEvent("cloud_play_rejected", {
              errorName: error instanceof Error ? error.name : "unknown",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            triggerLocalFallback();
          });
        },
        onFailure: (reason, ttsErrorCode, ttsProviderAttemptCount) => {
          // See the identical guard in onSuccess above.
          if (voiceReplyAttemptRef.current !== myAttempt) {
            logVoiceReplyClientEvent("cloud_response_superseded", { stage: "failure" });
            return;
          }
          setVoiceGeneratingMessageId((current) => (current === message.id ? null : current));
          speakMessageLocally(message, language, true);
          // The cloud request never produced audio at all -- no
          // tts_audio_received/audio_ready/playback marks, no
          // ttsProviderMs (no response to read one from). Prefers the
          // server's own specific error code (e.g. VOICE_REPLY_TIMEOUT,
          // already reflecting its own retry being exhausted) over
          // synthesizeCloudVoiceReply's coarse "network"/"unavailable"
          // classification -- undefined only for a genuine network-level
          // failure, where no server response body exists at all to read
          // a code from.
          concludeVoiceTurn(ttsMarks, "tts_failed", null, ttsErrorCode ?? reason, ttsProviderAttemptCount);
        },
      },
      voiceLatency?.attemptId,
    );
  }

  // The local Web Speech fallback -- reached either because this
  // language has no cloud TTS coverage at all (cloudAttempted=false --
  // registry-only today, since all 49 registry languages are
  // cloud-TTS-supported) or because cloud TTS was tried and failed
  // (cloudAttempted=true -- see synthesizeCloudVoiceReply's own
  // VOICE_REPLY_CLIENT logging for the specific reason). Requirement:
  // never let a fallback voice be mistaken for a correct one -- the
  // stylist is told explicitly which situation this is.
  function speakMessageLocally(message: ConsultationMessageRecord, language: LanguageCode, cloudAttempted: boolean) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    speakReply(
      message.content,
      languageToSpeechLocale(language),
      {
        synth: window.speechSynthesis as unknown as SpeechSynthesisLike,
        createUtterance: (text: string) => new SpeechSynthesisUtterance(text) as unknown as SpeechUtteranceLike,
      },
      {
        onStart: () => setSpeakingMessageId(message.id),
        onEnd: () => setSpeakingMessageId((current) => (current === message.id ? null : current)),
        onError: (errorMessage: string) => {
          setSpeakingMessageId((current) => (current === message.id ? null : current));
          setVoiceError(errorMessage);
        },
        // Generic for any registry language -- never hardcoded to a fixed
        // pair, so "No Arabic voice is installed..." reads exactly like
        // "No Romanian voice is installed..." would have. Explicitly
        // two-stage honest when cloud was attempted first (requirement:
        // never let a fallback voice be mistaken for a correct one).
        onVoiceUnavailable: () => {
          const label = getLanguageDefinition(language)?.label ?? language;
          setVoiceUnavailableNotice(
            cloudAttempted
              ? `The cloud voice service is unavailable right now, and no ${label} voice is installed on this device -- reading with the browser's default voice instead.`
              : `No ${label} voice is installed on this device -- reading with the browser's default voice instead.`,
          );
        },
      },
    );
  }

  function handleStopSpeaking() {
    // Voice reliability hardening: invalidates any cloud TTS attempt still
    // in flight (audio not yet playing -- the request is still generating)
    // so its eventual response can never resurrect audio after the
    // stylist explicitly said Stop. An attempt already playing is handled
    // by stopCloudAudio below, unchanged.
    voiceReplyAttemptRef.current += 1;
    voiceReplyAbortControllerRef.current?.abort();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      stopSpeaking(window.speechSynthesis as unknown as SpeechSynthesisLike);
    }
    stopCloudAudio();
    setVoiceGeneratingMessageId(null);
    setSpeakingMessageId(null);
  }

  // Turning Voice Reply ON is the one deliberate, synchronous user gesture
  // this feature has -- spent immediately here (see unlockAudioPlayback)
  // so a real reply's own, asynchronously-triggered playback is allowed
  // to start on iOS Safari later. The toggle must never report itself as
  // "On" if that unlock attempt failed: a stylist would otherwise believe
  // audio is coming and never learn why it never plays. Turning it back
  // OFF never needs an unlock and always succeeds immediately -- "revenire
  // oricând la Text Only" is not honored if a reply keeps talking after
  // the stylist just turned it off.
  async function handleToggleVoiceReply() {
    // Unconditional -- proves the click itself reached this handler at
    // all, before anything else runs. If a future live retest shows the
    // toggle stuck again with no matching line for this event, that
    // rules out the click handler entirely and points elsewhere (e.g.
    // the button itself, or an ancestor intercepting the event).
    logVoiceReplyClientEvent("toggle_clicked", {
      wasEnabled: voiceReplyEnabled,
      wasUnlocking: voiceReplyUnlocking,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });

    // Guards a genuinely possible race (a second click before the first
    // attempt's own state update lands) -- the button is also visually
    // disabled for this exact window (see the render below), so this is
    // belt-and-suspenders, not the only guard.
    if (voiceReplyUnlocking) {
      logVoiceReplyClientEvent("toggle_blocked", { reason: "unlock_already_in_progress" });
      return;
    }

    if (voiceReplyEnabled) {
      handleStopSpeaking();
      setVoiceReplyEnabled(false);
      logVoiceReplyClientEvent("state_reset", { reason: "user_turned_off" });
      return;
    }

    setVoiceError(null);
    setVoiceReplyUnlocking(true);
    const unlockSucceeded = await unlockAudioPlayback();
    setVoiceReplyUnlocking(false);

    const outcome = resolveVoiceReplyEnableOutcome(unlockSucceeded);
    setVoiceReplyEnabled(outcome.enabled);
    if (outcome.enabled) {
      logVoiceReplyClientEvent("state_set_active");
    } else {
      logVoiceReplyClientEvent("state_reset", { reason: "unlock_failed" });
      setVoiceError(outcome.message);
    }
  }

  function handleLanguageSelectionChange(next: LanguageSelection) {
    setLanguageSelection(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LANGUAGE_SELECTION_STORAGE_KEY, next);
    }
    if (next !== "auto") {
      // Best-effort cross-device sync of a concrete choice only -- "auto"
      // has no equivalent value in the account's Locale field, and this
      // must never block or fail the UI if the request doesn't succeed
      // (the localStorage write above already persisted it for this
      // browser regardless).
      void fetch("/api/v1/account/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => {});
    }
  }

  async function handleApplyCorrection(message: ConsultationMessageRecord) {
    if (!canApplyCorrection({
      hasAnalysisId: Boolean(analysisId),
      hasProposedCorrection: Boolean(message.proposedCorrection),
      applyingMessageId: applyingId,
    })) {
      return;
    }

    setApplyingId(message.id);
    setApplyErrors((prev) => {
      if (!(message.id in prev)) return prev;
      const next = { ...prev };
      delete next[message.id];
      return next;
    });
    try {
      const response = await fetch(`/api/v1/analysis/${analysisId}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message.proposedCorrection)
      });

      if (response.ok) {
        setAppliedCorrectionIds((prev) => new Set(prev).add(message.id));
        onCorrectionApplied?.();
        return;
      }

      // Regression: a live production report -- the request WAS sent and
      // WAS correctly rejected server-side (the AI had proposed a value
      // outside the field's real vocabulary; see
      // consultation-chat-provider-gemini.ts's own fix for the root
      // cause), but this branch previously did nothing at all, so the
      // Apply button just looked broken. Prefers the server's own
      // `message` (the most specific, e.g. exactly which value/field was
      // rejected and why) over the less specific `error` code, matching
      // describeApplyCorrectionFailure's own documented precedent
      // (sendError/memoryError/voiceError elsewhere in this file).
      const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
      setApplyErrors((prev) => ({
        ...prev,
        [message.id]: describeApplyCorrectionFailure(response.status, payload?.message ?? payload?.error),
      }));
    } catch {
      setApplyErrors((prev) => ({ ...prev, [message.id]: describeApplyCorrectionFailure(0, undefined) }));
    } finally {
      setApplyingId(null);
    }
  }

  function handleStartEditMemory(message: ConsultationMessageRecord) {
    if (!message.proposedMemory) return;
    setMemoryDrafts((prev) => ({ ...prev, [message.id]: prev[message.id] ?? message.proposedMemory!.content }));
    setEditingMemoryId(message.id);
  }

  async function handleRejectMemory(message: ConsultationMessageRecord) {
    if (!message.proposedMemory || rejectingMemoryId) {
      return;
    }

    setRejectingMemoryId(message.id);
    setMemoryError(null);
    try {
      const response = await fetch(`/api/v1/clients/${clientId}/chat/messages/${message.id}/reject-memory`, {
        method: "POST"
      });

      if (response.ok) {
        setRejectedMemoryIds((prev) => new Set(prev).add(message.id));
        setEditingMemoryId((current) => (current === message.id ? null : current));
      } else {
        setMemoryError("This proposal could not be dismissed. Please try again.");
      }
    } catch {
      setMemoryError("This proposal could not be dismissed. Please try again.");
    } finally {
      setRejectingMemoryId(null);
    }
  }

  async function handleConfirmMemory(message: ConsultationMessageRecord) {
    if (!message.proposedMemory || confirmingMemoryId) {
      return;
    }

    const content = (memoryDrafts[message.id] ?? message.proposedMemory.content).trim();
    if (!content) {
      return;
    }

    setConfirmingMemoryId(message.id);
    setMemoryError(null);
    try {
      const response = await fetch(`/api/v1/clients/${clientId}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: message.proposedMemory.action,
          content,
          confirmed: true,
          sourceMessageId: message.id
        })
      });

      if (response.ok) {
        setConfirmedMemoryIds((prev) => new Set(prev).add(message.id));
        setEditingMemoryId((current) => (current === message.id ? null : current));
      } else {
        setMemoryError("This memory could not be saved. Please try again.");
      }
    } catch {
      setMemoryError("This memory could not be saved. Please try again.");
    } finally {
      setConfirmingMemoryId(null);
    }
  }

  // A single combined status line for the whole voice conversation loop,
  // so the flow reads clearly (Listening... -> Processing... -> AI
  // responding... -> Speaking...) instead of several separate, silent
  // state transitions. Priority order matches the real sequence of
  // events; only one of these is ever true-ish at a time in practice.
  const voiceFlowStatus = chatRecording
    ? t("consultAi.listening")
    : chatProcessing
      ? t("consultAi.processing")
      : sending
        ? t("consultAi.aiResponding")
        : voiceGeneratingMessageId
          ? t("consultAi.generatingVoice")
          : speakingMessageId
            ? t("consultAi.speaking")
            : null;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Consult AI</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <LanguageCombobox
              languages={conversationSupportedLanguages()}
              value={languageSelection}
              onChange={(next) => handleLanguageSelectionChange(next as LanguageSelection)}
              ariaLabel={t("language.label")}
              searchPlaceholder={t("language.search")}
              noMatchesLabel={t("language.noMatches")}
              leadingOption={{ value: "auto", display: t("language.auto") }}
            />
          </div>
          {voiceReplyAvailable ? (
            <>
              {voiceGeneratingMessageId || speakingMessageId ? (
                <Button type="button" variant="ghost" onClick={handleStopSpeaking}>
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                  {t("consultAi.stop")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={handleToggleVoiceReply}
                disabled={voiceReplyUnlocking}
                loading={voiceReplyUnlocking}
              >
                {voiceReplyEnabled ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
                {t("consultAi.voiceReply")}: {voiceReplyEnabled ? t("common.on") : t("common.off")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {historyStatus === "loading" ? <LoadingState label="Loading conversation..." /> : null}

      {historyStatus === "error" ? (
        <Alert variant="error" title="Couldn't load the conversation">
          Please try refreshing the page.
        </Alert>
      ) : null}

      {historyStatus === "ready" ? (
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted">
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              <p>
                Ask about this client&apos;s hair, describe what you&apos;re seeing chair-side, or say what result
                you&apos;re aiming for.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <ChatBubble
                key={message.id}
                message={message}
                clientId={clientId}
                analysisId={analysisId}
                onNavigateToAnalyses={onNavigateToAnalyses}
                applied={appliedCorrectionIds.has(message.id)}
                applying={applyingId === message.id}
                applyError={applyErrors[message.id]}
                onApply={() => handleApplyCorrection(message)}
                memoryConfirmed={confirmedMemoryIds.has(message.id)}
                memoryRejected={rejectedMemoryIds.has(message.id)}
                memoryEditing={editingMemoryId === message.id}
                memoryDraft={memoryDrafts[message.id]}
                memoryConfirming={confirmingMemoryId === message.id}
                memoryRejecting={rejectingMemoryId === message.id}
                onEditMemory={() => handleStartEditMemory(message)}
                onDraftMemoryChange={(value) => setMemoryDrafts((prev) => ({ ...prev, [message.id]: value }))}
                onConfirmMemory={() => handleConfirmMemory(message)}
                onRejectMemory={() => handleRejectMemory(message)}
              />
            ))
          )}
          <div ref={scrollAnchorRef} />
        </div>
      ) : null}

      {sendError ? <Alert variant="error">{sendError}</Alert> : null}
      {memoryError ? <Alert variant="error">{memoryError}</Alert> : null}
      {voiceError ? <Alert variant="error">{voiceError}</Alert> : null}
      {voiceUnavailableNotice ? <Alert variant="warning">{voiceUnavailableNotice}</Alert> : null}
      {chatVoiceError ? <Alert variant="error">{chatVoiceError}</Alert> : null}
      {voiceFlowStatus ? <p className="text-xs text-muted">{voiceFlowStatus}</p> : null}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        {/* min-w-0: a flex item's default min-width is "auto" (its
            content's natural size), not 0 -- without it, the textarea
            could refuse to shrink below some browser-internal minimum on
            a narrow phone and push the mic/Send buttons partly off
            screen instead of the composer row fitting in the available
            width. */}
        <div className="min-w-0 flex-1">
          <Textarea
            dir="auto"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("consultAi.typeMessage")}
            rows={2}
            disabled={sending}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit(event);
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={toggleChatRecording}
          // Explicit, independently-tested guard (see isVoiceInputBusy's own
          // doc comment) against starting a second, overlapping recording
          // while the first one's transcript is still being generated or
          // its message is still being sent -- previously an implicit
          // side-effect of passing loading={chatProcessing} to a component
          // that happens to disable itself when loading.
          disabled={isVoiceInputBusy(sending, chatProcessing)}
          loading={chatProcessing}
          aria-label={chatRecording ? "Stop voice input" : "Voice input"}
        >
          {chatRecording ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <Button type="submit" loading={sending} disabled={!isSendableMessage(draft)}>
          <Send className="h-4 w-4" aria-hidden="true" />
          {t("consultAi.send")}
        </Button>
      </form>
      <TeachAiPanel clientId={clientId} />
    </Card>
  );
}

function ChatBubble({
  message,
  clientId,
  analysisId,
  onNavigateToAnalyses,
  applied,
  applying,
  applyError,
  onApply,
  memoryConfirmed,
  memoryRejected,
  memoryEditing,
  memoryDraft,
  memoryConfirming,
  memoryRejecting,
  onEditMemory,
  onDraftMemoryChange,
  onConfirmMemory,
  onRejectMemory
}: {
  message: ConsultationMessageRecord;
  clientId: string;
  analysisId: string | undefined;
  onNavigateToAnalyses: (() => void) | undefined;
  applied: boolean;
  applying: boolean;
  applyError: string | undefined;
  onApply: () => void;
  memoryConfirmed: boolean;
  memoryRejected: boolean;
  memoryEditing: boolean;
  memoryDraft: string | undefined;
  memoryConfirming: boolean;
  memoryRejecting: boolean;
  onEditMemory: () => void;
  onDraftMemoryChange: (value: string) => void;
  onConfirmMemory: () => void;
  onRejectMemory: () => void;
}) {
  const { t } = useUiLanguage();
  const isStylist = message.role === "stylist";

  return (
    <div className={`flex flex-col gap-1 ${isStylist ? "items-end" : "items-start"}`}>
      <div
        dir="auto"
        className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm ${
          isStylist ? "bg-accent text-background" : "bg-surface-alt text-foreground"
        }`}
      >
        {message.content}
      </div>
      <span className="px-1 text-xs text-muted">{formatMessageTime(message.createdAt)}</span>

      {message.proposedCorrection ? (
        <ProposedDirectionCard
          correction={message.proposedCorrection}
          clientId={clientId}
          hasAnalysisId={Boolean(analysisId)}
          onNavigateToAnalyses={onNavigateToAnalyses}
          applied={applied}
          applying={applying}
          applyError={applyError}
          onApply={onApply}
          t={t}
        />
      ) : null}

      {message.proposedMemory ? (
        <div className="mt-1 max-w-[85%] break-words rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">Proposed memory</Badge>
            <span className="text-xs text-muted">
              {MEMORY_ACTION_LABELS[message.proposedMemory.action] ?? message.proposedMemory.action}
            </span>
          </div>

          {memoryEditing ? (
            <Textarea
              dir="auto"
              className="mt-2"
              rows={2}
              value={memoryDraft ?? message.proposedMemory.content}
              onChange={(event) => onDraftMemoryChange(event.target.value)}
            />
          ) : (
            <p dir="auto" className="mt-2 text-sm text-foreground">
              {memoryDraft ?? message.proposedMemory.content}
            </p>
          )}
          <p className="mt-1 text-xs text-muted">{message.proposedMemory.reason}</p>

          {memoryConfirmed ? (
            <Badge variant="success" className="mt-2">
              Saved to professional memory
            </Badge>
          ) : memoryRejected ? (
            <Badge variant="neutral" className="mt-2">
              Dismissed -- not saved
            </Badge>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" loading={memoryConfirming} onClick={onConfirmMemory}>
                Confirm
              </Button>
              <Button type="button" variant="secondary" onClick={onEditMemory}>
                Edit
              </Button>
              <Button type="button" variant="ghost" loading={memoryRejecting} onClick={onRejectMemory}>
                Reject
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// AI Proposed Look Phase 1 ("AI Proposed Direction"): evolves the old
// "Proposed correction" card so a stylist can never confuse a still-
// pending professional suggestion with a change already saved to the
// client's plan -- what was proposed, why, and its exact status
// (Proposed vs Applied) are always visible together, never implied by a
// bare label. The underlying pipeline is unchanged and unweakened: this
// still only ever calls the existing, atomic
// POST /api/v1/analysis/{id}/correct (via onApply, passed straight
// through from handleApplyCorrection) -- see
// resolveProposedDirectionPresentation (consultation-chat-logic.ts) for
// the branching this renders.
//
// `value` is rendered humanized (e.g. "graduated_bob" -> "Graduated
// Bob") using the same humanizeEnumValue already used for every other
// M8 plan field (TechnicalCutPlanView etc.) -- never re-translated into
// the UI language, since the model is instructed to keep
// proposedCorrection.field/value in English regardless of reply
// language (consultation-chat-provider-gemini.ts's own SYSTEM_INSTRUCTION,
// rule 10) so applyAnalysisCorrection's enum validation stays reliable.
// `reason`, by contrast, is the model's own prose and is already in
// whatever language the conversation is in -- no humanizing needed or
// wanted there.
function ProposedDirectionCard({
  correction,
  clientId,
  hasAnalysisId,
  onNavigateToAnalyses,
  applied,
  applying,
  applyError,
  onApply,
  t,
}: {
  correction: ConsultationChatProposedCorrection;
  clientId: string;
  hasAnalysisId: boolean;
  onNavigateToAnalyses: (() => void) | undefined;
  applied: boolean;
  applying: boolean;
  applyError: string | undefined;
  onApply: () => void;
  t: (key: TranslationKey) => string;
}) {
  const presentation = resolveProposedDirectionPresentation({ hasAnalysisId, applied });

  return (
    <div className="mt-1 max-w-[85%] break-words rounded-xl border border-border bg-surface p-3">
      <Badge variant="warning">{t("consultAi.proposedDirection.badge")}</Badge>

      <p className="mt-2 text-xs font-medium text-muted">{t("consultAi.proposedDirection.directionLabel")}</p>
      <p className="text-sm font-medium text-foreground">{humanizeEnumValue(correction.value)}</p>

      <p className="mt-2 text-xs font-medium text-muted">{t("consultAi.proposedDirection.whyLabel")}</p>
      <p className="text-sm text-foreground">{correction.reason}</p>

      <p className="mt-2 text-xs text-muted">
        {presentation.status === "applied"
          ? t("consultAi.proposedDirection.statusApplied")
          : t("consultAi.proposedDirection.statusPending")}
      </p>

      {presentation.showApplyButton ? (
        <Button type="button" variant="secondary" className="mt-2" loading={applying} onClick={onApply}>
          {t("consultAi.proposedDirection.applyButton")}
        </Button>
      ) : null}

      {applyError ? (
        <Alert variant="error" className="mt-2">
          {applyError}
        </Alert>
      ) : null}

      {presentation.showNoAnalysisGuidance ? (
        <div className="mt-2 flex flex-col items-start gap-1">
          <p className="text-xs text-muted">{t("consultAi.proposedDirection.noAnalysisExplain")}</p>
          {resolveNoAnalysisGuidanceActionMode(Boolean(onNavigateToAnalyses)) === "switchTab" ? (
            // The general Consult AI tab this card renders on IS
            // /clients/{clientId} already (see ConsultationChatProps'
            // own comment on onNavigateToAnalyses) -- a real button that
            // switches the parent's local tab state, not a Link to the
            // page already on screen, which is exactly what silently did
            // nothing before this fix.
            <button
              type="button"
              onClick={onNavigateToAnalyses}
              className="text-xs text-accent hover:underline"
            >
              {t("consultAi.proposedDirection.noAnalysisLink")}
            </button>
          ) : (
            <Link href={`/clients/${clientId}`} className="text-xs text-accent hover:underline">
              {t("consultAi.proposedDirection.noAnalysisLink")}
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
