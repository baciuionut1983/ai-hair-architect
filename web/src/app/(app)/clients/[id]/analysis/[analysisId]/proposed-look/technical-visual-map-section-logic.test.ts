import { describe, expect, it } from "vitest";

import type { TechnicalVisualMapActionOutcome } from "./use-technical-visual-map";
import { shouldShowTechnicalVisualMapConfirmConflictMessage } from "./technical-visual-map-section-logic";

describe("shouldShowTechnicalVisualMapConfirmConflictMessage", () => {
  it("23. returns the message for exactly the 409 confirmation-conflict outcome", () => {
    const outcome: TechnicalVisualMapActionOutcome = {
      ok: false,
      status: 409,
      code: "TECHNICAL_VISUAL_MAP_CONFIRMATION_CONFLICT",
      message: "Another map was confirmed for this proposal while this draft was open.",
    };
    expect(shouldShowTechnicalVisualMapConfirmConflictMessage(outcome)).toBe(outcome.message);
  });

  it("returns null for a success outcome", () => {
    const outcome: TechnicalVisualMapActionOutcome = {
      ok: true,
      map: {} as never,
      effectiveMap: {} as never,
    };
    expect(shouldShowTechnicalVisualMapConfirmConflictMessage(outcome)).toBeNull();
  });

  it("returns null for a different 409 (illegal state transition is a real error, not a recoverable race)", () => {
    const outcome: TechnicalVisualMapActionOutcome = {
      ok: false,
      status: 409,
      code: "TECHNICAL_VISUAL_MAP_ILLEGAL_STATE_TRANSITION",
      message: "This map is no longer a draft.",
    };
    expect(shouldShowTechnicalVisualMapConfirmConflictMessage(outcome)).toBeNull();
  });

  it("returns null for a non-409 failure", () => {
    const outcome: TechnicalVisualMapActionOutcome = {
      ok: false,
      status: 404,
      code: "Technical Visual Map not found.",
      message: "This technical visual map is no longer available.",
    };
    expect(shouldShowTechnicalVisualMapConfirmConflictMessage(outcome)).toBeNull();
  });
});
