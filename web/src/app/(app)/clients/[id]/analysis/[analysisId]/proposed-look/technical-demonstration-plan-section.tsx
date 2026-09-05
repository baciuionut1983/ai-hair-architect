"use client";

import { useState } from "react";

import { Alert, Button, ErrorState, LoadingState } from "@/components/ui";

import { resolveReadinessTargetPlan, shouldShowTechnicalDemonstrationConfirmConflictMessage } from "./technical-demonstration-plan-logic";
import { TechnicalDemonstrationPlanHistoryList } from "./technical-demonstration-plan-history";
import { TechnicalDemonstrationPlanView } from "./technical-demonstration-plan-view";
import type { TechnicalDemonstrationStepFieldEditSubmission } from "./technical-demonstration-step-field-editor";
import { useTechnicalDemonstrationPlan, type TechnicalDemonstrationPlanActionOutcome } from "./use-technical-demonstration-plan";
import { useTechnicalExecutionVideoReadiness } from "./use-technical-execution-video-readiness";

export interface TechnicalDemonstrationPlanSectionProps {
  clientId: string;
  // The CURRENT confirmed AnalysisProposal id -- the caller (proposed-look-
  // section.tsx) only ever renders this component when that proposal
  // exists. If the currently confirmed proposal later changes, the caller
  // passes a NEW proposalId (and a new `key`), and this component naturally
  // starts a fresh, unrelated scope -- an old plan derived from a
  // superseded proposal can never masquerade as current, because it is
  // simply never fetched once the scope changes (mirrors
  // TechnicalVisualMapSection's own identical guarantee).
  proposalId: string;
}

// Technical Demonstration, Stage 2 -- the top-level orchestrator, rendered
// immediately downstream of Proposed Look's own "Current Approved Look"
// (see proposed-look-section.tsx), ONLY when a CONFIRMED proposal exists.
// This is the ONLY component that calls useTechnicalDemonstrationPlan and
// owns all server-derived state and cross-action orchestration (confirm's
// expectedCurrentConfirmedPlanId, the 409-conflict message) -- every child
// below is controlled/presentational; none of them call fetch themselves.
//
// Deliberately NO video/image generation anywhere in this file or its
// children (Stage 2's own explicit boundary) -- this section only ever
// derives/reviews/confirms the technical PLAN. A future Stage 3 is what
// will ever call a provider.
export function TechnicalDemonstrationPlanSection({ clientId, proposalId }: TechnicalDemonstrationPlanSectionProps) {
  const { state, deriveOrOpen, confirmPlan, applyOverrides } = useTechnicalDemonstrationPlan(clientId, proposalId);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [confirmConflictMessage, setConfirmConflictMessage] = useState<string | null>(null);

  // Stage 2.5.c (DRAFT readiness visibility fix) -- called unconditionally
  // (Rules of Hooks: never after an early return). `readinessTargetPlan`
  // is the SAME plan TechnicalDemonstrationPlanView is about to render
  // below (draft takes priority over confirmed, see
  // resolveReadinessTargetPlan's own header comment) -- readiness must
  // always describe whatever plan is actually on screen, DRAFT included.
  // A DRAFT's own server-computed answer is always `ready: false` with a
  // READINESS_PLAN_NOT_CONFIRMED reason (the Stage 2.5.c core semantic
  // lock -- unchanged, enforced server-side, never by this component) --
  // but the professional can now see it, and every genuinely missing
  // field alongside it, instead of confirming blind. `null` only when
  // there is neither a draft nor a confirmed plan yet, in which case the
  // hook itself stays "idle" (see use-technical-execution-video-readiness.ts).
  const readinessTargetPlan = state.status === "ready" ? resolveReadinessTargetPlan(state.draft?.plan, state.current?.plan) : null;
  const readinessState = useTechnicalExecutionVideoReadiness(
    clientId,
    proposalId,
    readinessTargetPlan?.id ?? null,
    readinessTargetPlan?.updatedAt ?? null,
  );
  const readiness = readinessState.status === "ready" ? readinessState.readiness : undefined;

  if (state.status === "loading") {
    return <LoadingState label="Loading Technical Demonstration Plan..." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Couldn't load the Technical Demonstration Plan" description="Please try refreshing the page." />;
  }

  const { current, draft, history } = state;

  // Explicit action only -- never derived automatically on every page load
  // (Stage 2's own explicit "no unnecessary writes" requirement). Safe to
  // call more than once regardless: derivation is idempotent, so a repeat
  // click (or a slow double-click) reopens the SAME plan rather than
  // creating a duplicate.
  async function handleOpen() {
    setOpening(true);
    setOpenError(null);
    const outcome = await deriveOrOpen();
    if (!outcome.ok) {
      setOpenError(outcome.message);
    }
    setOpening(false);
  }

  async function handleConfirm(): Promise<TechnicalDemonstrationPlanActionOutcome> {
    if (!draft) throw new Error("handleConfirm called with no draft");
    setConfirmConflictMessage(null);
    const outcome = await confirmPlan(draft.plan.id, current?.plan.id ?? null);
    const conflictMessage = shouldShowTechnicalDemonstrationConfirmConflictMessage(outcome);
    if (conflictMessage) {
      setConfirmConflictMessage(conflictMessage);
    }
    return outcome;
  }

  // Stage 2.5.b -- applies ONE professional override at a time (the field
  // editor's own "Save"/"Mark not applicable"/"Reset" actions each submit
  // independently, never batched) to the CURRENT draft. Only ever reachable
  // while `draft` exists -- TechnicalDemonstrationPlanView only receives
  // this callback on the draft branch below, never the confirmed one.
  async function handleEditField(submission: TechnicalDemonstrationStepFieldEditSubmission & { stepNumber: number }): Promise<boolean> {
    if (!draft) return false;
    const outcome = await applyOverrides(draft.plan.id, [submission]);
    return outcome.ok;
  }

  return (
    <div id="technical-demonstration-plan-section" className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Technical Demonstration Plan</h2>
        <p className="text-xs text-muted">
          The step-by-step technical execution behind the approved cutting plan -- sectioning, guide, elevation,
          tools, and more -- ready for your review before it becomes the basis for a future demonstration video.
        </p>
      </div>

      {draft ? (
        <TechnicalDemonstrationPlanView
          key={draft.plan.id}
          plan={draft.plan}
          steps={draft.effectiveSteps}
          onConfirm={handleConfirm}
          confirmConflictMessage={confirmConflictMessage}
          onEditField={handleEditField}
          readiness={readiness}
        />
      ) : current ? (
        <TechnicalDemonstrationPlanView key={current.plan.id} plan={current.plan} steps={current.effectiveSteps} readiness={readiness} />
      ) : (
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={handleOpen} loading={opening}>
            Open Technical Demonstration Plan
          </Button>
          {openError ? <Alert variant="error">{openError}</Alert> : null}
        </div>
      )}

      {history.length > 1 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Plan history</h3>
          <TechnicalDemonstrationPlanHistoryList history={history} currentConfirmedId={current?.plan.id ?? null} />
        </div>
      ) : null}
    </div>
  );
}
