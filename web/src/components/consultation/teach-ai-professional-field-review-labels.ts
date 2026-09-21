import { CUT_ELEVATION_OPTIONS, CUT_SECTIONING_OPTIONS, CUT_GUIDELINE_OPTIONS } from "@/lib/analysis-field-options";
import type { ReviewField } from "./teach-ai-professional-field-review-types";

export const en = {
  heading: "Technical field review", ai: "AI observed", interpretation: "Canonical interpretation", decisions: "Professional decision",
  elevation: "Elevation", sectioning: "Sectioning", guideType: "Cutting guide",
  CONFIRMED: "Confirm", CORRECTED: "Correct", UNKNOWN: "Cannot determine", REJECTED: "Reject observation",
  NONE: "No professional decision", CURRENT: "Current decision", STALE: "Needs re-review", staleLatest: "Latest decision (no longer current)",
  ABSENT: "AI did not observe this aspect.", EXTRACTION_UNKNOWN: "AI marked this aspect as undetermined.",
  NO_OBSERVATION: "There is no observation to review.", INVALID_OBSERVATION: "This observation cannot be reviewed here.",
  empty: "There are no reviewable technical fields in this interpretation.",
  choose: "Choose a value…", value: "Professional value", judgment: "Choose a value only if it reflects your professional judgment. AI is not automatically suggesting a value.",
  note: "Professional note (optional)", save: "Save decision", saving: "Saving…", loading: "Loading…", retry: "Reload",
  history: "History", revision: "Revision", older: "Older decisions also exist and are not shown here.",
  details: "AI details", source: "Source", confidence: "AI extraction confidence", raw: "Raw observation",
  reviewed: "reviewed", needsReview: "needs review", notReviewable: "not reviewable", historical: "This interpretation is read-only.",
  changed: "The review state changed. Review the refreshed information and choose again.", saved: "Decision saved. The latest server state is displayed.",
  observationChanged: "The AI observation changed or is unavailable.", specificationChanged: "The professional specification changed.",
  superseded: "A newer interpretation replaced this one.", notApproved: "This interpretation is not currently approved.", sourceUnavailable: "The source material is unavailable.",
  invalid: "Check the entered information.", session: "Check your session and reload before retrying.", unavailable: "This review is unavailable or you do not have access.",
  unsent: "The request could not be sent.", rate: "Please wait before retrying.", temporary: "Temporarily unavailable. Please reload or try again.",
  blocked: "Review is currently read-only.", reset: "The source or decision changed. Your unsaved choice was reset.",
};
export type Copy = { readonly [K in keyof typeof en]: string };
export const ro: Copy = {
  heading: "Revizuirea câmpurilor tehnice", ai: "AI a observat", interpretation: "Interpretare canonică", decisions: "Decizie profesională",
  elevation: "Elevație", sectioning: "Împărțire (secționare)", guideType: "Ghid de tăiere",
  CONFIRMED: "Confirmă", CORRECTED: "Corectează", UNKNOWN: "Nu se poate stabili", REJECTED: "Respinge observația",
  NONE: "Fără decizie profesională", CURRENT: "Decizia curentă", STALE: "Necesită revizuire nouă", staleLatest: "Ultima decizie (nu mai este curentă)",
  ABSENT: "AI nu a observat acest aspect.", EXTRACTION_UNKNOWN: "AI a marcat acest aspect ca nedeterminat.",
  NO_OBSERVATION: "Nu există o observație de revizuit.", INVALID_OBSERVATION: "Observația nu poate fi revizuită aici.",
  empty: "Nu există câmpuri tehnice de revizuit în această interpretare.",
  choose: "Alege valoarea…", value: "Valoare profesională", judgment: "Alege o valoare numai dacă aceasta este judecata ta profesională. AI nu sugerează automat o valoare.",
  note: "Notă profesională (opțional)", save: "Salvează decizia", saving: "Se salvează…", loading: "Se încarcă…", retry: "Reîncarcă",
  history: "Istoric", revision: "Revizie", older: "Există și decizii mai vechi care nu sunt afișate aici.",
  details: "Detalii AI", source: "Sursă", confidence: "Încredere AI pentru extragere", raw: "Observație originală",
  reviewed: "revizuite", needsReview: "necesită revizuire", notReviewable: "nerevizuibile", historical: "Această interpretare poate fi doar consultată.",
  changed: "Starea revizuirii s-a schimbat. Verifică informațiile reîncărcate și alege din nou.", saved: "Decizia a fost salvată. Este afișată starea actuală de pe server.",
  observationChanged: "Observația AI s-a schimbat sau nu este disponibilă.", specificationChanged: "Specificația profesională s-a schimbat.",
  superseded: "O interpretare mai nouă a înlocuit-o pe aceasta.", notApproved: "Interpretarea nu este aprobată în prezent.", sourceUnavailable: "Materialul sursă nu este disponibil.",
  invalid: "Verifică informațiile introduse.", session: "Verifică sesiunea și reîncarcă înainte de a reîncerca.", unavailable: "Revizuirea nu este disponibilă sau nu ai acces.",
  unsent: "Cererea nu a putut fi trimisă.", rate: "Așteaptă înainte de a reîncerca.", temporary: "Indisponibil temporar. Reîncarcă sau încearcă din nou.",
  blocked: "Revizuirea poate fi doar consultată în prezent.", reset: "Sursa sau decizia s-a schimbat. Alegerea nesalvată a fost resetată.",
};
export const reviewLanguage = (language: string): "ro" | "en" => language === "ro" ? "ro" : "en";
export const copyFor = (language: string): Copy => reviewLanguage(language) === "ro" ? ro : en;
export const englishValues = { elevation: CUT_ELEVATION_OPTIONS, sectioning: CUT_SECTIONING_OPTIONS, guideType: CUT_GUIDELINE_OPTIONS };
export const romanianValues: Record<ReviewField, Readonly<Record<string, string>>> = {
  elevation: { "0_deg_blunt": "0° tăiere dreaptă", "45_deg_graduation": "45° graduare", "90_deg_uniform_layer": "90° straturi uniforme", "135_deg_long_layer": "135° straturi lungi", "180_deg_overdirection": "180° supradirecționare" },
  sectioning: { "4_quadrant_profile_radial": "4 cadrane cu profil radial", horseshoe_crown: "Potcoavă în zona creștetului", diagonal_back: "Diagonal spre spate", pivot_radial: "Pivot radial", horseshoe_fringe: "Potcoavă în zona bretonului" },
  guideType: { stationary: "Fix", traveling: "Mobil", visual_perimeter: "Perimetru vizual", multiple_reference: "Referințe multiple" },
};
export function valueLabel(field: ReviewField, token: string, language: string): string {
  const english = englishValues[field].find(option => option.value === token)?.label;
  return (reviewLanguage(language) === "ro" && Object.hasOwn(romanianValues[field], token) ? romanianValues[field][token] : english) ?? token.replaceAll("_", " ");
}
export function errorCopy(status: number, code?: string): keyof Copy {
  const codes: Record<string, keyof Copy> = { REVISION_CONFLICT: "changed", OBSERVATION_DIGEST_MISMATCH: "observationChanged", SPEC_VERSION_CHANGED: "specificationChanged", VALUE_NOT_IN_CURRENT_SPEC: "specificationChanged", DRAFT_SUPERSEDED: "superseded", DRAFT_NOT_APPROVED: "notApproved", EVIDENCE_NOT_ACTIVE: "sourceUnavailable", EVIDENCE_SOURCE_DELETED: "sourceUnavailable" };
  if (code && Object.hasOwn(codes, code)) return codes[code];
  return status === 400 ? "invalid" : status === 401 || status === 403 ? "session" : status === 404 ? "unavailable" : status === 413 || status === 415 ? "unsent" : status === 429 ? "rate" : status === 409 ? "changed" : "temporary";
}
