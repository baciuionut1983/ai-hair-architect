import { CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui";
import type { TechnicalDemonstrationPlanRecord } from "@/lib/technical-demonstration-contracts";

import { TechnicalDemonstrationPlanStatusBadge } from "./technical-demonstration-plan-status-badge";

export interface TechnicalDemonstrationPlanHistoryListProps {
  history: TechnicalDemonstrationPlanRecord[];
  currentConfirmedId: string | null;
}

function historyRowDate(item: TechnicalDemonstrationPlanRecord): string {
  const iso = item.confirmedAt ?? item.createdAt;
  return new Date(iso).toLocaleDateString();
}

// Technical Demonstration, Stage 2 -- one compact row per plan version.
// `history` is already newest-planVersion-first per
// listTechnicalDemonstrationPlansForProposal's own ordering -- it is NOT
// re-sorted here. Mirrors TechnicalVisualMapHistoryList exactly: a
// SUPERSEDED row never looks active (its badge reads "Superseded" and it
// never carries the "Currently authoritative" marker), driven ONLY by
// matching against `currentConfirmedId` (resolved by the parent from the
// Stage 2 CURRENT endpoint, never inferred from a row merely having status
// CONFIRMED).
export function TechnicalDemonstrationPlanHistoryList({ history, currentConfirmedId }: TechnicalDemonstrationPlanHistoryListProps) {
  if (history.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {history.map((item) => {
        const isAuthoritative = item.id === currentConfirmedId;
        return (
          <Card key={item.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <TechnicalDemonstrationPlanStatusBadge status={item.status} />
              <span className="text-xs text-muted">Version {item.planVersion}</span>
              {isAuthoritative ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Currently authoritative
                </span>
              ) : null}
              <span className="text-xs text-muted">{historyRowDate(item)}</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
