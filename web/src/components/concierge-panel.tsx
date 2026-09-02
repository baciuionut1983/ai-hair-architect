"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Button, Card, Input } from "@/components/ui";
import { useUiLanguage } from "@/lib/ui-language-context";
import { resolveOrchestratorActionHref } from "@/lib/orchestrator-action-registry";
import { actionIdToTranslationKey, hasNoActionableRecommendation, isVideoOfferDecision, reasonCodeToTranslationKey } from "./concierge-logic";
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
    if (!message.trim() || state.status === "loading") return;
    void ask(message);
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
          decisionKind={isVideoOfferDecision(state.decision) ? "videoOffer" : hasNoActionableRecommendation(state.decision) ? "unsupported" : "action"}
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
          onDecline={reset}
          t={t}
        />
      ) : null}
    </Card>
  );
}

interface ConciergeDecisionViewProps {
  decisionKind: "videoOffer" | "unsupported" | "action";
  reasonKey: ReturnType<typeof reasonCodeToTranslationKey>;
  actionLabel: string | null;
  href: string | null;
  onDecline: () => void;
  t: ReturnType<typeof useUiLanguage>["t"];
}

function ConciergeDecisionView({ decisionKind, reasonKey, actionLabel, href, onDecline, t }: ConciergeDecisionViewProps) {
  const reasonText = t(reasonKey);

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
