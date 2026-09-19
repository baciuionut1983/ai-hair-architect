"use client";

import { useState } from "react";
import type { ProceduralClaimReviewDecision } from "@/lib/professional-learning-procedural-review-validators";
import { canEditClaim, claimView, reviewCopy } from "./teach-ai-procedural-review-logic";
import type { LearningDraft, ReviewableClaim } from "./teach-ai-procedural-review-types";

type Save = (claimId: string, decision: ProceduralClaimReviewDecision, correctedValue?: string, note?: string) => Promise<boolean>;
const buttonClass = "min-h-11 rounded-md border border-border px-3 py-2 text-left disabled:opacity-50";

function ClaimCard({ claim, draft, locked, save }: { claim: ReviewableClaim; draft: LearningDraft; locked: boolean; save: Save }) {
  const view = claimView(claim, draft.proceduralReview);
  const [editing, setEditing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState(view.correctedValue ?? "");
  const [note, setNote] = useState(view.note ?? "");
  const editable = canEditClaim(draft.status, Boolean(view.decision), editing, locked);
  const showControls = canEditClaim(draft.status, Boolean(view.decision), editing, false);

  async function submit(decision: ProceduralClaimReviewDecision) {
    if (!editable) return;
    if (await save(claim.claimId, decision, correction, note)) {
      setEditing(false);
      setCorrecting(false);
    }
  }

  return (
    <article className="min-w-0 space-y-2 rounded-md border border-border p-3 [overflow-wrap:anywhere]">
      <div>
        <p className="font-medium">{reviewCopy.ai}</p>
        <p>{view.aiStatement}</p>
        <p className="mt-1 text-muted">{reviewCopy.scope}</p>
      </div>
      <div className="border-t border-border pt-2">
        <p className="font-medium">{reviewCopy.professional}</p>
        <p>{view.professionalResult}</p>
        {view.correctedValue !== undefined ? <p className="mt-1 whitespace-pre-wrap"><strong>{reviewCopy.correction}: </strong>{view.correctedValue}</p> : null}
        {view.note ? <p className="mt-1 whitespace-pre-wrap">{view.note}</p> : null}
      </div>
      {view.decision && !editing && draft.status === "APPROVED" ? (
        <button type="button" disabled={locked} className={buttonClass} onClick={() => { setCorrection(view.correctedValue ?? ""); setNote(view.note ?? ""); setEditing(true); }}>{reviewCopy.edit}</button>
      ) : null}
      {showControls ? (
        <fieldset disabled={locked} className="min-w-0 space-y-2">
          {correcting ? (
            <>
              <label className="block">{reviewCopy.correction}
                <textarea className="mt-1 block min-h-24 w-full max-w-full rounded-md border border-border bg-background p-2" value={correction} onChange={event => setCorrection(event.target.value)} />
              </label>
              <label className="block">{reviewCopy.note}
                <textarea className="mt-1 block min-h-16 w-full max-w-full rounded-md border border-border bg-background p-2" value={note} onChange={event => setNote(event.target.value)} />
              </label>
              <button type="button" className={buttonClass} disabled={locked || !correction.trim()} onClick={() => void submit("PROFESSIONALLY_CORRECTED")}>{reviewCopy.save}</button>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(Object.keys(reviewCopy.actions) as ProceduralClaimReviewDecision[]).map(decision => (
                <button key={decision} type="button" className={buttonClass} onClick={() => decision === "PROFESSIONALLY_CORRECTED" ? setCorrecting(true) : void submit(decision)}>{reviewCopy.actions[decision]}</button>
              ))}
            </div>
          )}
          {editing || correcting ? <button type="button" className={buttonClass} onClick={() => { setEditing(false); setCorrecting(false); setCorrection(view.correctedValue ?? ""); setNote(view.note ?? ""); }}>{reviewCopy.cancel}</button> : null}
        </fieldset>
      ) : null}
    </article>
  );
}

export function ProceduralReviewSection({ draft, locked, saving, save }: { draft: LearningDraft; locked: boolean; saving: boolean; save: Save }) {
  return (
    <section className="mt-2 min-w-0 space-y-2" aria-label={reviewCopy.heading} aria-busy={saving}>
      <h4 className="font-medium">{reviewCopy.heading}</h4>
      {draft.status !== "APPROVED" ? <p className="text-muted">{draft.status === "DRAFT" || draft.status === "READY_FOR_REVIEW" ? reviewCopy.beforeApproval : reviewCopy.historical}</p> : null}
      {saving ? <p role="status">{reviewCopy.saving}</p> : null}
      {draft.reviewableProceduralClaims.length === 0 ? <p className="text-muted">{reviewCopy.empty}</p> : draft.reviewableProceduralClaims.map(claim => <ClaimCard key={claim.claimId} claim={claim} draft={draft} locked={locked} save={save} />)}
    </section>
  );
}
