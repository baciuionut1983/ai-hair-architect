import { CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";

import { resolveHistoryRowEffectiveMap } from "./technical-visual-map-logic";
import { TechnicalVisualMapStatusBadge } from "./technical-visual-map-status-badge";

export interface TechnicalVisualMapHistoryListProps {
  history: TechnicalVisualMapRecord[];
  currentConfirmedId: string | null;
}

function historyRowDate(item: TechnicalVisualMapRecord): string {
  const iso = item.confirmedAt ?? item.createdAt;
  return new Date(iso).toLocaleDateString();
}

// Technical Visual Map, Stage 4 -- one compact row per map version.
// `history` is already newest-mapVersion-first per listMapsForProposal's own
// ordering -- it is NOT re-sorted here. A SUPERSEDED row never looks active:
// its badge reads "Superseded" (technical-visual-map-status-badge.tsx) and it
// never carries the "Currently authoritative" marker.
//
// The "Currently authoritative" marker is driven ONLY by matching against
// `currentConfirmedId` (which the parent resolves from the Stage 3 CURRENT
// endpoint, never inferred from a row merely having status CONFIRMED) --
// mirrors ProposalHistoryList's own currentConfirmedId convention exactly.
export function TechnicalVisualMapHistoryList({ history, currentConfirmedId }: TechnicalVisualMapHistoryListProps) {
  if (history.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {history.map((item) => {
        const isAuthoritative = item.id === currentConfirmedId;
        // The effective map (baseline + any adjustments merged), never the
        // raw frozen payload alone -- see resolveHistoryRowEffectiveMap's own
        // doc comment.
        const effective = resolveHistoryRowEffectiveMap(item);
        return (
          <Card key={item.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <TechnicalVisualMapStatusBadge status={item.status} />
              <span className="text-xs text-muted">Version {item.mapVersion}</span>
              {isAuthoritative ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Currently authoritative
                </span>
              ) : null}
              <span className="text-xs text-muted">{historyRowDate(item)}</span>
            </div>
            <p className="text-sm text-foreground">
              {humanizeEnumValue(effective.globalIntent.structuralTechnique)}
              {" · "}
              {humanizeEnumValue(effective.globalIntent.cuttingTechnique)}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
