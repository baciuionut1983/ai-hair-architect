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

export function ConsultationChat({ clientId, analysisId, onCorrectionApplied }: ConsultationChatProps) {
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("loading");
  const [messages, setMessages] = useState<ConsultationMessageRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [appliedCorrectionIds, setAppliedCorrectionIds] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);
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
              />
            ))
          )}
          <div ref={scrollAnchorRef} />
        </div>
      ) : null}

      {sendError ? <Alert variant="error">{sendError}</Alert> : null}

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
    </Card>
  );
}

function ChatBubble({
  message,
  analysisId,
  applied,
  applying,
  onApply
}: {
  message: ConsultationMessageRecord;
  analysisId: string | undefined;
  applied: boolean;
  applying: boolean;
  onApply: () => void;
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
    </div>
  );
}
