import { isReviewDto, type FieldDto, type FieldDecision, type ReviewDto, type ReviewField } from "./teach-ai-professional-field-review-types";
import { errorCopy, type Copy } from "./teach-ai-professional-field-review-labels";

export interface FieldForm { key: string; decision: FieldDecision | ""; correctedValue: string; note: string; reset?: boolean }
export interface FieldReviewView {
  data: ReviewDto | null;
  loading: boolean;
  error: keyof Copy | null;
  forms: Partial<Record<ReviewField, FieldForm>>;
  pending: Partial<Record<ReviewField, boolean>>;
  needsRefresh: Partial<Record<ReviewField, boolean>>;
  errors: Partial<Record<ReviewField, keyof Copy>>;
  notices: Partial<Record<ReviewField, keyof Copy>>;
}
export const initialFieldReviewView: FieldReviewView = { data: null, loading: false, error: null, forms: {}, pending: {}, needsRefresh: {}, errors: {}, notices: {} };
export const mountsFieldReview = (status: string) => status === "APPROVED" || status === "SUPERSEDED";
export function fieldKey(field: FieldDto): string {
  return JSON.stringify([field.field, field.review.reviewable ? field.review.candidate.pins.observationDigest : null, field.review.reviewable ? field.review.candidate.pins.specificationDigest : field.specification.digest, field.latestRevision]);
}
export function emptyForm(field: FieldDto): FieldForm { return { key: fieldKey(field), decision: "", correctedValue: "", note: "" }; }
export function reconcileForms(fields: readonly FieldDto[], previous: FieldReviewView["forms"]): FieldReviewView["forms"] {
  return Object.fromEntries(fields.map(field => {
    const old = previous[field.field];
    return [field.field, old?.key === fieldKey(field) ? old : { ...emptyForm(field), reset: Boolean(old && (old.decision || old.note || old.correctedValue)) }];
  }));
}
export function decisionPayload(field: FieldDto, form: FieldForm) {
  if (!field.review.reviewable || !field.actions.canSubmit || form.key !== fieldKey(field) || !form.decision
    || !field.actions.allowedDecisions.includes(form.decision) || form.note.length > 1000 || (form.note !== "" && !form.note.trim())
    || (form.decision === "CORRECTED" && (!form.correctedValue || !field.specification.allowedValues.includes(form.correctedValue)))) return null;
  const pins = field.review.candidate.pins;
  return { expectedRevision: field.latestRevision, observationDigest: pins.observationDigest,
    specificationVersion: pins.specificationVersion, specificationDigest: pins.specificationDigest, decision: form.decision,
    ...(form.decision === "CORRECTED" ? { correctedValue: form.correctedValue } : {}), ...(form.note !== "" ? { note: form.note } : {}) };
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
// Independent synchronous POST locks, abortable/generation-ordered GETs. Authority
// only changes after aggregate GET; POST bodies and error messages are never rendered.
export function createFieldReviewController(draftId: string, fetcher: Fetcher, publish: (view: FieldReviewView) => void, readOnly = false) {
  let state: FieldReviewView = { ...initialFieldReviewView };
  let disposed = false;
  let generation = 0;
  let getAbort: AbortController | undefined;
  const posts = new Set<AbortController>();
  const set = (patch: Partial<FieldReviewView>) => { if (!disposed) { state = { ...state, ...patch }; publish(state); } };
  const base = `/api/v1/learning-drafts/${encodeURIComponent(draftId)}/professional-field-decisions`;
  const refresh = async () => {
    if (disposed) return;
    const current = ++generation;
    getAbort?.abort();
    const abort = new AbortController(); getAbort = abort;
    set({ loading: true, error: null });
    try {
      const response = await fetcher(base, { cache: "no-store", signal: abort.signal });
      const body: unknown = await response.json().catch(() => null);
      if (disposed || current !== generation) return;
      if (!response.ok) { set({ error: errorCopy(response.status) }); return; }
      if (!isReviewDto(body) || body.draftId !== draftId) { set({ error: "temporary" }); return; }
      set({ data: body, forms: reconcileForms(body.fields, state.forms), needsRefresh: {} });
    } catch { if (!disposed && current === generation) set({ error: "temporary" }); }
    finally { if (!disposed && current === generation) set({ loading: false }); }
  };
  return {
    getState: () => state,
    refresh,
    edit(field: ReviewField, patch: Partial<Pick<FieldForm, "decision" | "correctedValue" | "note">>) {
      const form = state.forms[field];
      if (disposed || readOnly || !form || state.pending[field] || state.needsRefresh[field]) return;
      set({ forms: { ...state.forms, [field]: { ...form, ...patch, ...(patch.decision !== undefined ? { correctedValue: "" } : {}), reset: false } }, errors: { ...state.errors, [field]: undefined }, notices: { ...state.notices, [field]: undefined } });
    },
    async save(name: ReviewField) {
      const field = state.data?.fields.find(f => f.field === name);
      const form = state.forms[name];
      if (disposed || readOnly || !field || !form || state.pending[name] || state.needsRefresh[name]) return;
      const payload = decisionPayload(field, form);
      if (!payload) { set({ errors: { ...state.errors, [name]: "invalid" } }); return; }
      const abort = new AbortController(); posts.add(abort);
      set({ pending: { ...state.pending, [name]: true }, errors: { ...state.errors, [name]: undefined }, notices: { ...state.notices, [name]: undefined } });
      try {
        const response = await fetcher(`${base}/${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: abort.signal });
        const body = await response.json().catch(() => null);
        if (disposed) return;
        if (response.status === 200 || response.status === 201 || response.status === 409) {
          // A conflict requires deliberate reselection even if the refreshed pins
          // happen to be identical. Failed refresh keeps this field locked.
          set({ forms: { ...state.forms, [name]: emptyForm(field) }, needsRefresh: { ...state.needsRefresh, [name]: true },
            notices: { ...state.notices, [name]: response.status === 409 ? "changed" : undefined },
            errors: { ...state.errors, [name]: response.status === 409 ? errorCopy(409, typeof body?.error === "string" ? body.error : undefined) : undefined } });
          await refresh();
          if (response.status !== 409 && !state.needsRefresh[name]) set({ notices: { ...state.notices, [name]: "saved" } });
        } else set({ errors: { ...state.errors, [name]: errorCopy(response.status, typeof body?.error === "string" ? body.error : undefined) } });
      } catch { set({ errors: { ...state.errors, [name]: "temporary" } }); }
      finally { posts.delete(abort); set({ pending: { ...state.pending, [name]: false } }); }
    },
    dispose() { disposed = true; generation++; getAbort?.abort(); posts.forEach(p => p.abort()); },
  };
}
export type FieldReviewController = ReturnType<typeof createFieldReviewController>;
