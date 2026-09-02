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
  const { t } = useUiLanguage();
  const { state, ask, reset } = useConcierge(context);
  const [message, setMessage] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!shouldClearComposerAfterSubmit(message, state.status === "loading")) return;
    void ask(message);
    // Production Fix #1 (input clearing): the real production bug -- the
    // composer never reset after a send, so the previous message could
    // visually concatenate with the next one. Cleared here, immediately
    // (matching this app's other chat-style composers), independent of
    // ask()'s own async loading/ready/error transition above.
    setMessage("");
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
        <p className="font-medium text-foreground">{t("concierge.greeting")}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <Input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t("concierge.placeholder")}
            disabled={state.status === "loading"}
            aria-label={t("concierge.placeholder")}
          />
        </div>
        <Button type="submit" loading={state.status === "loading"} disabled={!message.trim()}>
          {t("consultAi.send")}
        </Button>
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
