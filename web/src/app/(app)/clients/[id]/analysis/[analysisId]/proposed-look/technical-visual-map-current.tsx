import { Card } from "@/components/ui";
import type { TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import { HEAD_ZONES, type TechnicalVisualMapPayload } from "@/lib/technical-visual-map-validators";

import { TechnicalVisualMapConstraints } from "./technical-visual-map-constraints";
import { TechnicalVisualMapGlobalIntentView } from "./technical-visual-map-global-intent";
import { TechnicalVisualMapRelationships } from "./technical-visual-map-relationships";
import { TechnicalVisualMapStatusBadge } from "./technical-visual-map-status-badge";
import { TechnicalVisualMapZoneSummary } from "./technical-visual-map-zone-summary";

export interface CurrentTechnicalVisualMapProps {
  map: TechnicalVisualMapRecord;
  effectiveMap: TechnicalVisualMapPayload;
}

// Technical Visual Map, Stage 4 -- the read-only, authoritative view. Headed
// with the exact text "Current Technical Visual Map" so it is never confused
// with a history row. Authority for what counts as "current" comes ENTIRELY
// from the caller (the Stage 3 current endpoint's own result, sourced via
// findCurrentConfirmedMap) -- this component never re-derives it from
// history/latest ordering itself.
//
// Renders the EFFECTIVE map (baseline + any professional adjustments already
// resolved server-side), never the raw frozen `map.payload` alone -- passing
// the baseline directly here would silently hide every professional
// adjustment, exactly the category of bug Proposed Look's own
// CurrentApprovedLook (buildEffectivePlan) was built to avoid. Regression
// tested in technical-visual-map-current.test.ts.
export function CurrentTechnicalVisualMap({ map, effectiveMap }: CurrentTechnicalVisualMapProps) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-foreground">Current Technical Visual Map</h3>
        <TechnicalVisualMapStatusBadge status={map.status} />
        <span className="text-xs text-muted">Version {map.mapVersion}</span>
        {map.confirmedAt ? (
          <span className="text-xs text-muted">Confirmed {new Date(map.confirmedAt).toLocaleDateString()}</span>
        ) : null}
      </div>

      <p className="text-xs text-muted">
        Belongs to the current approved Proposed Look. This binding is fixed -- if a different proposal is confirmed
        later, this map stays with the exact proposal it was created from.
      </p>

      <TechnicalVisualMapGlobalIntentView globalIntent={effectiveMap.globalIntent} />

      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Anatomical zones</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HEAD_ZONES.map((zone) => {
            const entry = effectiveMap.zones.find((z) => z.zone === zone);
            return entry ? <TechnicalVisualMapZoneSummary key={zone} zone={zone} entry={entry} /> : null;
          })}
        </div>
      </div>

      <TechnicalVisualMapRelationships relationships={effectiveMap.relationships} />

      <TechnicalVisualMapConstraints constraints={effectiveMap.preserveConstraints} />
    </Card>
  );
}
