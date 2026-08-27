import type { ProposalEditEntry, ProposalEditSource } from "@/lib/proposal-validators";

import type { EditableCuttingField, EffectiveCuttingFieldValue } from "./proposed-look-logic";

// AI Proposed Look (Phase 2), Stage 4 -- pure logic for turning edited Select
// values back into the API's edit-entry shape. No React, no fetch -- mirrors
// proposed-look-logic.ts's own plain-function style.

// Turns the current form values into the minimal set of ProposalEditEntry
// objects the PATCH endpoint needs.
//
// Each form value is compared against the CURRENT effective value
// (`entry.effectiveValue` -- the already-edited value if a prior edit exists,
// NOT the original frozen baseline). Re-submitting a field the form still
// shows unchanged therefore never produces a no-op duplicate edit entry, even
// if that field was edited in an earlier save.
//
// `reason` is omitted entirely from an emitted entry when it is undefined,
// empty, or whitespace-only -- matching ProposalEditEntry's optional `reason?`
// semantics (never send an empty string).
//
// Returns `[]` when nothing changed. The caller must NOT forward an empty
// array to editDraft/editDraftProposal (the repository rejects that with
// ProposalValidationError) -- the Save button is disabled client-side when
// this returns `[]`.
export function buildProposalEditEntries(
  currentEffective: EffectiveCuttingFieldValue[],
  formValues: Record<EditableCuttingField, string>,
  source: ProposalEditSource,
  reason: string | undefined,
): ProposalEditEntry[] {
  const normalizedReason = reason !== undefined && reason.trim().length > 0 ? reason : undefined;

  const entries: ProposalEditEntry[] = [];
  for (const entry of currentEffective) {
    const formValue = formValues[entry.field];
    if (formValue === entry.effectiveValue) {
      continue;
    }

    entries.push({
      field: entry.field,
      previousValue: entry.effectiveValue,
      newValue: formValue,
      source,
      ...(normalizedReason !== undefined ? { reason: normalizedReason } : {}),
    });
  }

  return entries;
}
