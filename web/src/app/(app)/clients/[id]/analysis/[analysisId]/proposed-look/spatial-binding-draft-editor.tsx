"use client";

import { useState } from "react";

import { Alert, Button, Card } from "@/components/ui";
import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";
import type { HeadZone } from "@/lib/technical-visual-map-validators";
import type { SpatialBindingEditOperation } from "@/lib/technical-visual-map-spatial-validators";

import { SpatialBindingControls } from "./spatial-binding-controls";
import {
  VIEW_LABEL_DISPLAY,
  appendPerimeterPoint,
  applyLocalEdit,
  beginSave,
  buildZoneDragOperation,
  buildZonePlacementOperation,
  completeSaveFailure,
  completeSaveSuccess,
  createEditSession,
  isEditSessionDirty,
  replacePerimeterPointAt,
} from "./spatial-binding-logic";
import { SpatialBindingOverlay } from "./spatial-binding-overlay";
import { shouldShowSpatialBindingConfirmConflictMessage } from "./spatial-binding-section-logic";
import { SpatialBindingStatusBadge } from "./spatial-binding-status-badge";
import type { SpatialBindingActionOutcome } from "./use-spatial-binding";

export interface SpatialBindingDraftEditorProps {
  binding: TechnicalVisualMapSpatialBindingRecord;
  imageUrl: string;
  imageAlt: string;
  onSaveEdits: (bindingId: string, operations: SpatialBindingEditOperation[]) => Promise<SpatialBindingActionOutcome>;
  onConfirm: () => Promise<SpatialBindingActionOutcome>;
  confirmConflictMessage: string | null;
}

// Technical Visual Map, Stage 5C -- the DRAFT-only editable spatial map.
// Owns the local edit session (createEditSession/applyLocalEdit/beginSave/
// completeSaveSuccess/completeSaveFailure -- see spatial-binding-logic.ts's
// own doc comment for the full save-lifecycle contract) so every gesture on
// the overlay updates instantly and locally; nothing reaches the network
// until an explicit Save. Confirm is disabled while there are unsaved
// changes -- confirming would otherwise freeze a stale payload.
export function SpatialBindingDraftEditor({
  binding,
  imageUrl,
  imageAlt,
  onSaveEdits,
  onConfirm,
  confirmConflictMessage,
}: SpatialBindingDraftEditorProps) {
  const [session, setSession] = useState(() => createEditSession(binding.payload));
  const [activeZone, setActiveZone] = useState<HeadZone | null>(null);
  const [perimeterDrawMode, setPerimeterDrawMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const dirty = isEditSessionDirty(session);

  function commitLocalEdit(operation: SpatialBindingEditOperation) {
    setJustSaved(false);
    setSession((current) => applyLocalEdit(current, operation));
  }

  function handlePlaceActiveZone(point: { x: number; y: number }) {
    const operation = buildZonePlacementOperation(activeZone, point);
    if (!operation) return; // no active zone -- never invents one (requirement #12)
    commitLocalEdit(operation);
    setActiveZone(null);
  }

  function handleDragZone(zone: HeadZone, point: { x: number; y: number }) {
    commitLocalEdit(buildZoneDragOperation(zone, point));
  }

  function handleMarkZoneNotVisible(zone: HeadZone) {
    commitLocalEdit({ op: "set_zone_not_visible", zone });
    if (activeZone === zone) setActiveZone(null);
  }

  function handleResetZone(zone: HeadZone) {
    commitLocalEdit({ op: "reset_zone", zone });
  }

  function currentPerimeterPoints() {
    return session.workingPayload.perimeter.state === "placed" ? session.workingPayload.perimeter.points : [];
  }

  function handleAddPerimeterPoint(point: { x: number; y: number }) {
    commitLocalEdit({ op: "set_perimeter", points: appendPerimeterPoint(currentPerimeterPoints(), point) });
  }

  function handleDragPerimeterPoint(index: number, point: { x: number; y: number }) {
    commitLocalEdit({ op: "set_perimeter", points: replacePerimeterPointAt(currentPerimeterPoints(), index, point) });
  }

  function handleMarkPerimeterNotVisible() {
    commitLocalEdit({ op: "set_perimeter_not_visible" });
    setPerimeterDrawMode(false);
  }

  function handleResetPerimeter() {
    commitLocalEdit({ op: "reset_perimeter" });
  }

  async function handleSave() {
    const result = beginSave(session);
    if (!result) return;
    setSession(result.nextSession);
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);

    const outcome = await onSaveEdits(binding.id, result.toSend);
    if (outcome.ok) {
      setSession((current) => completeSaveSuccess(current, outcome.binding.payload));
      setJustSaved(true);
    } else {
      setSession((current) => completeSaveFailure(current, result.toSend));
      setSaveError(outcome.message);
    }
    setSaving(false);
  }

  async function handleConfirm() {
    setConfirmPending(true);
    setConfirmError(null);
    const outcome = await onConfirm();
    if (!outcome.ok && shouldShowSpatialBindingConfirmConflictMessage(outcome) === null) {
      setConfirmError(outcome.message);
    }
    setConfirmPending(false);
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-base font-semibold text-foreground">Draft spatial map</h4>
        <SpatialBindingStatusBadge status={binding.status} />
        <span className="text-xs text-muted">{VIEW_LABEL_DISPLAY[binding.viewLabel as keyof typeof VIEW_LABEL_DISPLAY] ?? binding.viewLabel}</span>
      </div>

      <SpatialBindingOverlay
        imageUrl={imageUrl}
        imageAlt={imageAlt}
        frozenWidth={binding.frozenWidth}
        frozenHeight={binding.frozenHeight}
        payload={session.workingPayload}
        editable
        activeZone={activeZone}
        perimeterDrawMode={perimeterDrawMode}
        onPlaceActiveZone={handlePlaceActiveZone}
        onDragZone={handleDragZone}
        onAddPerimeterPoint={handleAddPerimeterPoint}
        onDragPerimeterPoint={handleDragPerimeterPoint}
      />

      <SpatialBindingControls
        payload={session.workingPayload}
        editable
        activeZone={activeZone}
        onSetActiveZone={setActiveZone}
        onMarkZoneNotVisible={handleMarkZoneNotVisible}
        onResetZone={handleResetZone}
        perimeterDrawMode={perimeterDrawMode}
        onTogglePerimeterDrawMode={() => setPerimeterDrawMode((value) => !value)}
        onMarkPerimeterNotVisible={handleMarkPerimeterNotVisible}
        onResetPerimeter={handleResetPerimeter}
      />

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={handleSave} loading={saving} disabled={!dirty}>
            Save
          </Button>
          {dirty ? (
            <span className="text-xs font-medium text-warning">Unsaved changes</span>
          ) : justSaved ? (
            <span className="text-xs font-medium text-success">Saved</span>
          ) : (
            <span className="text-xs text-muted">No changes yet</span>
          )}
        </div>

        {saveError ? (
          <Alert variant="error" title="Couldn't save">
            {saveError}
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" onClick={handleConfirm} loading={confirmPending} disabled={dirty}>
            Confirm spatial map
          </Button>
          {dirty ? <span className="text-xs text-muted">Save your changes before confirming.</span> : null}
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
