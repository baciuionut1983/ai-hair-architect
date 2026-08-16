"use client";

import { MessageCircle, Mic, Send, Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Alert, Badge, Button, Card, LoadingState, Select, Textarea } from "@/components/ui";
import type {
  ConsultationChatRequest,
  ConsultationChatResponse,
  ConsultationMessageRecord
} from "@/lib/contracts";

import {
  buildChatLanguageFields,
  describeSendFailure,
  extractMemoryDecisionIds,
  formatMessageTime,
  isSendableMessage,
  LANGUAGE_SELECTION_STORAGE_KEY,
  languageSelectionToSpeechLocale,
  parseStoredLanguageSelection,
  resolveConsultationHistoryLoadStatus,
  resolveSttLanguageHint,
  type LanguageSelection
} from "./consultation-chat-logic";
import {
  isSpeechSynthesisSupported,
  resolveReplySpeechLocale,
  speakReply,
  stopSpeaking,
  type SpeechLocale,
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
  // reply aloud via the browser's native speech synthesis -- never a
  // second, separately-generated response (speakReply only ever reads
  // `content`, the exact text already rendered below). speechSupported
  // starts false and is only set after mount (never read during SSR) to
  // avoid a hydration mismatch; a browser without the Web Speech API just
  // never shows the toggle, degrading honestly to text-only.
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // The conversation's own "Language" selector (Auto/English/Romanian) --
  // distinct from the account/UI locale on purpose (see
  // consultation-chat-service.ts's ConsultationChatLanguageHint): a
  // concrete choice here is a hard override for this conversation only,
  // never something the app-wide UI language forces onto it. Starts "auto"
  // (matching SSR) and is hydrated from localStorage after mount, same
  // hydration-safe pattern as speechSupported above.
  const [languageSelection, setLanguageSelection] = useState<LanguageSelection>("auto");
  // The conversation's own currently-established spoken language, updated
  // whenever an AI reply is confidently detected (see resolveReplySpeechLocale)
  // -- used only as a soft fallback (STT hint, ambiguous-reply TTS/reply
  // language), never a forced value.
  const [conversationLocale, setConversationLocale] = useState<SpeechLocale | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const sttLanguageHint = resolveSttLanguageHint(languageSelection, conversationLocale);
  const { recording: chatRecording, status: chatVoiceStatus, toggleRecording: toggleChatRecording } = useVoiceRecording({
    clientId,
    language: sttLanguageHint,
    // Populates ONLY the normal chat composer's own draft -- this hook has
    // no knowledge of Teach the AI's state at all, so a chat-composer voice
    // note can structurally never reach it or trigger a memory proposal.
    onTranscript: (transcript) => setDraft(transcript),
  });

  useEffect(() => {
    // Unavoidable: whether the Web Speech API exists is only knowable
    // client-side, and must be synced into state after mount (starting at
    // false, matching what SSR renders) to avoid a hydration mismatch --
    // the same pattern already used elsewhere in this codebase (see
    // milestone2-analysis-panel.tsx) for the same class of browser-only
    // capability check.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeechSupported(isSpeechSynthesisSupported(typeof window === "undefined" ? undefined : window));
    // Same hydration-safe reasoning as speechSupported above -- the stored
    // selection is only knowable client-side.
    if (typeof window !== "undefined") {
      setLanguageSelection(parseStoredLanguageSelection(window.localStorage.getItem(LANGUAGE_SELECTION_STORAGE_KEY)));
    }
    // Cleanup: never leave the browser still reading a reply aloud after
    // this component unmounts (e.g. navigating away mid-speech).
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        stopSpeaking(window.speechSynthesis as unknown as SpeechSynthesisLike);
      }
    };
  }, []);

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isSendableMessage(draft) || sending) {
      return;
    }

    const outgoing = draft.trim();
    const optimistic: ConsultationMessageRecord = {
      // Pre-existing, unrelated to Voice Reply: safe here because this
      // runs only inside a user-triggered event handler, never during
      // render -- the "purity" rule can't distinguish the two.
      // eslint-disable-next-line react-hooks/purity
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
      const body: ConsultationChatRequest & { analysisId?: string; languagePreference?: "en" | "ro"; conversationLanguage?: "en" | "ro" } = {
        message: outgoing,
        ...(analysisId ? { analysisId } : {}),
        ...buildChatLanguageFields(languageSelection, conversationLocale),
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

  // Reads exactly the reply text already shown in the bubble below --
  // never a second, separately-generated response. Never touches
  // proposedMemory/Confirm/Edit/Reject in any way: Voice Reply is purely
  // an optional way to hear this same content, not a new data flow.
  function speakMessage(message: ConsultationMessageRecord) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    setVoiceError(null);
    // Regression: a live test showed a Romanian reply pronounced in
    // English -- resolveReplySpeechLocale applies the same
    // selector-override-first, then-detection, then-established-locale,
    // then-safe-default priority chain used for the AI's own reply
    // language on the backend (see SYSTEM_INSTRUCTION rule 10), so TTS and
    // the reply text can never disagree about which language is "current."
    const { locale, conversationLocale: nextConversationLocale } = resolveReplySpeechLocale(
      message.content,
      languageSelection === "auto" ? "auto" : languageSelectionToSpeechLocale(languageSelection),
      conversationLocale,
    );
    setConversationLocale(nextConversationLocale);
    speakReply(
      message.content,
      locale,
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
      },
    );
  }

  function handleStopSpeaking() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      stopSpeaking(window.speechSynthesis as unknown as SpeechSynthesisLike);
    }
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

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Consult AI</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Select
              aria-label="Language"
              value={languageSelection}
              onChange={(event) => handleLanguageSelectionChange(event.target.value as LanguageSelection)}
            >
              <option value="auto">Language: Auto</option>
              <option value="en">Language: English</option>
              <option value="ro">Language: Romanian</option>
            </Select>
          </div>
          {speechSupported ? (
            <>
              {speakingMessageId ? (
                <Button type="button" variant="ghost" onClick={handleStopSpeaking}>
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                  Stop
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={handleToggleVoiceReply}>
                {voiceReplyEnabled ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
                Voice Reply: {voiceReplyEnabled ? "On" : "Off"}
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
      {chatVoiceStatus ? <p className="text-xs text-muted">{chatVoiceStatus}</p> : null}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message..."
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
          aria-label={chatRecording ? "Stop voice input" : "Voice input"}
        >
          {chatRecording ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <Button type="submit" loading={sending} disabled={!isSendableMessage(draft)}>
          <Send className="h-4 w-4" aria-hidden="true" />
          Send
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
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
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
              className="mt-2"
              rows={2}
              value={memoryDraft ?? message.proposedMemory.content}
              onChange={(event) => onDraftMemoryChange(event.target.value)}
            />
          ) : (
            <p className="mt-2 text-sm text-foreground">{memoryDraft ?? message.proposedMemory.content}</p>
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
