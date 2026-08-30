"use client";

import { useState } from "react";

import { Alert, Button } from "@/components/ui";
import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";
import type { SpatialBindingEditOperation } from "@/lib/technical-visual-map-spatial-validators";

import { CurrentSpatialBinding } from "./spatial-binding-current";
import { SpatialBindingDraftEditor } from "./spatial-binding-draft-editor";
import { SpatialBindingHistoryList } from "./spatial-binding-history";
import { SpatialBindingImageSelector } from "./spatial-binding-image-selector";
import { filterSpatialBindingsByScope, findExistingDraftSpatialBinding } from "./spatial-binding-logic";
import { shouldShowSpatialBindingConfirmConflictMessage } from "./spatial-binding-section-logic";
import { type SpatialBindingActionOutcome, useSpatialBinding } from "./use-spatial-binding";

export interface SpatialBindingSectionProps {
  clientId: string;
  proposalId: string;
  technicalVisualMapId: string;
}

function contentUrl(imageAssetId: string): string {
  return `/api/v1/image-assets/${imageAssetId}/content`;
}

// Technical Visual Map, Stage 5C -- the top-level orchestrator. Rendered
// immediately downstream of the CONFIRMED Technical Visual Map (see
// technical-visual-map-current.tsx), matching the locked hierarchy: Current
// Approved Look -> Technical Visual Map -> Spatial Mapping. Owns the
// professional's image/view selection and is the ONLY component that calls
// useSpatialBinding -- every child below is controlled/presentational.
export function SpatialBindingSection({ clientId, proposalId, technicalVisualMapId }: SpatialBindingSectionProps) {
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedViewLabel, setSelectedViewLabel] = useState<string | null>(null);
  const { state, createDraft, applyEdits, confirmDraft } = useSpatialBinding(
    clientId,
    proposalId,
    technicalVisualMapId,
    selectedImageId,
    selectedViewLabel,
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmConflictMessage, setConfirmConflictMessage] = useState<string | null>(null);

  async function handleCreateDraft() {
    setCreating(true);
    setCreateError(null);
    const outcome = await createDraft();
    if (!outcome.ok) setCreateError(outcome.message);
    setCreating(false);
  }

  async function handleConfirm(bindingId: string, currentId: string | null): Promise<SpatialBindingActionOutcome> {
    setConfirmConflictMessage(null);
    const outcome = await confirmDraft(bindingId, currentId);
    const conflictMessage = shouldShowSpatialBindingConfirmConflictMessage(outcome);
    if (conflictMessage) setConfirmConflictMessage(conflictMessage);
    return outcome;
  }

  return (
    <div id="spatial-binding-section" className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Spatial Mapping</h3>
        <p className="text-xs text-muted">
          Place this map&apos;s zones on an actual photo of this client, for one specific angle at a time.
        </p>
      </div>

      <SpatialBindingImageSelector
        clientId={clientId}
        selectedImageId={selectedImageId}
        selectedViewLabel={selectedViewLabel}
        onSelectImage={setSelectedImageId}
        onSelectViewLabel={setSelectedViewLabel}
      />

      {state.status === "no-selection" ? (
        <p className="text-xs text-muted">Select a photo and a view to start spatial mapping.</p>
      ) : state.status === "loading" ? (
        <p className="text-xs text-muted">Loading spatial map...</p>
      ) : state.status === "error" ? (
        <Alert variant="error">Couldn&apos;t load the spatial map. Please try refreshing the page.</Alert>
      ) : (
        <SpatialBindingSectionReady
          selectedImageId={selectedImageId as string}
          selectedViewLabel={selectedViewLabel as string}
          current={state.current}
          history={state.history}
          creating={creating}
          createError={createError}
          confirmConflictMessage={confirmConflictMessage}
          onCreateDraft={handleCreateDraft}
          onSaveEdits={applyEdits}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}

interface SpatialBindingSectionReadyProps {
  selectedImageId: string;
  selectedViewLabel: string;
  current: TechnicalVisualMapSpatialBindingRecord | null;
  history: TechnicalVisualMapSpatialBindingRecord[];
  creating: boolean;
  createError: string | null;
  confirmConflictMessage: string | null;
  onCreateDraft: () => void;
  onSaveEdits: (bindingId: string, operations: SpatialBindingEditOperation[]) => Promise<SpatialBindingActionOutcome>;
  onConfirm: (bindingId: string, currentId: string | null) => Promise<SpatialBindingActionOutcome>;
}

// Split out so the scope-filtered `draft` and the image URL are only ever
// computed once selection AND data are both ready -- keeps the parent above
// simple to read.
function SpatialBindingSectionReady({
  selectedImageId,
  selectedViewLabel,
  current,
  history,
  creating,
  createError,
  confirmConflictMessage,
  onCreateDraft,
  onSaveEdits,
  onConfirm,
}: SpatialBindingSectionReadyProps) {
  const scoped = filterSpatialBindingsByScope(history, selectedImageId, selectedViewLabel);
  const draft = findExistingDraftSpatialBinding(scoped);
  const imageUrl = contentUrl(selectedImageId);

  return (
    <div className="flex flex-col gap-4">
      {draft ? (
        <SpatialBindingDraftEditor
          key={draft.id}
          binding={draft}
          imageUrl={imageUrl}
          imageAlt="Client photo being spatially mapped"
          onSaveEdits={onSaveEdits}
          onConfirm={() => onConfirm(draft.id, current?.id ?? null)}
          confirmConflictMessage={confirmConflictMessage}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={onCreateDraft} loading={creating}>
            {current ? "Create new spatial map revision" : "Create spatial map"}
          </Button>
          {createError ? <Alert variant="error">{createError}</Alert> : null}
        </div>
      )}

      {current ? <CurrentSpatialBinding binding={current} imageUrl={contentUrl(current.sourceImageAssetId)} imageAlt="Confirmed spatial map source photo" /> : null}

      {scoped.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-foreground">Spatial map history</h4>
          <SpatialBindingHistoryList history={scoped} currentConfirmedId={current?.id ?? null} />
        </div>
      ) : null}
    </div>
  );
}
