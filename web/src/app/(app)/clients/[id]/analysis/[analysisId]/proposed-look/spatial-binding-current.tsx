import { Card } from "@/components/ui";
import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";

import { VIEW_LABEL_DISPLAY } from "./spatial-binding-logic";
import { SpatialBindingControls } from "./spatial-binding-controls";
import { SpatialBindingOverlay } from "./spatial-binding-overlay";
import { SpatialBindingStatusBadge } from "./spatial-binding-status-badge";

export interface CurrentSpatialBindingProps {
  binding: TechnicalVisualMapSpatialBindingRecord;
  imageUrl: string;
  imageAlt: string;
}

// Technical Visual Map, Stage 5C -- the read-only, authoritative view.
// Headed with the exact text "Current Spatial Map" so it is never confused
// with a history row. Authority for what counts as "current" comes ENTIRELY
// from the caller (the Stage 5B current endpoint's own result, scoped by
// map + source image + view) -- this component never re-derives it.
// CONFIRMED and SUPERSEDED bindings are always read-only (requirement #25);
// this component never accepts edit callbacks.
export function CurrentSpatialBinding({ binding, imageUrl, imageAlt }: CurrentSpatialBindingProps) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-base font-semibold text-foreground">Current Spatial Map</h4>
        <SpatialBindingStatusBadge status={binding.status} />
        <span className="text-xs text-muted">
          {VIEW_LABEL_DISPLAY[binding.viewLabel as keyof typeof VIEW_LABEL_DISPLAY] ?? binding.viewLabel}
        </span>
        {binding.confirmedAt ? (
          <span className="text-xs text-muted">Confirmed {new Date(binding.confirmedAt).toLocaleDateString()}</span>
        ) : null}
      </div>

      <SpatialBindingOverlay
        imageUrl={imageUrl}
        imageAlt={imageAlt}
        frozenWidth={binding.frozenWidth}
        frozenHeight={binding.frozenHeight}
        payload={binding.payload}
        editable={false}
        activeZone={null}
        perimeterDrawMode={false}
      />

      <SpatialBindingControls
        payload={binding.payload}
        editable={false}
        activeZone={null}
        onSetActiveZone={() => undefined}
        onMarkZoneNotVisible={() => undefined}
        onResetZone={() => undefined}
        perimeterDrawMode={false}
        onTogglePerimeterDrawMode={() => undefined}
        onMarkPerimeterNotVisible={() => undefined}
        onResetPerimeter={() => undefined}
      />
    </Card>
  );
}
