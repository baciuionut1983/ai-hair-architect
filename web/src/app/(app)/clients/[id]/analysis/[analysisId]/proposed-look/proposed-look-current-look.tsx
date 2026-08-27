import { TechnicalCutPlanView } from "@/components/analysis";
import { Alert, Card } from "@/components/ui";
import type { ProposalRecord } from "@/lib/proposal-repository";

import { buildEffectivePlan, hasAnyCuttingEdit } from "./proposed-look-logic";
import { ProposalStatusBadge } from "./proposed-look-status-badge";

export interface CurrentApprovedLookProps {
  current: ProposalRecord;
  isStale: boolean;
}

// The read-only, authoritative view. Headed with the exact text "Current
// Approved Look" so it is never confused with a history row.
//
// Renders the EFFECTIVE plan (buildEffectivePlan: baseline + any professional
// edits merged, display-only, never written back) through the EXISTING
// TechnicalCutPlanView, never a re-implementation of its rendering -- passing
// the raw frozen `current.payload` directly here would silently show the
// pre-edit AI/engine baseline as "what was approved" whenever the confirmed
// proposal was actually edited before confirming, which is wrong. When any
// field differs from baseline, a small badge makes that visible rather than
// hiding it -- the frozen baseline itself is never overwritten by this, only
// this read-only view's rendering choice.
//
// When `isStale` is true it shows one NEUTRAL info Alert -- never
// warning/error: nothing is wrong, there is simply newer analysis activity
// than what this confirmed look reflects. This component never claims which
// analysis is newer, never changes any lifecycle state, and never
// auto-creates anything.
export function CurrentApprovedLook({ current, isStale }: CurrentApprovedLookProps) {
  const edited = hasAnyCuttingEdit(current.payload, current.edits);
  const effectivePlan = buildEffectivePlan(current.payload, current.edits);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-foreground">Current Approved Look</h3>
        <ProposalStatusBadge status="CONFIRMED" />
        {current.confirmedAt ? (
          <span className="text-xs text-muted">
            Confirmed {new Date(current.confirmedAt).toLocaleDateString()}
          </span>
        ) : null}
      </div>

      {edited ? (
        <p className="text-xs text-muted">
          This plan includes professional edits made before confirming; the AI/engine baseline is preserved separately
          and was never overwritten.
        </p>
      ) : null}

      {isStale ? (
        <Alert variant="info">Newer analysis activity is available for this client. Review recommended.</Alert>
      ) : null}

      <TechnicalCutPlanView plan={effectivePlan} />
    </Card>
  );
}
