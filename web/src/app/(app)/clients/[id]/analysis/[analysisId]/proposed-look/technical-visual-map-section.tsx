"use client";

import { useState } from "react";

import { Alert, Button, ErrorState, LoadingState } from "@/components/ui";
import type { MapAdjustmentEntry } from "@/lib/technical-visual-map-validators";

import { CurrentTechnicalVisualMap } from "./technical-visual-map-current";
import { TechnicalVisualMapDraftEditor } from "./technical-visual-map-draft-editor";
import { TechnicalVisualMapHistoryList } from "./technical-visual-map-history";
import { findExistingDraftMap, resolveHistoryRowEffectiveMap } from "./technical-visual-map-logic";
import { shouldShowTechnicalVisualMapConfirmConflictMessage } from "./technical-visual-map-section-logic";
import { useTechnicalVisualMap, type TechnicalVisualMapActionOutcome } from "./use-technical-visual-map";

export interface TechnicalVisualMapSectionProps {
  clientId: string;
  // The CURRENT confirmed AnalysisProposal id -- the caller (proposed-look-
  // section.tsx) only ever renders this component when that proposal exists.
  // If the currently confirmed proposal later changes, the caller passes a
  // NEW proposalId (and a new `key`), and this component naturally starts a
  // fresh, unrelated scope -- it never silently retargets a map created for
  // one proposal onto another.
  proposalId: string;
}

// Technical Visual Map, Stage 4 -- the top-level orchestrator, rendered
// immediately downstream of Proposed Look's own "Current Approved Look" (see
// proposed-look-section.tsx) ONLY when a CONFIRMED proposal exists. This is
// the ONLY component that calls useTechnicalVisualMap and owns all
// server-derived state and cross-action orchestration (confirm's
// expectedCurrentConfirmedMapId, the 409-conflict message) -- every child
// below is controlled/presentational; none of them call fetch themselves.
export function TechnicalVisualMapSection({ clientId, proposalId }: TechnicalVisualMapSectionProps) {
  const { state, createDraft, applyAdjustments, confirmDraft } = useTechnicalVisualMap(clientId, proposalId);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmConflictMessage, setConfirmConflictMessage] = useState<string | null>(null);

  if (state.status === "loading") {
    return <LoadingState label="Loading technical visual map..." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Couldn't load the technical visual map" description="Please try refreshing the page." />;
  }

  const { current, currentEffective, history } = state;
  const draft = findExistingDraftMap(history);
  // Only a DRAFT ever reaches the editor -- its effective view is derived
  // client-side (list responses carry no precomputed effectiveMap); see
  // resolveHistoryRowEffectiveMap's own doc comment for why this reuses the
  // Stage 2 resolver rather than a second reimplementation.
  const draftEffective = draft ? resolveHistoryRowEffectiveMap(draft) : null;

  async function handleCreateDraft() {
    setCreating(true);
    setCreateError(null);
    const outcome = await createDraft();
    if (!outcome.ok) {
      setCreateError(outcome.message);
    }
    setCreating(false);
  }

  async function handleConfirm(): Promise<TechnicalVisualMapActionOutcome> {
    if (!draft) throw new Error("handleConfirm called with no draft");
    setConfirmConflictMessage(null);
    const outcome = await confirmDraft(draft.id, current?.id ?? null);
    const conflictMessage = shouldShowTechnicalVisualMapConfirmConflictMessage(outcome);
    if (conflictMessage) {
      setConfirmConflictMessage(conflictMessage);
    }
    return outcome;
  }

  function handleSaveAdjustments(adjustments: MapAdjustmentEntry[]): Promise<TechnicalVisualMapActionOutcome> {
    if (!draft) throw new Error("handleSaveAdjustments called with no draft");
    return applyAdjustments(draft.id, adjustments);
  }

  return (
    <div id="technical-visual-map-section" className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Technical Visual Map</h2>
        <p className="text-xs text-muted">
          A structured, per-zone breakdown of the approved cutting plan above -- crown, occipital, nape, top, sides,
          and fringe.
        </p>
      </div>

      {draft && draftEffective ? (
        // Keyed ONLY on `draft.id` -- stable across a save (which reloads the
        // SAME draft with an updated `professionalAdjustments` array) so an
        // adjustment save never force-remounts every zone editor and wipes
        // in-progress edits on other zones or a just-shown "Saved."
        // confirmation. A genuinely different draft (a new id, e.g. after
        // creating a replacement revision) still gets a fresh subtree.
        <TechnicalVisualMapDraftEditor
          key={draft.id}
          map={draft}
          effectiveMap={draftEffective}
          onSaveAdjustments={handleSaveAdjustments}
          onConfirm={handleConfirm}
          confirmConflictMessage={confirmConflictMessage}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={handleCreateDraft} loading={creating}>
            {current ? "Create new Technical Visual Map revision" : "Create Technical Visual Map"}
          </Button>
          {createError ? <Alert variant="error">{createError}</Alert> : null}
        </div>
      )}

      {current && currentEffective ? <CurrentTechnicalVisualMap map={current} effectiveMap={currentEffective} /> : null}

      {history.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Map history</h3>
          <TechnicalVisualMapHistoryList history={history} currentConfirmedId={current?.id ?? null} />
        </div>
      ) : null}
    </div>
  );
}
