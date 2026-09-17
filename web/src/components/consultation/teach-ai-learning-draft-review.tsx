"use client";

import { useState } from "react";

import { Alert } from "@/components/ui";
import {
  APPROVED_NOTE_TEXT,
  classifyDraftAnalysisResponse,
  comparisonLabel,
  discernmentLabel,
  draftActionButtonLabel,
  draftStatusLabel,
  formatExtractionForDisplay,
  LEARNING_DRAFT_HEADING_TEXT,
} from "./teach-ai-learning-draft-review-logic";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- MINIMAL
// review UI (Part 29). Deliberately small and self-contained: one button
// per evidence item that triggers/shows its draft, never a redesign of
// the surrounding Teach the AI panel. Never implies "AI a învățat cu
// succes" -- the heading is always LEARNING_DRAFT_HEADING_TEXT, and an
// APPROVED status always carries APPROVED_NOTE_TEXT alongside it.

interface DraftExtractionEntry {
  readonly value: unknown;
  readonly source: string;
  // Stage 8.5L4.R2.2, Part 17 -- present only when the semantic-binding
  // guard downgraded a claim to UNKNOWN while preserving what was
  // actually observed; see formatExtractionForDisplay.
  readonly rawObservation?: string;
}

interface LearningDraft {
  readonly id: string;
  readonly status: string;
  readonly discernmentCategory: string;
  readonly comparisonOutcome: string;
  readonly comparedSkillId: string | null;
  readonly extraction: Record<string, DraftExtractionEntry | undefined>;
  readonly conflictDetail: { readonly existingClaim: string; readonly newClaim: string; readonly reason: string } | null;
}

export function LearningDraftReview({ evidenceId }: { evidenceId: string }) {
  const [draft, setDraft] = useState<LearningDraft | null>(null);
  const [skipped, setSkipped] = useState<string | null>(null);
  // T1.1 Issue #1, Fix 1 -- a non-2xx response (misconfiguration, a real
  // provider timeout/rate-limit/invalid-response, or a validation
  // failure -- route.ts's own catch block) must never be treated the
  // same as "nothing to show." Cleared at the start of every attempt, so
  // a fresh success/skip after a prior failure is never shown alongside
  // a stale error, and a fresh failure never leaves a prior draft/skip
  // visible as if it still applied to THIS attempt.
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function runDiscernment() {
    setLoading(true);
    setSkipped(null);
    setError(null);
    setDraft(null);
    try {
      const response = await fetch(`/api/v1/learning-evidence/${evidenceId}/drafts`, { method: "POST" });
      const body = await response.json().catch(() => null);
      // The uploaded evidence itself is never touched here -- only this
      // attempt's own draft-creation call is being classified. A retry
      // (the same button, now labeled "Încearcă din nou" on failure)
      // simply calls this function again; no fake extraction content is
      // ever fabricated for a failed attempt.
      const outcome = classifyDraftAnalysisResponse(response.ok, body);
      if (outcome.kind === "error") setError(outcome.message);
      else if (outcome.kind === "skipped") setSkipped(outcome.reason);
      else setDraft(outcome.draft as LearningDraft);
      setExpanded(true);
    } catch {
      const failure = classifyDraftAnalysisResponse(false, null);
      if (failure.kind === "error") setError(failure.message);
      setExpanded(true);
    } finally {
      setLoading(false);
    }
  }

  async function review(decision: "APPROVED" | "REJECTED") {
    if (!draft) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/learning-drafts/${draft.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await response.json();
      if (body.draft) setDraft(body.draft);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-1 text-xs">
      <button type="button" onClick={() => void runDiscernment()} disabled={loading} className="text-muted underline hover:text-foreground">
        {draftActionButtonLabel(expanded, error !== null)}
      </button>

      {expanded ? (
        <div className="mt-1 rounded-md border border-border p-2">
          <p className="font-medium">{LEARNING_DRAFT_HEADING_TEXT}</p>

          {error ? (
            <div className="mt-1">
              <Alert variant="error">{error}</Alert>
            </div>
          ) : skipped ? (
            <p className="mt-1 text-muted">Materialul nu a fost procesat: {skipped}.</p>
          ) : draft ? (
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

              <p className="mt-1 text-muted">Stare: {draftStatusLabel(draft.status)}</p>
              {draft.status === "APPROVED" ? <p className="text-muted">{APPROVED_NOTE_TEXT}</p> : null}

              {draft.status === "DRAFT" || draft.status === "READY_FOR_REVIEW" ? (
                <div className="mt-1 flex gap-2">
                  <button type="button" onClick={() => void review("APPROVED")} disabled={loading} className="text-foreground underline">
                    Aprobă interpretarea
                  </button>
                  <button type="button" onClick={() => void review("REJECTED")} disabled={loading} className="text-muted underline">
                    Respinge
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
