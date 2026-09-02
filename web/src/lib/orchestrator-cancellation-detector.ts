// AI Concierge / Orchestrator, Stage 5 -- a deliberately tiny,
// deterministic (never AI-backed) detector for a cancellation request
// (task section 11). Mirrors orchestrator-confirmation-detector.ts's own
// design exactly: a WHOLE-message match against a closed phrase list,
// never a substring match -- "Nu mai continua analiza asta, dar termină
// videoul." should not accidentally match. This is intentionally simpler
// than the confirmation detector (a boolean, not a yes/no split) and
// intentionally does not attempt exhaustive multi-language coverage --
// only the exact phrases the task itself names, plus their most common,
// unambiguous synonyms.
//
// A recognized cancellation NEVER reaches into Video/Photo Preview
// provider code (task section 11: "NOT cancel already-running provider
// operations unless an existing engine supports a real cancel operation" --
// no such capability is exposed to the Orchestrator, so this can only
// ever mean "stop the Concierge's own plan/pending-decision tracking,"
// never a real engine cancel).
const CANCELLATION_PHRASES = new Set([
  "stop", "stop it", "cancel", "cancel it", "never mind", "nevermind", // English
  "anulează", "anuleaza", "nu mai continua", "oprește", "opreste", "oprește-te", "opreste-te", "las-o baltă", "lasa balta", // Romanian
]);

function normalize(message: string): string {
  return message.trim().toLowerCase().replace(/[.!?,;:\s]+$/g, "");
}

export function detectCancellationRequest(message: string): boolean {
  const normalized = normalize(message);
  if (normalized.length === 0) return false;
  return CANCELLATION_PHRASES.has(normalized);
}
