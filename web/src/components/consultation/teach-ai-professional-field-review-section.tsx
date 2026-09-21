"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "@/components/ui";
import { useUiLanguage } from "@/lib/ui-language-context";
import { copyFor, errorCopy, reviewLanguage, valueLabel, type Copy } from "./teach-ai-professional-field-review-labels";
import { createFieldReviewController, decisionPayload, initialFieldReviewView, mountsFieldReview, type FieldReviewController, type FieldReviewView } from "./teach-ai-professional-field-review-logic";
import type { DecisionDto, FieldDecision, FieldDto } from "./teach-ai-professional-field-review-types";

const control = "min-h-11 min-w-0 max-w-full rounded border border-border p-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
function decisionLabel(decision: string, copy: Copy) {
  return ["CONFIRMED", "CORRECTED", "UNKNOWN", "REJECTED"].includes(decision) ? copy[decision as FieldDecision] : copy.decisions;
}
function DecisionText({ row, field, language }: { row: DecisionDto; field: FieldDto; language: string }) {
  const copy = copyFor(language);
  return <div className="space-y-1">
    <p>{decisionLabel(row.decision, copy)}{row.professionalValue !== null ? ` · ${valueLabel(field.field, row.professionalValue, language)}` : ""}</p>
    {row.note !== null ? <p dir="auto" className="whitespace-pre-wrap">{row.note}</p> : null}
    <time dateTime={row.createdAt}>{new Intl.DateTimeFormat(reviewLanguage(language), { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.createdAt))}</time>
  </div>;
}
function History({ field, language }: { field: FieldDto; language: string }) {
  const copy = copyFor(language);
  return <details className="min-w-0">
    <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2">{copy.history}</summary>
    <ol className="space-y-3">{[...field.history].sort((a, b) => b.revision - a.revision).map(row => <li key={row.revision} className="border-t border-border py-2">
      <p>{copy.revision} {row.revision}</p><DecisionText row={row} field={field} language={language} />
    </li>)}</ol>
    {field.historyTruncated ? <p>{copy.older}</p> : null}
  </details>;
}
function FieldCard({ field, view, controller, language, readOnly }: { field: FieldDto; view: FieldReviewView; controller: Pick<FieldReviewController, "edit" | "save">; language: string; readOnly: boolean }) {
  const id = useId();
  const copy = copyFor(language);
  const form = view.forms[field.field];
  const candidate = field.review.reviewable ? field.review.candidate : null;
  const error = view.errors[field.field];
  const pending = Boolean(view.pending[field.field]);
  const locked = pending || Boolean(view.needsRefresh[field.field]);
  const editable = candidate && field.actions.canSubmit && !readOnly && form;
  if (!field.review.reviewable && !field.latest && field.history.length === 0) {
    const reason = field.review.reason as "ABSENT" | "EXTRACTION_UNKNOWN" | "NO_OBSERVATION" | "INVALID_OBSERVATION";
    return <div className="min-w-0 rounded-md border border-border p-3 [overflow-wrap:anywhere]">
      <h4 className="font-medium">{copy[field.field]}</h4><p>{copy[reason] ?? copy.INVALID_OBSERVATION}</p>
    </div>;
  }
  return <article className="min-w-0 space-y-3 rounded-md border border-border p-3 [overflow-wrap:anywhere]" aria-labelledby={`${id}-heading`}>
    <h4 id={`${id}-heading`} className="font-semibold">{copy[field.field]}</h4>
    {field.authority === "STALE" ? <Alert variant="warning">{copy.STALE}</Alert> : <p className="w-fit rounded border border-border px-2 py-1 font-medium">{copy[field.authority]}</p>}
    {candidate ? <>
      <p>{copy.ai}: <span dir="auto" className="whitespace-pre-wrap">{typeof candidate.observation.value === "string" && candidate.observation.value.trim() ? candidate.observation.value : candidate.observation.rawObservation ?? ""}</span></p>
      {candidate.resolution === "CANONICAL" && candidate.normalizedValue !== null ? <p>{copy.interpretation}: {valueLabel(field.field, candidate.normalizedValue, language)}</p> : null}
    </> : <p>{copy[(field.review as { reason: string }).reason as "ABSENT" | "EXTRACTION_UNKNOWN" | "NO_OBSERVATION" | "INVALID_OBSERVATION"] ?? copy.INVALID_OBSERVATION}</p>}
    {field.latest ? <div className="space-y-1 border-l-2 border-border pl-3">
      <p className="font-medium">{field.authority === "STALE" ? copy.staleLatest : copy.CURRENT}</p>
      <DecisionText row={field.latest} field={field} language={language} />
    </div> : null}
    {!field.actions.canSubmit && candidate ? <p>{field.actions.blockedReason ? copy[errorCopy(409, field.actions.blockedReason)] : copy.blocked}</p> : null}
    {readOnly ? <p>{copy.historical}</p> : null}
    {form?.reset ? <p role="status">{copy.reset}</p> : null}
    {editable ? <form onSubmit={event => { event.preventDefault(); void controller.save(field.field); }} className="min-w-0 space-y-3">
      <fieldset disabled={locked} aria-describedby={error ? `${id}-error` : undefined} className="min-w-0 space-y-2">
        <legend className="font-medium">{copy.decisions}</legend>
        {field.actions.allowedDecisions.map(decision => <label key={decision} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2">
          <input type="radio" name={`${id}-decision`} value={decision} checked={form.decision === decision} onChange={() => controller.edit(field.field, { decision })} className="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2" />
          <span>{copy[decision]}</span>
        </label>)}
        {form.decision === "CORRECTED" ? <div className="min-w-0 space-y-2">
          <label htmlFor={`${id}-value`} className="block">{copy.value}</label>
          <select id={`${id}-value`} value={form.correctedValue} onChange={event => controller.edit(field.field, { correctedValue: event.target.value })} className={`${control} w-full`} aria-describedby={`${id}-judgment${error ? ` ${id}-error` : ""}`}>
            <option value="">{copy.choose}</option>
            {field.specification.allowedValues.map(value => <option key={value} value={value}>{valueLabel(field.field, value, language)}</option>)}
          </select>
          <p id={`${id}-judgment`}>{copy.judgment}</p>
        </div> : null}
        <label htmlFor={`${id}-note`} className="block">{copy.note}</label>
        <textarea id={`${id}-note`} dir="auto" value={form.note} maxLength={1000} rows={3} onChange={event => controller.edit(field.field, { note: event.target.value })} className={`${control} w-full`} aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`} />
        <p id={`${id}-count`}>{form.note.length} / 1000</p>
        <button type="submit" disabled={!decisionPayload(field, form)} className={control}>{copy.save}</button>
      </fieldset>
    </form> : null}
    {pending ? <p role="status">{copy.saving}</p> : null}
    {error ? <div id={`${id}-error`}><Alert variant="error">{copy[error]}</Alert></div> : null}
    {view.notices[field.field] ? <p role="status">{copy[view.notices[field.field]!]}</p> : null}
    {candidate ? <details className="min-w-0">
      <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2">{copy.details}</summary>
      <p>{copy.source}: <span dir="auto">{candidate.observation.source}</span></p>
      {candidate.observation.confidence !== undefined ? <p>{copy.confidence}: {candidate.observation.confidence}</p> : null}
      {candidate.observation.rawObservation ? <p>{copy.raw}: <span dir="auto" className="whitespace-pre-wrap">{candidate.observation.rawObservation}</span></p> : null}
      {candidate.observation.note ? <p dir="auto" className="whitespace-pre-wrap">{candidate.observation.note}</p> : null}
    </details> : null}
    <History field={field} language={language} />
  </article>;
}

// Separate view enables deterministic rendering and local browser fixtures without
// an authenticated database or any production mutations.
export function ProfessionalFieldReviewView({ view, controller, language, readOnly = false }: { view: FieldReviewView; controller: Pick<FieldReviewController, "edit" | "save" | "refresh">; language: string; readOnly?: boolean }) {
  const copy = copyFor(language);
  const fields = view.data?.fields ?? [];
  const reviewable = fields.filter(field => field.review.reviewable);
  const reviewed = reviewable.filter(field => field.authority === "CURRENT").length;
  return <section className="mt-3 min-w-0 space-y-3 text-sm [overflow-wrap:anywhere]" aria-label={copy.heading}>
    <h3 className="font-semibold">{copy.heading}</h3>
    {view.loading ? <p role="status">{copy.loading}</p> : null}
    {view.error ? <div><Alert variant="error">{copy[view.error]}</Alert><button type="button" className={control} onClick={() => void controller.refresh()}>{copy.retry}</button></div> : null}
    {view.data && reviewable.length === 0 ? <p>{copy.empty}</p> : null}
    {reviewable.length > 0 ? <p>{reviewed} {copy.reviewed} · {reviewable.length - reviewed} {copy.needsReview} · {fields.length - reviewable.length} {copy.notReviewable}</p> : null}
    <div className="grid min-w-0 grid-cols-1 gap-3">{fields.filter(field => reviewable.length > 0 || field.latest || field.history.length > 0).map(field => <FieldCard key={field.field} field={field} view={view} controller={controller} language={language} readOnly={readOnly} />)}</div>
  </section>;
}
function MountedReview({ draftId, readOnly }: { draftId: string; readOnly: boolean }) {
  const { language } = useUiLanguage();
  const [view, setView] = useState(initialFieldReviewView);
  const controller = useRef<FieldReviewController | null>(null);
  useEffect(() => {
    const active = createFieldReviewController(draftId, (url, init) => fetch(url, init), setView, readOnly);
    controller.current = active;
    void active.refresh();
    return () => { active.dispose(); controller.current = null; };
  }, [draftId, readOnly]);
  return <ProfessionalFieldReviewView view={view} language={language} readOnly={readOnly} controller={{ edit: (field, patch) => controller.current?.edit(field, patch), save: async field => { await controller.current?.save(field); }, refresh: async () => { await controller.current?.refresh(); } }} />;
}
export function ProfessionalFieldReviewSection({ draftId, status }: { draftId: string; status: string }) {
  return mountsFieldReview(status) ? <MountedReview key={`${draftId}:${status}`} draftId={draftId} readOnly={status === "SUPERSEDED"} /> : null;
}
