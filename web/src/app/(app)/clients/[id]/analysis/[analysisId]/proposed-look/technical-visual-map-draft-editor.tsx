"use client";

import { useState } from "react";

import { Alert, Button, Card } from "@/components/ui";
import type { TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import { HEAD_ZONES, type MapAdjustmentEntry, type TechnicalVisualMapPayload } from "@/lib/technical-visual-map-validators";

import { TechnicalVisualMapConstraints } from "./technical-visual-map-constraints";
import { TechnicalVisualMapGlobalIntentView } from "./technical-visual-map-global-intent";
import { TechnicalVisualMapRelationships } from "./technical-visual-map-relationships";
import { shouldShowTechnicalVisualMapConfirmConflictMessage } from "./technical-visual-map-section-logic";
import { TechnicalVisualMapStatusBadge } from "./technical-visual-map-status-badge";
import { TechnicalVisualMapZoneEditor } from "./technical-visual-map-zone-editor";
import type { TechnicalVisualMapActionOutcome } from "./use-technical-visual-map";

export interface TechnicalVisualMapDraftEditorProps {
  map: TechnicalVisualMapRecord;
  effectiveMap: TechnicalVisualMapPayload;
  onSaveAdjustments: (adjustments: MapAdjustmentEntry[]) => Promise<TechnicalVisualMapActionOutcome>;
  onConfirm: () => Promise<TechnicalVisualMapActionOutcome>;
  confirmConflictMessage: string | null;
}

// Technical Visual Map, Stage 4 -- the DRAFT-only editable view. Only a
// DRAFT map ever renders through this component; CONFIRMED/SUPERSEDED always
// render through the read-only CurrentTechnicalVisualMap /
// TechnicalVisualMapHistoryList instead. Global intent is ALWAYS rendered
// read-only here too, even on a DRAFT -- there is no control anywhere in
// this file that could mutate a proposal-global field; changing one requires
// going back to Proposed Look.
//
// Each zone editor and the relationship editor call back into the SAME
// onSaveAdjustments (-> applyAdjustments -> PATCH .../technical-visual-maps/
// [mapId]), which triggers the parent hook's reload -- so `map`/`effectiveMap`
// always reflect the latest persisted state after a save. Zone editors are
// keyed ONLY on `zone` (stable across a reload), deliberately NOT remounted
// on every save: a save's own local form values already equal the fresh
// effective entry that comes back (so "nothing left to save" falls out
// naturally, without a remount), and -- just as importantly -- an
// UNRELATED zone's in-progress, not-yet-saved edits survive a sibling zone's
// save instead of being silently wiped by a forced remount.
export function TechnicalVisualMapDraftEditor({
  map,
  effectiveMap,
  onSaveAdjustments,
  onConfirm,
  confirmConflictMessage,
}: TechnicalVisualMapDraftEditorProps) {
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function handleConfirm() {
    setConfirmPending(true);
    setConfirmError(null);
    const outcome = await onConfirm();
    // A confirmation conflict is surfaced by the parent as
    // `confirmConflictMessage` (a warning, not an error, and never an auto
    // retry). Only a NON-conflict failure becomes this component's own error.
    if (!outcome.ok && shouldShowTechnicalVisualMapConfirmConflictMessage(outcome) === null) {
      setConfirmError(outcome.message);
    }
    setConfirmPending(false);
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-foreground">Draft Technical Visual Map</h3>
        <TechnicalVisualMapStatusBadge status={map.status} />
        <span className="text-xs text-muted">Version {map.mapVersion}</span>
      </div>

      <TechnicalVisualMapGlobalIntentView globalIntent={effectiveMap.globalIntent} />

      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Anatomical zones</h4>
        <p className="mb-3 text-xs text-muted">
          Each zone starts unspecified unless the confirmed plan or a previous adjustment already set a value. Save
          each zone independently.
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {HEAD_ZONES.map((zone) => {
            const entry = effectiveMap.zones.find((z) => z.zone === zone);
            return entry ? (
              <TechnicalVisualMapZoneEditor key={zone} zone={zone} entry={entry} onSave={onSaveAdjustments} />
            ) : null;
          })}
        </div>
      </div>

      <TechnicalVisualMapRelationships
        relationships={effectiveMap.relationships}
        onAdd={(adjustment) => onSaveAdjustments([adjustment])}
      />

      <TechnicalVisualMapConstraints constraints={effectiveMap.preserveConstraints} />

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={handleConfirm} loading={confirmPending}>
            Confirm Technical Visual Map
          </Button>
        </div>

        {confirmConflictMessage ? (
          <Alert variant="warning" title="Confirmation conflict">
            {confirmConflictMessage}
          </Alert>
        ) : null}

        {confirmError ? (
          <Alert variant="error" title="Couldn't confirm">
            {confirmError}
          </Alert>
        ) : null}
      </div>
    </Card>
  );
}
