import { CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { ProposalRecord } from "@/lib/proposal-repository";

import { ProposalStatusBadge } from "./proposed-look-status-badge";

export interface ProposalHistoryListProps {
  history: ProposalRecord[];
  currentConfirmedId: string | null;
}

function historyRowDate(item: ProposalRecord): string {
  const iso = item.confirmedAt ?? item.rejectedAt ?? item.createdAt;
  return new Date(iso).toLocaleDateString();
}

// One compact row per proposal. `history` is already newest-first per
// listProposalsForOwner's own ordering -- it is NOT re-sorted here.
//
// The "Currently authoritative" marker is driven ONLY by matching against
// `currentConfirmedId` (which the parent resolves from the server's
// current-confirmed endpoint, never inferred from a row merely having status
// CONFIRMED). A CONFIRMED row that is not the live current-confirmed one can
// only appear in a razor-thin race window between two fetches; this marker
// stays correct in that window because it never trusts the status alone.
export function ProposalHistoryList({ history, currentConfirmedId }: ProposalHistoryListProps) {
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
              <ProposalStatusBadge status={item.status} />
              {isAuthoritative ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Currently authoritative
                </span>
              ) : null}
              <span className="text-xs text-muted">{historyRowDate(item)}</span>
            </div>
            <p className="text-sm text-foreground">
              {humanizeEnumValue(item.payload.structuralTechnique)}
              {" · "}
              {humanizeEnumValue(item.payload.cuttingTechnique)}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
