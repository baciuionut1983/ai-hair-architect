import { describe, expect, it } from "vitest";

import { shouldShowConfirmConflictMessage } from "./proposed-look-section-logic";
import type { ProposedLookActionOutcome } from "./use-proposed-look";

describe("shouldShowConfirmConflictMessage", () => {
  it("returns the message for a 409 ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT failure", () => {
    const outcome: ProposedLookActionOutcome = {
      ok: false,
      status: 409,
      code: "ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT",
      message: "Another proposal was confirmed while this draft was open. Review the current confirmed look, then try again.",
    };

    expect(shouldShowConfirmConflictMessage(outcome)).toBe(
      "Another proposal was confirmed while this draft was open. Review the current confirmed look, then try again.",
    );
  });

  it("returns null for a successful outcome", () => {
    const outcome = { ok: true, proposal: {} } as unknown as ProposedLookActionOutcome;

    expect(shouldShowConfirmConflictMessage(outcome)).toBeNull();
  });

  it("returns null for a 409 with a different error code", () => {
    const outcome: ProposedLookActionOutcome = {
      ok: false,
      status: 409,
      code: "PROPOSAL_ILLEGAL_STATE_TRANSITION",
      message: "This proposal is no longer a draft, so it can't be changed.",
    };

    expect(shouldShowConfirmConflictMessage(outcome)).toBeNull();
  });

  it("returns null for the conflict code carried on a non-409 status", () => {
    const outcome: ProposedLookActionOutcome = {
      ok: false,
      status: 500,
      code: "ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT",
      message: "Something went wrong. Please try again.",
    };

    expect(shouldShowConfirmConflictMessage(outcome)).toBeNull();
  });

  it("returns null for a 409 with no error code at all", () => {
    const outcome: ProposedLookActionOutcome = {
      ok: false,
      status: 409,
      message: "Something went wrong. Please try again.",
    };

    expect(shouldShowConfirmConflictMessage(outcome)).toBeNull();
  });

  it("returns null for a network-failure outcome", () => {
    const outcome: ProposedLookActionOutcome = {
      ok: false,
      status: 0,
      message: "Something went wrong. Please try again.",
    };

    expect(shouldShowConfirmConflictMessage(outcome)).toBeNull();
  });
});
