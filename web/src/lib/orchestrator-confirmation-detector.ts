// AI Concierge / Orchestrator, Stage 4 -- a deliberately tiny, deterministic
// (never AI-backed) detector for a BARE yes/no reply (task section 4:
// "Bare confirmation words depend on context... may confirm a
// PRESENTATIONAL next step only if there is exactly one safe pending
// decision"). This is intentionally NOT a substring/keyword match like
// orchestrator-intent-classifier.ts's own style -- a safety-relevant binary
// decision (does this message accept or decline a pending, possibly
// cost-adjacent offer?) requires the WHOLE message to be a short,
// unambiguous confirmation word, never a word merely appearing somewhere
// inside a longer, unrelated sentence. "Da, dar nu acum." must NOT be
// treated as a bare yes.
//
// Token lists are hand-picked to match this app's own real UI copy
// (concierge.videoOffer.yes/no in translations.ts, every one of the 18
// supported languages) plus a small number of extremely common informal
// synonyms explicitly named in the task's own examples ("Hai", "Ok").
// Deliberately does NOT attempt to cover every possible phrasing in every
// language -- an unrecognized reply simply returns null and falls through
// to normal classification (task section 9's own "don't force a decision"
// principle), which is always the safe direction here.
export type BareConfirmation = "yes" | "no";

const YES_TOKENS = new Set([
  "yes", "yeah", "yep", "ok", "okay", "sure", // English (+ common informal)
  "da", "hai", // Romanian ("Da" + the task's own colloquial "Hai" example)
  "نعم", // Arabic
  "sì", "si", // Italian (accented + the commonly-typed unaccented form)
  "oui", // French
  "ja", // German / Dutch
  "sí", // Spanish
  "sim", // Portuguese
  "tak", // Polish
  "evet", // Turkish
  "ναι", // Greek
  "כן", // Hebrew
  "はい", // Japanese
  "예", "네", // Korean (+ the other extremely common informal yes)
  "是", // Chinese (Simplified/Traditional share this glyph)
  "हाँ", // Hindi
]);

const NO_TOKENS = new Set([
  "no", "nope", "nah", // English
  "nu", // Romanian
  "لا", // Arabic
  "non", // French
  "nein", // German
  "não", "nao", // Portuguese (accented + the commonly-typed unaccented form)
  "nee", // Dutch
  "nie", // Polish
  "hayır", // Turkish
  "όχι", // Greek
  "לא", // Hebrew
  "いいえ", // Japanese
  "아니요", "아니", // Korean
  "否", // Chinese
  "नहीं", // Hindi
]);

// Strips trailing sentence punctuation only (never internal punctuation --
// this must stay a WHOLE-message match, not a fuzzy one) and normalizes
// whitespace/case before comparing against the closed token sets above.
function normalize(message: string): string {
  return message.trim().toLowerCase().replace(/[.!?,;:\s]+$/g, "");
}

export function detectBareConfirmation(message: string): BareConfirmation | null {
  const normalized = normalize(message);
  if (normalized.length === 0) return null;
  if (YES_TOKENS.has(normalized)) return "yes";
  if (NO_TOKENS.has(normalized)) return "no";
  return null;
}
