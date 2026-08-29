"use client";

import { useState } from "react";

import { Alert, Button, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import type { TechnicalCutPlan } from "@/lib/contracts";

import { CurrentApprovedLook } from "./proposed-look-current-look";
import { ProposedLookDraftEditor } from "./proposed-look-draft-editor";
import { ProposalHistoryList } from "./proposed-look-history";
import { findExistingDraft, isConfirmedProposalPotentiallyStale } from "./proposed-look-logic";
import { shouldShowConfirmConflictMessage } from "./proposed-look-section-logic";
import { TechnicalVisualMapSection } from "./technical-visual-map-section";
import { useProposedLook, type ProposedLookActionOutcome } from "./use-proposed-look";

export interface ProposedLookSectionProps {
  clientId: string;
  analysisId: string;
  technicalCutPlan: TechnicalCutPlan | undefined;
  analysisUpdatedAt: string;
}

// AI Proposed Look (Phase 2), Stage 4 -- the top-level orchestrator. This is
// the ONLY component that calls useProposedLook and owns all server-derived
// state and cross-action orchestration (confirm's
// expectedCurrentConfirmedProposalId, the 409-conflict message). Every child
// below is controlled/presentational -- none of them call fetch themselves.
export function ProposedLookSection({
  clientId,
  analysisId,
  technicalCutPlan,
  analysisUpdatedAt,
}: ProposedLookSectionProps) {
  const { state, createDraft, editDraft, confirmDraft, rejectDraft } = useProposedLook(clientId);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmConflictMessage, setConfirmConflictMessage] = useState<string | null>(null);

  if (state.status === "loading") {
    return <LoadingState label="Loading proposed look..." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Couldn't load the proposed look" description="Please try refreshing the page." />;
  }

  const { current, history } = state;
  const draft = findExistingDraft(history);

  async function handleCreateDraft() {
    setCreating(true);
    setCreateError(null);
    const outcome = await createDraft(analysisId);
    if (!outcome.ok) {
      setCreateError(outcome.message);
    }
    setCreating(false);
  }

  async function handleConfirm(): Promise<ProposedLookActionOutcome> {
    if (!draft) throw new Error("handleConfirm called with no draft");
    setConfirmConflictMessage(null);
    const outcome = await confirmDraft(draft.id, current?.id ?? null);
    const conflictMessage = shouldShowConfirmConflictMessage(outcome);
    if (conflictMessage) {
      setConfirmConflictMessage(conflictMessage);
    }
    return outcome;
  }

  const isEmpty = current === null && history.length === 0 && !draft && technicalCutPlan === undefined;

  if (isEmpty) {
    return (
      <EmptyState
        title="No proposed look yet"
        description="This analysis doesn't have a haircut plan to build a proposal from."
      />
    );
  }

  return (
    <div id="proposed-look-section" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-foreground">Proposed Look</h2>

      {draft ? (
        <ProposedLookDraftEditor
          key={`${draft.id}-${draft.edits.length}`}
          proposal={draft}
          onSave={(edits) => editDraft(draft.id, edits)}
          onConfirm={handleConfirm}
          onReject={() => rejectDraft(draft.id)}
          confirmConflictMessage={confirmConflictMessage}
        />
      ) : technicalCutPlan ? (
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={handleCreateDraft} loading={creating}>
            Create Proposed Look
          </Button>
          {createError ? <Alert variant="error">{createError}</Alert> : null}
        </div>
      ) : null}

      {current ? (
        <CurrentApprovedLook
          current={current}
          isStale={isConfirmedProposalPotentiallyStale(analysisUpdatedAt, current.analysisSnapshotAt)}
        />
      ) : null}

      {/* Technical Visual Map, Stage 4 -- rendered ONLY when a CONFIRMED
          proposal exists (test #1/#2: no confirmed proposal means no map
          creation is offered at all). Keyed on `current.id` so switching to a
          newly-confirmed proposal fully remounts this section against its own
          fresh, unrelated scope rather than reusing any stale local state
          from the previous proposal's map. */}
      {current ? <TechnicalVisualMapSection key={current.id} clientId={clientId} proposalId={current.id} /> : null}

      {history.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">History</h3>
          <ProposalHistoryList history={history} currentConfirmedId={current?.id ?? null} />
        </div>
      ) : null}
    </div>
  );
}
