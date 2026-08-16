"use client";

import { MessageCircle, Mic, Send, Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Alert, Badge, Button, Card, LanguageCombobox, LoadingState, Textarea } from "@/components/ui";
import type {
  ConsultationChatRequest,
  ConsultationChatResponse,
  ConsultationMessageRecord
} from "@/lib/contracts";
import { conversationSupportedLanguages, getLanguageDefinition, isCloudTtsLanguageCode, toCloudTtsLanguageCode, type LanguageCode } from "@/lib/language-registry";
import { useUiLanguage } from "@/lib/ui-language-context";

import { synthesizeCloudVoiceReply } from "./consultation-chat-cloud-tts-logic";
import {
  buildChatLanguageFields,
  describeSendFailure,
  extractMemoryDecisionIds,
  formatMessageTime,
  isSendableMessage,
  LANGUAGE_SELECTION_STORAGE_KEY,
  parseStoredLanguageSelection,
  resolveConsultationHistoryLoadStatus,
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
import { useVoiceRecording } from "./use-voice-recording";

export interface ConsultationChatProps {
  clientId: string;
  analysisId?: string;
  // Called after a proposed correction is successfully applied, so the
  // parent (e.g. the analysis result page) can refetch and show the
  // recomputed plan. Applying a correction always goes through the real
  // POST /api/v1/analysis/{id}/correct endpoint -- this component never
  // mutates analysis data itself.
  onCorrectionApplied?: () => void;
}

type HistoryStatus = "loading" | "ready" | "error";

const MEMORY_ACTION_LABELS: Record<string, string> = {
  save_client_memory: "Save to client memory",
  save_professional_rule: "Save as professional rule",
  mark_preference: "Save as preference",
  save_outcome: "Save as outcome"
};

export function ConsultationChat({ clientId, analysisId, onCorrectionApplied }: ConsultationChatProps) {
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
  // The single cloud-TTS <audio> element in flight, if any -- created lazily
  // per reply (see speakMessage below), never more than one at a time
  // (stopCloudAudio always tears down the previous one first, matching
  // "un nou reply trebuie să oprească audio-ul anterior" for cloud audio
  // exactly the way deps.synth.cancel() already does for Web Speech).
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null);

  const sttLanguageHint = resolveSttLanguageHint(languageSelection, conversationLanguage);
  const {
    recording: chatRecording,
    processing: chatProcessing,
    error: chatVoiceError,
    toggleRecording: toggleChatRecording,
  } = useVoiceRecording({
    clientId,
    language: sttLanguageHint,
    // Natural-conversation flow: speaking and pausing (or a manual Stop)
    // sends immediately, exactly like a typed Send -- no separate review
    // step. Still structurally isolated from Teach the AI: this hook has
    // no knowledge of its draft/transcriptId state at all, so a
    // chat-composer voice note can never reach it or trigger a memory
    // proposal.
    onTranscript: (transcript) => {
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
    cloudAudioRef.current = null;
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
      const body: ConsultationChatRequest & { analysisId?: string; languagePreference?: LanguageCode; conversationLanguage?: LanguageCode } = {
        message: outgoing,
        ...(analysisId ? { analysisId } : {}),
        ...buildChatLanguageFields(languageSelection, conversationLanguage),
      };
      const response = await fetch(`/api/v1/clients/${clientId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        setSendError(describeSendFailure(response.status));
        return;
      }

      const payload = (await response.json()) as ConsultationChatResponse;
      setMessages((prev) => [...prev, payload.reply]);
      if (voiceReplyEnabled) {
        speakMessage(payload.reply);
      }
    } catch {
      setSendError(describeSendFailure(0));
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
  function speakMessage(message: ConsultationMessageRecord) {
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

    if (!isCloudTtsLanguageCode(language)) {
      speakMessageLocally(message, language);
      return;
    }

    setVoiceGeneratingMessageId(message.id);
    void synthesizeCloudVoiceReply(
      clientId,
      message.content,
      toCloudTtsLanguageCode(language) as LanguageCode,
      { fetch },
      {
        onSuccess: (audioBlob) => {
          setVoiceGeneratingMessageId((current) => (current === message.id ? null : current));
          const audio = new Audio(URL.createObjectURL(audioBlob));
          cloudAudioRef.current = audio;
          audio.onplay = () => setSpeakingMessageId(message.id);
          audio.onended = () => {
            setSpeakingMessageId((current) => (current === message.id ? null : current));
            stopCloudAudio();
          };
          audio.onerror = () => {
            setSpeakingMessageId((current) => (current === message.id ? null : current));
            stopCloudAudio();
            speakMessageLocally(message, language);
          };
          void audio.play().catch(() => {
            setSpeakingMessageId((current) => (current === message.id ? null : current));
            stopCloudAudio();
            speakMessageLocally(message, language);
          });
        },
        onFailure: () => {
          setVoiceGeneratingMessageId((current) => (current === message.id ? null : current));
          speakMessageLocally(message, language);
        },
      },
    );
  }

  // The local Web Speech fallback -- unchanged from before cloud TTS
  // existed, still the same honest "No {label} voice is installed..."
  // guarantee, now reached only when cloud TTS is unsupported/unavailable
  // for this reply rather than being the primary path.
  function speakMessageLocally(message: ConsultationMessageRecord, language: LanguageCode) {
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
        // "No Romanian voice is installed..." would have.
        onVoiceUnavailable: () => {
          const label = getLanguageDefinition(language)?.label ?? language;
          setVoiceUnavailableNotice(
            `No ${label} voice is installed on this device -- reading with the browser's default voice instead.`,
          );
        },
      },
    );
  }

  function handleStopSpeaking() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      stopSpeaking(window.speechSynthesis as unknown as SpeechSynthesisLike);
    }
    stopCloudAudio();
    setVoiceGeneratingMessageId(null);
    setSpeakingMessageId(null);
  }

  function handleToggleVoiceReply() {
    setVoiceReplyEnabled((current) => {
      const next = !current;
      // Turning Voice Reply off must silence it immediately -- "revenire
      // oricând la Text Only" is not honored if a reply keeps talking
      // after the stylist just turned it off.
      if (!next) {
        handleStopSpeaking();
      }
      return next;
    });
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
    if (!analysisId || !message.proposedCorrection || applyingId) {
      return;
    }

    setApplyingId(message.id);
    try {
      const response = await fetch(`/api/v1/analysis/${analysisId}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message.proposedCorrection)
      });

      if (response.ok) {
        setAppliedCorrectionIds((prev) => new Set(prev).add(message.id));
        onCorrectionApplied?.();
      }
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
              <Button type="button" variant="secondary" onClick={handleToggleVoiceReply}>
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
                analysisId={analysisId}
                applied={appliedCorrectionIds.has(message.id)}
                applying={applyingId === message.id}
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
        <div className="flex-1">
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
          disabled={sending}
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
  analysisId,
  applied,
  applying,
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
  analysisId: string | undefined;
  applied: boolean;
  applying: boolean;
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
        <div className="mt-1 max-w-[85%] rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">Proposed correction</Badge>
            <span className="text-xs text-muted">not applied yet</span>
          </div>
          <p className="mt-2 text-sm text-foreground">
            <span className="font-medium">{message.proposedCorrection.field}</span> &rarr; {message.proposedCorrection.value}
          </p>
          <p className="mt-1 text-xs text-muted">{message.proposedCorrection.reason}</p>
          {analysisId ? (
            applied ? (
              <Badge variant="success" className="mt-2">
                Applied
              </Badge>
            ) : (
              <Button type="button" variant="secondary" className="mt-2" loading={applying} onClick={onApply}>
                Apply this correction
              </Button>
            )
          ) : (
            <p className="mt-2 text-xs text-muted">
              Start this conversation from a specific analysis to apply this correction directly.
            </p>
          )}
        </div>
      ) : null}

      {message.proposedMemory ? (
        <div className="mt-1 max-w-[85%] rounded-xl border border-border bg-surface p-3">
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
