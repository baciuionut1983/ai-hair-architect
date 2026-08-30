import type { SpatialBindingActionOutcome } from "./use-spatial-binding";

// Technical Visual Map, Stage 5C -- the single, named, tested definition of
// "is this action outcome the confirm-time optimistic-concurrency
// conflict?". Mirrors technical-visual-map-section-logic.ts's own
// shouldShowTechnicalVisualMapConfirmConflictMessage exactly.
export function shouldShowSpatialBindingConfirmConflictMessage(outcome: SpatialBindingActionOutcome): string | null {
  if (!outcome.ok && outcome.status === 409 && outcome.code === "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMATION_CONFLICT") {
    return outcome.message;
  }
  return null;
}
