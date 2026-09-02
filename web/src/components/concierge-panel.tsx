"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Button, Card, Input } from "@/components/ui";
import { useUiLanguage } from "@/lib/ui-language-context";
import { resolveOrchestratorActionHref } from "@/lib/orchestrator-action-registry";
import type { OrchestratorClientCandidate } from "@/lib/orchestrator-contracts";
import {
  actionIdToTranslationKey,
  hasNoActionableRecommendation,
  isVideoOfferDecision,
  reasonCodeToTranslationKey,
  shouldClearComposerAfterSubmit,
} from "./concierge-logic";
import { ConciergeVoiceInput } from "./concierge-voice-input";
import { useConcierge, type UseConciergeContext } from "./use-concierge";

// AI Concierge / Orchestrator, Stage 1 -- the entry-point widget (task
// section 8: "concise Concierge entry... not a giant dashboard of engine
// buttons"). Renders the recommended next step as a single deterministic
// navigation link -- a human always clicks it; nothing here executes an
// engine call itself (see orchestrator-action-registry.ts).
export interface ConciergePanelProps {
  context?: UseConciergeContext;
}

export function ConciergePanel({ context }: ConciergePanelProps) {
  const { t, language } = useUiLanguage();
  const { state, ask, reset, activeClientId } = useConcierge(context);
  const [message, setMessage] = useState("");

  // Shared by both typed submit AND a voice transcript (see
  // handleVoiceTranscript below) -- the ONE place a raw string ever
  // becomes a real Concierge orchestration request, so "text and voice
  // converge into the exact same path" is true by construction, not by
  // convention. Production Fix #1 (input clearing): the composer always
  // resets immediately after a valid submit, independent of ask()'s own
  // async loading/ready/error transition.
  function submitMessage(rawMessage: string) {
    if (!shouldClearComposerAfterSubmit(rawMessage, state.status === "loading")) return;
    void ask(rawMessage);
    setMessage("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitMessage(message);
  }

  // Voice input integration: onTranscript already only ever fires once per
  // recording, with a real non-empty transcript (see
  // concierge-voice-input.tsx's own header comment) -- this briefly shows
  // the recognized text in the composer, exactly as a typed message would
  // look right before Send, so the professional can see what was heard
  // (task section 4), then submits it through the SAME submitMessage path
  // a typed Send already uses.
  function handleVoiceTranscript(transcript: string) {
    setMessage(transcript);
    submitMessage(transcript);
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
        <p className="font-medium text-foreground">{t("concierge.greeting")}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        {/* min-w-0: same mobile-safety precedent as consultation-chat.tsx's
            own composer row -- without it, a flex item's default min-width
            ("auto") can refuse to shrink below its content's natural size
            on a narrow phone and push the mic/Send buttons off screen. */}
        <div className="min-w-0 flex-1">
          <Input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t("concierge.placeholder")}
            disabled={state.status === "loading"}
            aria-label={t("concierge.placeholder")}
          />
        </div>
        {/* Mic + Send grouped together so mobile gets the input as its own
            full-width row, then this pair as a second row -- never three
            separately-stacked full-width controls. */}
        <div className="flex gap-2">
          <ConciergeVoiceInput activeClientId={activeClientId} language={language} t={t} loading={state.status === "loading"} onTranscript={handleVoiceTranscript} />
          <Button type="submit" loading={state.status === "loading"} disabled={!message.trim()}>
            {t("consultAi.send")}
          </Button>
        </div>
      </form>

      {state.status === "error" ? <p className="text-sm text-danger">{t("concierge.info.intentNotUnderstood")}</p> : null}

      {state.status === "ready" ? (
        <ConciergeDecisionView
          decisionKind={
            isVideoOfferDecision(state.decision)
              ? "videoOffer"
              : state.decision.ambiguousClientCandidates.length > 0
                ? "clientAmbiguous"
                : hasNoActionableRecommendation(state.decision)
                  ? "unsupported"
                  : "action"
          }
          reasonKey={reasonCodeToTranslationKey(state.decision.reasonCode)}
          actionLabel={state.decision.recommendedAction ? t(actionIdToTranslationKey(state.decision.recommendedAction)) : null}
          href={
            state.decision.recommendedAction
              ? resolveOrchestratorActionHref(state.decision.recommendedAction, {
                  clientId: state.decision.targetClientId,
                  analysisId: state.decision.targetAnalysisId,
                })
              : null
          }
          ambiguousClientCandidates={state.decision.ambiguousClientCandidates}
          onDecline={reset}
          t={t}
        />
      ) : null}
    </Card>
  );
}

interface ConciergeDecisionViewProps {
  decisionKind: "videoOffer" | "unsupported" | "clientAmbiguous" | "action";
  reasonKey: ReturnType<typeof reasonCodeToTranslationKey>;
  actionLabel: string | null;
  href: string | null;
  // Production Fix #1 (client name resolution): real, already owner-scoped
  // candidates (id + fullName) -- see OrchestratorClientCandidate's own
  // doc comment. Always [] outside the "clientAmbiguous" kind.
  ambiguousClientCandidates: OrchestratorClientCandidate[];
  onDecline: () => void;
  t: ReturnType<typeof useUiLanguage>["t"];
}

function ConciergeDecisionView({ decisionKind, reasonKey, actionLabel, href, ambiguousClientCandidates, onDecline, t }: ConciergeDecisionViewProps) {
  const reasonText = t(reasonKey);

  if (decisionKind === "clientAmbiguous") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-alt p-4">
        <p className="text-sm text-foreground">{reasonText}</p>
        <div className="flex flex-col gap-2">
          {ambiguousClientCandidates.map((candidate) => {
            // Real navigation only -- resolveOrchestratorActionHref returns
            // null unless OPEN_CLIENT's own declared requirements are met,
            // never a raw/unverified string (same guarantee every other
            // action link in this panel already relies on).
            const candidateHref = resolveOrchestratorActionHref("OPEN_CLIENT", { clientId: candidate.clientId, analysisId: null });
            if (!candidateHref) return null;
            return (
              <Link key={candidate.clientId} href={candidateHref}>
                <Button variant="secondary" className="w-full justify-start">
                  {candidate.fullName}
                </Button>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  if (decisionKind === "videoOffer") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-alt p-4">
        <p className="text-sm text-foreground">{reasonText}</p>
        <div className="flex gap-2">
          {href ? (
            <Link href={href}>
              <Button variant="primary">{t("concierge.videoOffer.yes")}</Button>
            </Link>
          ) : null}
          <Button variant="secondary" onClick={onDecline}>
            {t("concierge.videoOffer.no")}
          </Button>
        </div>
      </div>
    );
  }

  if (decisionKind === "unsupported") {
    return (
      <div className="rounded-xl border border-border bg-surface-alt p-4">
        <p className="text-sm text-muted">{reasonText}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-alt p-4">
      <p className="text-sm text-foreground">{reasonText}</p>
      {href && actionLabel ? (
        <Link href={href}>
          <Button variant="primary">{actionLabel}</Button>
        </Link>
      ) : null}
    </div>
  );
}
