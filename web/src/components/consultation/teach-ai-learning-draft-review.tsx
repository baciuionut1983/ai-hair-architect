"use client";

import { useState } from "react";

import { Alert } from "@/components/ui";
import {
  APPROVED_NOTE_TEXT,
  comparisonLabel,
  discernmentLabel,
  draftActionButtonLabel,
  draftStatusLabel,
  formatExtractionForDisplay,
  formatProceduralInterpretationForDisplay,
  formatTemporalEvidenceForDisplay,
  LEARNING_DRAFT_HEADING_TEXT,
  PROCEDURAL_INTERPRETATION_HEADING_TEXT,
  TEMPORAL_EVIDENCE_HEADING_TEXT,
} from "./teach-ai-learning-draft-review-logic";

import { canReanalyze, createReviewController, initialReviewState, reviewCopy } from "./teach-ai-procedural-review-logic";
import { ProceduralReviewSection } from "./teach-ai-procedural-review-section";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- MINIMAL
// review UI (Part 29). Deliberately small and self-contained: one button
// per evidence item that triggers/shows its draft, never a redesign of
// the surrounding Teach the AI panel. Never implies "AI a învățat cu
// succes" -- the heading is always LEARNING_DRAFT_HEADING_TEXT, and an
// APPROVED status always carries APPROVED_NOTE_TEXT alongside it.

export function LearningDraftReview({ evidenceId }: { evidenceId: string }) {
  const [view, setView] = useState(initialReviewState);
  const [controller] = useState(() => createReviewController((url, init) => fetch(url, init), setView));
  const { draft, skipped, error, expanded, busy: loading } = view;

  return (
    <div className="mt-1 text-xs">
      {!draft || canReanalyze(draft.status) ? <button type="button" onClick={() => void controller.analyze(evidenceId)} disabled={loading || view.refreshRequired} className="min-h-11 text-muted underline hover:text-foreground">
        {loading ? reviewCopy.loading : draftActionButtonLabel(Boolean(draft), error !== null)}
      </button> : null}

      {expanded ? (
        <div className="mt-1 rounded-md border border-border p-2">
          <p className="font-medium">{LEARNING_DRAFT_HEADING_TEXT}</p>

          {error ? (
            <div className="mt-1">
              <Alert variant="error">{error}</Alert>
            </div>
          ) : null}
          {view.notice ? <p className="mt-2" role="status">{view.notice}</p> : null}
          {view.refreshRequired ? <button type="button" disabled={loading} className="min-h-11 underline" onClick={() => void controller.refresh()}>{reviewCopy.reload}</button> : null}
          {skipped ? (
            <p className="mt-1 text-muted">Materialul nu a fost procesat: {skipped}.</p>
          ) : null}
          {draft ? (
            <>
              <p className="mt-1">
                AI a găsit informații profesionale: <strong>{discernmentLabel(draft.discernmentCategory)}</strong>
              </p>
              <p>
                Comparație cu tehnicile existente: <strong>{comparisonLabel(draft.comparisonOutcome)}</strong>
                {draft.comparedSkillId ? ` (${draft.comparedSkillId})` : ""}
              </p>

              {draft.conflictDetail ? (
                <div className="mt-1 rounded-md border border-destructive/40 p-1.5">
                  <p className="font-medium">Posibil conflict cu o regulă aprobată</p>
                  <p>Regulă existentă: {draft.conflictDetail.existingClaim}</p>
                  <p>Material nou: {draft.conflictDetail.newClaim}</p>
                  <p className="text-muted">{draft.conflictDetail.reason}</p>
                </div>
              ) : null}

              {formatExtractionForDisplay(draft.extraction).length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {formatExtractionForDisplay(draft.extraction).map((entry) => (
                    <li key={entry.field}>
                      {entry.field}: {entry.value} ({entry.source})
                    </li>
                  ))}
                </ul>
              ) : null}

              {formatTemporalEvidenceForDisplay(draft.temporalEvidence).length > 0 ? (
                <div className="mt-2 rounded-md border border-border p-1.5">
                  <p className="font-medium">{TEMPORAL_EVIDENCE_HEADING_TEXT}</p>
                  <ul className="mt-1 space-y-0.5">
                    {formatTemporalEvidenceForDisplay(draft.temporalEvidence).map((entry, index) => (
                      <li key={index}>
                        {entry.rangeLabel}: {entry.text} ({entry.source})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {(() => {
                const procedural = formatProceduralInterpretationForDisplay(draft.proceduralInterpretation);
                if (!procedural) return null;
                return (
                  <div className="mt-2 rounded-md border border-border p-1.5">
                    <p className="font-medium">{PROCEDURAL_INTERPRETATION_HEADING_TEXT}</p>
                    {procedural.actionSequence.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {procedural.actionSequence.map((entry, index) => (
                          <li key={index}>
                            {entry.rangeLabel}: {entry.kind} ({entry.transitionLabel})
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {procedural.repetitions.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-muted">
                        {procedural.repetitions.map((entry) => (
                          <li key={entry.kind}>
                            {entry.kind}: {entry.occurrenceCount}x
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {procedural.zoneCompletion.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-muted">
                        {procedural.zoneCompletion.map((entry) => (
                          <li key={entry.kind}>
                            Finalizare zonă ({entry.kind}): {entry.stateLabel}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {procedural.coreChainSummary.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-muted">
                        {procedural.coreChainSummary.map((entry) => (
                          <li key={entry.stageLabel}>
                            {entry.stageLabel}: {entry.supportLabel}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })()}

              <ProceduralReviewSection key={draft.id + ":" + view.editEpoch} draft={draft} locked={loading || view.refreshRequired} saving={loading} save={controller.save} />

              <p className="mt-1 text-muted">Stare: {draftStatusLabel(draft.status)}</p>
              {draft.status === "APPROVED" ? <p className="text-muted">{APPROVED_NOTE_TEXT}</p> : null}

              {draft.status === "DRAFT" || draft.status === "READY_FOR_REVIEW" ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void controller.review("APPROVED")} disabled={loading || view.refreshRequired} className="min-h-11 text-foreground underline">
                    {reviewCopy.approve}
                  </button>
                  <button type="button" onClick={() => void controller.review("REJECTED")} disabled={loading || view.refreshRequired} className="min-h-11 text-muted underline">
                    {reviewCopy.rejectDraft}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
