import { CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui";
import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";

import { VIEW_LABEL_DISPLAY } from "./spatial-binding-logic";
import { SpatialBindingStatusBadge } from "./spatial-binding-status-badge";

export interface SpatialBindingHistoryListProps {
  history: TechnicalVisualMapSpatialBindingRecord[];
  currentConfirmedId: string | null;
}

function summarizePlacement(binding: TechnicalVisualMapSpatialBindingRecord): string {
  const placed = binding.payload.zones.filter((zone) => zone.state === "placed").length;
  const perimeter = binding.payload.perimeter.state === "placed" ? "perimeter placed" : "perimeter not placed";
  return `${placed}/6 zones placed · ${perimeter}`;
}

// Technical Visual Map, Stage 5C -- one compact row per spatial binding
// version, across every source image and view for this map (matching the
// Stage 5B list endpoint's own map-wide scope). `history` is already
// newest-created-first -- it is NOT re-sorted here. A SUPERSEDED row never
// looks active. The "Currently authoritative" marker is driven ONLY by
// matching against `currentConfirmedId` (resolved from the Stage 5B current
// endpoint for the CURRENTLY SELECTED image+view -- a row for a different
// image/view is never marked current here, since it cannot be the
// professional's active selection's own authority).
export function SpatialBindingHistoryList({ history, currentConfirmedId }: SpatialBindingHistoryListProps) {
  if (history.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {history.map((binding) => {
        const isAuthoritative = binding.id === currentConfirmedId;
        return (
          <Card key={binding.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <SpatialBindingStatusBadge status={binding.status} />
              <span className="text-xs text-muted">Version {binding.spatialVersion}</span>
              <span className="text-xs text-muted">
                {VIEW_LABEL_DISPLAY[binding.viewLabel as keyof typeof VIEW_LABEL_DISPLAY] ?? binding.viewLabel}
              </span>
              {isAuthoritative ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Currently authoritative
                </span>
              ) : null}
            </div>
            <p className="text-sm text-foreground">{summarizePlacement(binding)}</p>
          </Card>
        );
      })}
    </div>
  );
}
