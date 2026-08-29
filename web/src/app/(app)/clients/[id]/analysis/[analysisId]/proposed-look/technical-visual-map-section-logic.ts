import type { TechnicalVisualMapActionOutcome } from "./use-technical-visual-map";

// Technical Visual Map, Stage 4 -- the single, named, tested definition of
// "is this action outcome the confirm-time optimistic-concurrency conflict?".
// Mirrors proposed-look-section-logic.ts's shouldShowConfirmConflictMessage
// exactly: technical-visual-map-section.tsx uses this instead of inlining
// the condition, so the exact rule has exactly one home.
//
// Returns the outcome's message when it is the 409
// TECHNICAL_VISUAL_MAP_CONFIRMATION_CONFLICT failure the confirm endpoint
// emits, and `null` for every other outcome shape -- a success, a different
// error code, or a different status. Deliberately NOT true for any other 409
// (e.g. TECHNICAL_VISUAL_MAP_ILLEGAL_STATE_TRANSITION), which is a real
// error, not an expected, recoverable race.
export function shouldShowTechnicalVisualMapConfirmConflictMessage(outcome: TechnicalVisualMapActionOutcome): string | null {
  if (!outcome.ok && outcome.status === 409 && outcome.code === "TECHNICAL_VISUAL_MAP_CONFIRMATION_CONFLICT") {
    return outcome.message;
  }
  return null;
}
