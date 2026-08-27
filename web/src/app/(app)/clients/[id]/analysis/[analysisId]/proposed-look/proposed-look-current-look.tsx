import { TechnicalCutPlanView } from "@/components/analysis";
import { Alert, Card } from "@/components/ui";
import type { ProposalRecord } from "@/lib/proposal-repository";

import { ProposalStatusBadge } from "./proposed-look-status-badge";

export interface CurrentApprovedLookProps {
  current: ProposalRecord;
  isStale: boolean;
}

// The read-only, authoritative view. Headed with the exact text "Current
// Approved Look" so it is never confused with a history row. Embeds the
// EXISTING TechnicalCutPlanView unchanged for the structural detail -- never
// a re-implementation.
//
// When `isStale` is true it shows one NEUTRAL info Alert -- never
// warning/error: nothing is wrong, there is simply newer analysis activity
// than what this confirmed look reflects. This component never claims which
// analysis is newer, never changes any lifecycle state, and never
// auto-creates anything.
export function CurrentApprovedLook({ current, isStale }: CurrentApprovedLookProps) {
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

      {isStale ? (
        <Alert variant="info">Newer analysis activity is available for this client. Review recommended.</Alert>
      ) : null}

      <TechnicalCutPlanView plan={current.payload} />
    </Card>
  );
}
