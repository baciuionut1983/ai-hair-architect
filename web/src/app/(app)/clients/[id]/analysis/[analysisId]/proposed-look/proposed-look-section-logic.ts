import type { ProposedLookActionOutcome } from "./use-proposed-look";

// AI Proposed Look (Phase 2), Stage 4 -- the single, named, tested definition
// of "is this action outcome the confirm-time optimistic-concurrency
// conflict?". proposed-look-section.tsx uses this instead of inlining the
// condition, so the exact rule has exactly one home.
//
// Returns the outcome's message when it is the 409
// ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT failure the confirm endpoint emits
// (see src/app/api/v1/clients/[id]/analysis-proposals/[proposalId]/confirm),
// and `null` for every other outcome shape -- a success, a different error
// code, or a different status. It is deliberately NOT true for any other 409
// (e.g. PROPOSAL_ILLEGAL_STATE_TRANSITION), which is a real error, not an
// expected, recoverable race.
export function shouldShowConfirmConflictMessage(outcome: ProposedLookActionOutcome): string | null {
  if (
    !outcome.ok &&
    outcome.status === 409 &&
    outcome.code === "ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT"
  ) {
    return outcome.message;
  }
  return null;
}
