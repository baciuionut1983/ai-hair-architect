"use client";

import { Badge, Button } from "@/components/ui";
import { HEAD_ZONES, type HeadZone } from "@/lib/technical-visual-map-validators";
import type { TechnicalVisualMapSpatialPayload } from "@/lib/technical-visual-map-spatial-validators";

import { HEAD_ZONE_LABELS, formatPlacementStateLabel } from "./spatial-binding-logic";

export interface SpatialBindingControlsProps {
  payload: TechnicalVisualMapSpatialPayload;
  editable: boolean;
  activeZone: HeadZone | null;
  onSetActiveZone: (zone: HeadZone | null) => void;
  onMarkZoneNotVisible: (zone: HeadZone) => void;
  onResetZone: (zone: HeadZone) => void;
  perimeterDrawMode: boolean;
  onTogglePerimeterDrawMode: () => void;
  onMarkPerimeterNotVisible: () => void;
  onResetPerimeter: () => void;
}

// Technical Visual Map, Stage 5C -- structured, keyboard-reachable controls
// for every zone and the perimeter. These are the ONLY way to reach
// not_visible/reset (there is no way to express either by clicking the
// photo), and remain fully usable even for a professional who cannot or
// prefers not to use precise drag interaction (requirement #36). State is
// never communicated by color alone -- every row shows its state as text.
export function SpatialBindingControls({
  payload,
  editable,
  activeZone,
  onSetActiveZone,
  onMarkZoneNotVisible,
  onResetZone,
  perimeterDrawMode,
  onTogglePerimeterDrawMode,
  onMarkPerimeterNotVisible,
  onResetPerimeter,
}: SpatialBindingControlsProps) {
  return (
    <div className="flex flex-col gap-4">
      {editable ? (
        <p className="text-xs text-muted">
          Select a zone, then click the corresponding area on the photo. Drag a placed anchor to adjust it.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {HEAD_ZONES.map((zone) => {
          const entry = payload.zones.find((z) => z.zone === zone);
          const state = entry?.state ?? "not_placed";
          const isActive = activeZone === zone;
          return (
            <div key={zone} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-alt p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{HEAD_ZONE_LABELS[zone]}</span>
                <Badge variant={state === "placed" ? "success" : state === "not_visible" ? "warning" : "neutral"}>
                  {formatPlacementStateLabel(state)}
                </Badge>
              </div>
              {editable ? (
                <div className="flex flex-wrap gap-1.5">
                  {state === "not_placed" ? (
                    <Button
                      type="button"
                      variant={isActive ? "primary" : "secondary"}
                      onClick={() => onSetActiveZone(isActive ? null : zone)}
                      aria-pressed={isActive}
                    >
                      {isActive ? "Click the photo to place" : "Place"}
                    </Button>
                  ) : null}
                  {state === "placed" ? (
                    <span className="self-center text-xs text-muted">Drag the anchor on the photo to move it.</span>
                  ) : null}
                  {state !== "not_visible" ? (
                    <Button type="button" variant="secondary" onClick={() => onMarkZoneNotVisible(zone)}>
                      Mark not visible
                    </Button>
                  ) : null}
                  {state !== "not_placed" ? (
                    <Button type="button" variant="secondary" onClick={() => onResetZone(zone)}>
                      Reset
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-alt p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">Perimeter boundary</span>
          <Badge variant={payload.perimeter.state === "placed" ? "success" : payload.perimeter.state === "not_visible" ? "warning" : "neutral"}>
            {formatPlacementStateLabel(payload.perimeter.state)}
          </Badge>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant={perimeterDrawMode ? "primary" : "secondary"} onClick={onTogglePerimeterDrawMode} aria-pressed={perimeterDrawMode}>
              {perimeterDrawMode ? "Stop drawing" : "Draw perimeter"}
            </Button>
            {payload.perimeter.state === "placed" ? (
              <span className="self-center text-xs text-muted">Drag a point on the photo to adjust it.</span>
            ) : null}
            {payload.perimeter.state !== "not_visible" ? (
              <Button type="button" variant="secondary" onClick={onMarkPerimeterNotVisible}>
                Mark not visible
              </Button>
            ) : null}
            {payload.perimeter.state !== "not_placed" ? (
              <Button type="button" variant="secondary" onClick={onResetPerimeter}>
                Reset
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
