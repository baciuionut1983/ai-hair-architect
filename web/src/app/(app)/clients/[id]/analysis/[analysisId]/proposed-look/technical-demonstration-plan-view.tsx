import { useState } from "react";

import { Alert, Button, Card } from "@/components/ui";
import type { TechnicalDemonstrationPlanRecord, TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";

import { TechnicalDemonstrationPlanStatusBadge } from "./technical-demonstration-plan-status-badge";
import { TechnicalDemonstrationStepCard } from "./technical-demonstration-step-card";
import type { TechnicalDemonstrationPlanActionOutcome } from "./use-technical-demonstration-plan";

export interface TechnicalDemonstrationPlanViewProps {
  plan: TechnicalDemonstrationPlanRecord;
  steps: TechnicalDemonstrationStepRecord[];
  // Present only for a DRAFT plan awaiting professional review -- a
  // CONFIRMED or SUPERSEDED plan is always rendered read-only, with no
  // confirm affordance at all (Stage 2's own explicit "review + confirm
  // only" boundary -- no step-level editing anywhere in this component).
  onConfirm?: () => Promise<TechnicalDemonstrationPlanActionOutcome>;
  confirmConflictMessage?: string | null;
}

// Technical Demonstration, Stage 2 -- the single read-only plan view, used
// for BOTH a DRAFT awaiting review (with its own Confirm action) and the
// CONFIRMED current plan (fully read-only). Deliberately ONE component
// rather than TechnicalVisualMap's own separate draft-editor/current-view
// split: unlike a map, a Technical Demonstration Plan has no in-place
// professional adjustment mechanism at all in Stage 2 (Decision Lock: step-
// level editing would introduce a second, competing authority alongside
// AnalysisProposal.edits -- see this Stage's own report) -- the DRAFT and
// CONFIRMED views only ever differ by whether a Confirm button is shown, so
// splitting them into two components would just duplicate the step list
// rendering for no real benefit.
export function TechnicalDemonstrationPlanView({ plan, steps, onConfirm, confirmConflictMessage }: TechnicalDemonstrationPlanViewProps) {
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
            <TechnicalDemonstrationStepCard key={step.id} step={step} />
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
    </Card>
  );
}
