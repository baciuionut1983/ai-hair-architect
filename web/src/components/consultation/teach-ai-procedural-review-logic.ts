import type { ProceduralClaimReviewDecision, ProceduralReviewState } from "@/lib/professional-learning-procedural-review-validators";
import { isValidProceduralReviewState } from "@/lib/professional-learning-procedural-review-validators";
import { classifyDraftAnalysisResponse, extractionErrorLabel } from "./teach-ai-learning-draft-review-logic";
import type { LearningDraft, ReviewableClaim } from "./teach-ai-procedural-review-types";

// Teach the AI deliberately keeps Romanian copy local, outside global i18n.
export const reviewCopy = {
  heading: "Revizuire profesională a afirmațiilor",
  ai: "AI a dedus",
  scope: "Confirmarea se referă doar la această afirmație, nu la întreaga tehnică.",
  professional: "Decizia profesionistului",
  correction: "Corecția profesionistului",
  note: "Notă (opțional)",
  unreviewed: "Fără revizuire profesională",
  edit: "Modifică revizuirea",
  cancel: "Anulează modificarea",
  save: "Salvează corecția",
  saving: "Se salvează…",
  loading: "Se încarcă…",
  approve: "Aprobă interpretarea",
  rejectDraft: "Respinge interpretarea",
  beforeApproval: "Revizuirea afirmațiilor devine disponibilă după aprobarea interpretării.",
  historical: "Această interpretare este disponibilă doar pentru consultare.",
  empty: "Nu există afirmații disponibile pentru revizuire în această interpretare.",
  required: "Introdu corecția profesională înainte de salvare.",
  saved: "Revizuirea afirmației a fost salvată.",
  stale: "Revizuirea a fost modificată între timp. Am încărcat versiunea actuală. Verifică schimbările și repetă modificarea dacă mai este necesară.",
  staleUnavailable: "Revizuirea a fost modificată între timp. Versiunea actuală nu a putut fi încărcată. Reîncarcă înainte de a modifica din nou.",
  reload: "Reîncarcă versiunea actuală",
  refreshFailed: "Versiunea actuală nu a putut fi încărcată. Reîncarcă înainte de a continua.",
  invalid: "Verifică informațiile introduse și încearcă din nou.",
  session: "Sesiunea a expirat sau nu mai este disponibilă. Autentifică-te din nou.",
  unavailable: "Afirmația sau interpretarea nu mai este disponibilă ori nu ai acces la ea.",
  lifecycle: "Starea interpretării s-a schimbat. Verifică versiunea actuală înainte de a continua.",
  failed: "Modificarea nu a putut fi salvată. Informațiile afișate au fost păstrate. Poți încerca din nou.",
  actions: {
    PROFESSIONALLY_CONFIRMED: "Confirmă",
    PROFESSIONALLY_CORRECTED: "Corectează",
    PROFESSIONALLY_REJECTED: "Respinge afirmația",
    PROFESSIONALLY_UNKNOWN: "Nu se poate stabili",
  },
  results: {
    PROFESSIONALLY_CONFIRMED: "Afirmație confirmată profesional",
    PROFESSIONALLY_CORRECTED: "Afirmație corectată profesional",
    PROFESSIONALLY_REJECTED: "Afirmație respinsă profesional",
    PROFESSIONALLY_UNKNOWN: "Nu se poate stabili din dovezile disponibile",
  },
};

const actionLabels: Record<string, string> = { COMBING: "Pieptănare", CUTTING_ACTION: "Acțiune de tăiere", CUTTING: "Tăiere", SECTIONING: "Separarea secțiunilor", ELEVATION: "Elevație", OVERDIRECTION: "Supradirecționare" };

export function claimView(claim: ReviewableClaim, review: ProceduralReviewState | null) {
  const entry = review && Object.hasOwn(review.claims, claim.claimId) ? review.claims[claim.claimId] : undefined;
  return {
    claimId: claim.claimId,
    aiStatement: `${actionLabels[claim.originalValue.kind] ?? claim.originalValue.kind}: ${claim.originalValue.occurrenceCount} apariții în material.`,
    decision: entry?.decision,
    professionalResult: entry ? reviewCopy.results[entry.decision] : reviewCopy.unreviewed,
    correctedValue: entry?.decision === "PROFESSIONALLY_CORRECTED" ? entry.correctedValue : undefined,
    note: entry?.note,
  };
}

export function canReanalyze(status: string) { return status === "DRAFT" || status === "READY_FOR_REVIEW"; }
export function canEditClaim(status: string, reviewed: boolean, explicitEdit: boolean, locked: boolean) {
  return status === "APPROVED" && !locked && (!reviewed || explicitEdit);
}

export function mergeReview(draft: LearningDraft, update: Pick<LearningDraft, "id" | "proceduralReview" | "proceduralReviewRevision">): LearningDraft {
  if (!update || update.id !== draft.id || !Number.isInteger(update.proceduralReviewRevision) || update.proceduralReviewRevision < draft.proceduralReviewRevision || (update.proceduralReview !== null && !isValidProceduralReviewState(update.proceduralReview))) throw new Error(reviewCopy.failed);
  // POST is deliberately incomplete: never replace GET hydration with it.
  return { ...draft, proceduralReview: update.proceduralReview, proceduralReviewRevision: update.proceduralReviewRevision };
}

export interface ReviewViewState {
  draft: LearningDraft | null;
  busy: boolean;
  expanded: boolean;
  error: string | null;
  notice: string | null;
  skipped: string | null;
  refreshRequired: boolean;
  editEpoch: number;
}
export const initialReviewState: ReviewViewState = { draft: null, busy: false, expanded: false, error: null, notice: null, skipped: null, refreshRequired: false, editEpoch: 0 };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
class RequestFailure extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(status === 401 ? reviewCopy.session : status === 404 ? reviewCopy.unavailable : status === 400 ? reviewCopy.invalid : status === 409 ? reviewCopy.lifecycle : reviewCopy.failed);
  }
}
const message = (error: unknown) => error instanceof RequestFailure || (error instanceof Error && Object.values(reviewCopy).some(value => value === error.message)) ? error.message : reviewCopy.failed;

function hydrated(value: LearningDraft): LearningDraft {
  if (!value || typeof value.id !== "string" || !Array.isArray(value.reviewableProceduralClaims) || !Number.isInteger(value.proceduralReviewRevision) || value.proceduralReviewRevision < 0 || !Object.hasOwn(value, "proceduralInterpretation") || (value.proceduralReview !== null && !isValidProceduralReviewState(value.proceduralReview))) throw new Error(reviewCopy.refreshFailed);
  return value;
}

// One controller per evidence card. busy changes synchronously, before fetch or
// React rendering, so rapid clicks across different claims cannot race a revision.
// All network effects are injected; tests exercise the same orchestration as UI.
export function createReviewController(fetcher: Fetcher, publish: (state: ReviewViewState) => void) {
  let state = { ...initialReviewState };
  let refreshId: string | null = null;
  const set = (patch: Partial<ReviewViewState>) => { state = { ...state, ...patch }; publish(state); };
  const start = () => {
    if (state.busy) return false;
    set({ busy: true, expanded: true, error: null, notice: null, skipped: null });
    return true;
  };
  const request = async (url: string, payload?: object) => {
    const response = await fetcher(url, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new RequestFailure(response.status, body?.error);
    if (!body) throw new Error(reviewCopy.failed);
    return body;
  };
  const refetch = async (id: string) => {
    refreshId = id;
    const body = await request(`/api/v1/learning-drafts/${encodeURIComponent(id)}`);
    const draft = hydrated(body.draft);
    if (draft.id !== id) throw new Error(reviewCopy.refreshFailed);
    set({ draft, refreshRequired: false, editEpoch: state.editEpoch + 1 });
  };
  const recover = async (id: string, error: unknown) => {
    const stale = error instanceof RequestFailure && error.code === "CONCURRENT_MODIFICATION";
    set({ refreshRequired: true, editEpoch: state.editEpoch + 1 });
    try {
      await refetch(id);
      set(stale ? { notice: reviewCopy.stale, error: null } : { error: message(error) });
    } catch (refreshError) {
      set({ error: `${stale ? reviewCopy.staleUnavailable : message(error)} ${message(refreshError)}`, refreshRequired: true });
    }
  };
  return {
    getState: () => state,
    async refresh() {
      const id = refreshId ?? state.draft?.id;
      if (!id || !start()) return;
      try { await refetch(id); } catch (error) { set({ error: message(error), refreshRequired: true }); }
      finally { set({ busy: false }); }
    },
    async analyze(evidenceId: string) {
      if (state.refreshRequired || (state.draft && !canReanalyze(state.draft.status)) || !start()) return;
      const url = `/api/v1/learning-evidence/${encodeURIComponent(evidenceId)}/drafts`;
      try {
        if (!state.draft) {
          const body = await request(url);
          if (!Array.isArray(body.drafts)) throw new Error(reviewCopy.refreshFailed);
          // Server orders newest first. Prefer its non-superseded current record;
          // if only history exists, render it read-only instead of invoking AI.
          const existing = body.drafts.find((d: LearningDraft) => d.status !== "SUPERSEDED") ?? body.drafts[0];
          if (existing) { set({ draft: hydrated(existing) }); return; }
        }
        const body = await request(url, { mode: state.draft ? "REANALYZE" : "ANALYZE" });
        const outcome = classifyDraftAnalysisResponse(true, body);
        if (outcome.kind === "error") throw new Error(outcome.message);
        if (outcome.kind === "skipped") { set({ skipped: outcome.reason }); return; }
        const id = body.draft?.id;
        if (typeof id !== "string") throw new Error(reviewCopy.refreshFailed);
        set({ refreshRequired: true });
        await refetch(id);
      } catch (error) {
        if (error instanceof RequestFailure && error.status === 409 && state.draft) await recover(state.draft.id, error);
        else set({ error: error instanceof RequestFailure && error.code && error.status >= 500 ? extractionErrorLabel(error.code) : message(error) });
      }
      finally { set({ busy: false }); }
    },
    async review(decision: "APPROVED" | "REJECTED") {
      let draft = state.draft;
      if (!draft || !canReanalyze(draft.status) || state.refreshRequired || !start()) return;
      const id = draft.id;
      const base = `/api/v1/learning-drafts/${encodeURIComponent(id)}`;
      try {
        if (draft.status === "DRAFT") {
          const body = await request(`${base}/ready-for-review`, {});
          if (body.draft?.id !== id || body.draft.status !== "READY_FOR_REVIEW") throw new Error(reviewCopy.failed);
          draft = { ...draft, status: body.draft.status };
          set({ draft });
        }
        const body = await request(`${base}/review`, { decision });
        if (body.draft?.id !== id || body.draft.status !== decision) throw new Error(reviewCopy.failed);
        // Confirmed lifecycle is visible, but procedural mutations wait for GET.
        set({ draft: { ...draft, status: body.draft.status }, refreshRequired: true });
        await refetch(id);
      } catch (error) { await recover(id, error); }
      finally { set({ busy: false }); }
    },
    async save(claimId: string, decision: ProceduralClaimReviewDecision, correctedValue?: string, note?: string) {
      const draft = state.draft;
      if (!draft || draft.status !== "APPROVED" || state.refreshRequired || !draft.reviewableProceduralClaims.some(claim => claim.claimId === claimId) || state.busy) return false;
      if (decision === "PROFESSIONALLY_CORRECTED" && !correctedValue?.trim()) { set({ error: reviewCopy.required }); return false; }
      if (!start()) return false;
      try {
        const body = await request(`/api/v1/learning-drafts/${encodeURIComponent(draft.id)}/procedural-review`, {
          claimId, decision, expectedProceduralReviewRevision: draft.proceduralReviewRevision,
          ...(decision === "PROFESSIONALLY_CORRECTED" ? { correctedValue } : {}), ...(note !== undefined ? { note } : {}),
        });
        set({ draft: mergeReview(draft, body.draft), notice: reviewCopy.saved });
        return true;
      } catch (error) {
        if (error instanceof RequestFailure && (error.status === 409 || error.status === 404)) await recover(draft.id, error);
        else set({ error: message(error) });
        return false;
      } finally { set({ busy: false }); }
    },
  };
}
