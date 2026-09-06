import { useState } from "react";

import { Alert, Button, Card } from "@/components/ui";
import type { TechnicalDemonstrationPlanRecord, TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import type { PlanReadinessResult } from "@/lib/technical-demonstration-cutting-video-readiness";

import { TechnicalDemonstrationCoherenceSummary } from "./technical-demonstration-coherence-summary";
import { TechnicalDemonstrationPlanStatusBadge } from "./technical-demonstration-plan-status-badge";
import { TechnicalDemonstrationStepCard } from "./technical-demonstration-step-card";
import type { TechnicalDemonstrationStepFieldEditSubmission } from "./technical-demonstration-step-field-editor";
import { TechnicalExecutionVideoReadinessSummary } from "./technical-execution-video-readiness-summary";
import type { TechnicalDemonstrationPlanActionOutcome } from "./use-technical-demonstration-plan";
import type { TechnicalDemonstrationCoherenceResult } from "./use-technical-demonstration-coherence";

export interface TechnicalDemonstrationPlanViewProps {
  plan: TechnicalDemonstrationPlanRecord;
  // The EFFECTIVE steps (baseline + professional overrides already
  // resolved server-side) -- the caller always passes effectiveSteps here,
  // never the raw baseline `steps`, so this component and everything below
  // it only ever renders what the professional actually sees/confirms.
  steps: TechnicalDemonstrationStepRecord[];
  // Present only for a DRAFT plan awaiting professional review -- a
  // CONFIRMED or SUPERSEDED plan is always rendered read-only, with no
  // confirm affordance at all.
  onConfirm?: () => Promise<TechnicalDemonstrationPlanActionOutcome>;
  confirmConflictMessage?: string | null;
  // Stage 2.5.b -- present ONLY for a DRAFT plan (mirrors onConfirm's own
  // "DRAFT only" gating exactly). Threaded straight down to every
  // TechnicalDemonstrationStepCard -- a CONFIRMED/SUPERSEDED plan's view
  // never receives this prop, so its own step cards stay structurally
  // read-only, not just by convention.
  onEditField?: (submission: TechnicalDemonstrationStepFieldEditSubmission & { stepNumber: number }) => Promise<boolean>;
  // Stage 2.5.c -- the server-computed Technical Execution Video readiness
  // for THIS exact `plan` (DRAFT readiness visibility fix: the caller,
  // technical-demonstration-plan-section.tsx, fetches it for whichever
  // plan -- draft or confirmed -- is actually being passed in here, via
  // resolveReadinessTargetPlan). `undefined` while still loading, or when
  // there is no plan to ask about at all -- this component simply renders
  // nothing in that case, never a fabricated placeholder. A DRAFT's own
  // result is always `ready: false` (server-enforced, never assumed
  // here) -- rendering it is exactly what lets a professional see the
  // exact gaps BEFORE confirming, instead of discovering them after.
  readiness?: PlanReadinessResult;
  // Stage 2.5.g.2 -- the server-computed Professional Coherence result for
  // THIS exact `plan`, VISIBILITY ONLY. Same "undefined while loading / no
  // plan to ask about" convention as `readiness` above, and always
  // resolved for the SAME target plan (the caller passes the identical
  // resolveReadinessTargetPlan result to both hooks) -- never a different,
  // stale plan's own coherence shown alongside this one's steps.
  coherence?: TechnicalDemonstrationCoherenceResult;
}

// Technical Demonstration, Stage 2 (+ Stage 2.5.b) -- the single plan view,
// used for BOTH a DRAFT awaiting review (with its own Confirm action AND,
// since Stage 2.5.b, per-field professional editing) and the CONFIRMED
// current plan (fully read-only). Deliberately ONE component rather than
// TechnicalVisualMap's own separate draft-editor/current-view split: the
// DRAFT and CONFIRMED views only ever differ by whether onConfirm/
// onEditField are supplied, so splitting them into two components would
// just duplicate the step list rendering for no real benefit.
export function TechnicalDemonstrationPlanView({ plan, steps, onConfirm, confirmConflictMessage, onEditField, readiness, coherence }: TechnicalDemonstrationPlanViewProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!onConfirm) return;
    setConfirming(true);
    setConfirmError(null);
    const outcome = await onConfirm();
    if (!outcome.ok) {
      setConfirmError(outcome.message);
    }
    setConfirming(false);
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-foreground">Technical Demonstration Plan</h3>
        <TechnicalDemonstrationPlanStatusBadge status={plan.status} />
        <span className="text-xs text-muted">Version {plan.planVersion}</span>
        {plan.confirmedAt ? <span className="text-xs text-muted">Confirmed {new Date(plan.confirmedAt).toLocaleDateString()}</span> : null}
      </div>

      <p className="text-xs text-muted">
        Ordered technical execution steps derived from the approved cutting plan above. Review each step before
        confirming -- confirmation is what a future demonstration video will be built from, never an unreviewed
        draft.
      </p>

      {steps.length > 0 ? (
        <div className="flex flex-col gap-3">
          {steps.map((step) => (
            <TechnicalDemonstrationStepCard key={step.id} step={step} onEditField={onEditField} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">This plan has no steps -- the approved cutting plan did not itemize any.</p>
      )}

      {onConfirm ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Button type="button" onClick={handleConfirm} loading={confirming}>
            Confirm Technical Plan
          </Button>
          {confirmConflictMessage ? <Alert variant="warning">{confirmConflictMessage}</Alert> : null}
          {confirmError ? <Alert variant="error">{confirmError}</Alert> : null}
        </div>
      ) : null}

      {readiness ? <TechnicalExecutionVideoReadinessSummary readiness={readiness} /> : null}

      {coherence ? <TechnicalDemonstrationCoherenceSummary coherence={coherence} /> : null}
    </Card>
  );
}
