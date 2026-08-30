import { describe, expect, it } from "vitest";

import type { SpatialBindingActionOutcome } from "./use-spatial-binding";
import { shouldShowSpatialBindingConfirmConflictMessage } from "./spatial-binding-section-logic";

describe("shouldShowSpatialBindingConfirmConflictMessage", () => {
  it("31. returns the message for exactly the 409 confirmation-conflict outcome", () => {
    const outcome: SpatialBindingActionOutcome = {
      ok: false,
      status: 409,
      code: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMATION_CONFLICT",
      message: "Another spatial map was confirmed for this image and view while this draft was open.",
    };
    expect(shouldShowSpatialBindingConfirmConflictMessage(outcome)).toBe(outcome.message);
  });

  it("returns null for a success outcome", () => {
    const outcome: SpatialBindingActionOutcome = { ok: true, binding: {} as never };
    expect(shouldShowSpatialBindingConfirmConflictMessage(outcome)).toBeNull();
  });

  it("34. returns null for the parent-map-ineligible 409 -- a real error, not a recoverable race", () => {
    const outcome: SpatialBindingActionOutcome = {
      ok: false,
      status: 409,
      code: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_INELIGIBLE",
      message: "parent map no longer confirmed",
    };
    expect(shouldShowSpatialBindingConfirmConflictMessage(outcome)).toBeNull();
  });

  it("returns null for a non-409 failure", () => {
    const outcome: SpatialBindingActionOutcome = { ok: false, status: 404, message: "not found" };
    expect(shouldShowSpatialBindingConfirmConflictMessage(outcome)).toBeNull();
  });
});
