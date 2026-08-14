"use client";

import { MessageCircle, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Alert, Badge, Button, Card, LoadingState, Textarea } from "@/components/ui";
import type {
  ConsultationChatRequest,
  ConsultationChatResponse,
  ConsultationMessageRecord
} from "@/lib/contracts";

import { describeSendFailure, formatMessageTime, isSendableMessage, resolveConsultationHistoryLoadStatus } from "./consultation-chat-logic";
import { TeachAiPanel } from "./teach-ai-panel";

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
  // carried the proposal -- purely client-side until Confirm is clicked.
  // Reject never calls the API at all: the memory candidate simply never
  // gets persisted, which is already the fail-closed default.
  const [confirmedMemoryIds, setConfirmedMemoryIds] = useState<Set<string>>(new Set());
  const [rejectedMemoryIds, setRejectedMemoryIds] = useState<Set<string>>(new Set());
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [confirmingMemoryId, setConfirmingMemoryId] = useState<string | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

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
      const body: ConsultationChatRequest & { analysisId?: string } = { message: outgoing, ...(analysisId ? { analysisId } : {}) };
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
    } catch {
      setSendError(describeSendFailure(0));
    } finally {
      setSending(false);
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

  function handleRejectMemory(message: ConsultationMessageRecord) {
    setRejectedMemoryIds((prev) => new Set(prev).add(message.id));
    setEditingMemoryId((current) => (current === message.id ? null : current));
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
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Consult AI</h2>
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
              <Button type="button" variant="ghost" onClick={onRejectMemory}>
                Reject
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
