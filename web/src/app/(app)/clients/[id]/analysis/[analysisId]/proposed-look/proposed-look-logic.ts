import type { TechnicalCutPlan } from "@/lib/contracts";
import type { ProposalEditEntry } from "@/lib/proposal-validators";
import type { ProposalRecord } from "@/lib/proposal-repository";

// AI Proposed Look (Phase 2), Stage 4a -- pure logic for the Proposed Look UI.
// No React, no fetch -- mirrors analysis-result-logic.ts / analysis-form-logic.ts's
// own pattern (plain exported functions/types, unit-testable with zero
// rendering environment).

export type ProposedLookLoadStatus = "ready" | "error";

export function resolveProposedLookLoadStatus(response: { ok: boolean; status: number }): ProposedLookLoadStatus {
  return response.ok ? "ready" : "error";
}

// The seven cutting fields a DRAFT proposal can be edited on -- exactly the
// enum fields on TechnicalCutPlan, and exactly the fields
// analysis-field-options.ts's new STRUCTURAL_TECHNIQUE_OPTIONS /
// CUTTING_TECHNIQUE_OPTIONS / TEXTURIZING_TECHNIQUE_OPTIONS /
// CUT_SECTIONING_OPTIONS / CUT_ELEVATION_OPTIONS / CUT_DISTRIBUTION_OPTIONS /
// CUT_GUIDELINE_OPTIONS cover. The free-text/step/narrative fields on the plan
// are never directly editable in this UI.
export const EDITABLE_CUTTING_FIELDS = [
  "structuralTechnique",
  "cuttingTechnique",
  "texturizingTechnique",
  "sectioning",
  "elevation",
  "distribution",
  "guideline",
] as const;
export type EditableCuttingField = (typeof EDITABLE_CUTTING_FIELDS)[number];

export interface EffectiveCuttingFieldValue {
  field: EditableCuttingField;
  baselineValue: string;
  effectiveValue: string;
  wasEdited: boolean;
  editReason?: string;
}

// Display-merge logic only -- never mutates payload/edits, never
// reimplements any repository/domain rule. editDraftProposal's own
// append-and-freeze behavior (proposal-repository.ts) is the single source
// of truth for what is actually persisted; this only decides what to SHOW.
export function computeEffectiveCuttingFields(
  payload: TechnicalCutPlan,
  edits: ProposalEditEntry[],
): EffectiveCuttingFieldValue[] {
  return EDITABLE_CUTTING_FIELDS.map((field) => {
    const baselineValue = String(payload[field] ?? "");

    // edits is append-only chronological -- the LAST matching entry for this
    // field is the current, most recent edit, not the first.
    let latestEdit: ProposalEditEntry | undefined;
    for (const edit of edits) {
      if (edit.field === field) {
        latestEdit = edit;
      }
    }

    if (latestEdit) {
      return {
        field,
        baselineValue,
        effectiveValue: String(latestEdit.newValue ?? ""),
        wasEdited: true,
        ...(latestEdit.reason ? { editReason: latestEdit.reason } : {}),
      };
    }

    return {
      field,
      baselineValue,
      effectiveValue: baselineValue,
      wasEdited: false,
    };
  });
}

// Builds a NEW, display-only TechnicalCutPlan-shaped object where the 7
// editable fields carry their EFFECTIVE (baseline + latest edit) values, and
// every other field (cuttingSteps, warnings, contraindications, rationale,
// confidence, version, ...) is copied verbatim from the frozen `payload`.
//
// Why this exists: `payload` itself must never be mutated (the locked
// architecture -- edits are layered provenance, not an overwrite), but a
// read-only view of a CONFIRMED (or any) proposal that reuses
// TechnicalCutPlanView directly on the raw `payload` would silently show
// the pre-edit AI/engine baseline as if it were what was actually approved
// -- wrong and misleading whenever the proposal was edited before
// confirming. This function is the single place that performs that
// display-time merge; it never writes back to any stored record.
export function buildEffectivePlan(payload: TechnicalCutPlan, edits: ProposalEditEntry[]): TechnicalCutPlan {
  const effective = computeEffectiveCuttingFields(payload, edits);
  const overrides: Partial<Record<EditableCuttingField, string>> = {};
  for (const entry of effective) {
    overrides[entry.field] = entry.effectiveValue;
  }

  return {
    ...payload,
    structuralTechnique: overrides.structuralTechnique as TechnicalCutPlan["structuralTechnique"],
    cuttingTechnique: overrides.cuttingTechnique as TechnicalCutPlan["cuttingTechnique"],
    texturizingTechnique: overrides.texturizingTechnique
      ? (overrides.texturizingTechnique as TechnicalCutPlan["texturizingTechnique"])
      : undefined,
    sectioning: overrides.sectioning as TechnicalCutPlan["sectioning"],
    elevation: overrides.elevation as TechnicalCutPlan["elevation"],
    distribution: overrides.distribution as TechnicalCutPlan["distribution"],
    guideline: overrides.guideline as TechnicalCutPlan["guideline"],
  };
}

// True when at least one of the 7 editable fields differs from its frozen
// baseline -- i.e. whether buildEffectivePlan's result would differ from
// `payload` itself. Used to decide whether to show an "includes professional
// edits" indicator alongside a read-only effective-plan view.
export function hasAnyCuttingEdit(payload: TechnicalCutPlan, edits: ProposalEditEntry[]): boolean {
  return computeEffectiveCuttingFields(payload, edits).some((entry) => entry.wasEdited);
}

// Safe, honest staleness signal using ONLY the two timestamps already present
// on the current page (the viewed Analysis's own `updatedAt`, already
// fetched by useAnalysisResult) and on the current-confirmed ProposalRecord
// (`analysisSnapshotAt`, already fetched by use-proposed-look.ts) -- no new
// API call, no cross-analysis lookup, no client-side inference beyond a
// direct timestamp comparison.
//
// This correctly flags staleness whether the confirmed proposal's source
// Analysis was later corrected (same analysisId, updated after the
// snapshot) or the professional is now viewing a genuinely newer Analysis
// than the one the confirmed proposal captured; it correctly stays quiet
// when the professional is viewing an OLDER analysis than the one already
// backing a newer confirmed proposal. It never claims WHICH analysis is
// newer by name/id -- only that more recent analysis activity exists than
// what the current confirmed look reflects. This is the ONLY staleness
// signal Stage 4 implements.
export function isConfirmedProposalPotentiallyStale(
  currentAnalysisUpdatedAt: string,
  confirmedProposalAnalysisSnapshotAt: string,
): boolean {
  return new Date(currentAnalysisUpdatedAt).getTime() > new Date(confirmedProposalAnalysisSnapshotAt).getTime();
}

// Short, safe, professional-facing messages -- never a raw internal error.
export function mapProposedLookApiError(status: number, code?: string): string {
  if (status === 401) return "Please sign in again.";
  if (status === 404) return "This proposal is no longer available.";
  if (status === 409 && code === "ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT") {
    return "Another proposal was confirmed while this draft was open. Review the current confirmed look, then try again if you still want to replace it.";
  }
  if (status === 409 && code === "PROPOSAL_ILLEGAL_STATE_TRANSITION") {
    return "This proposal is no longer a draft, so it can't be changed.";
  }
  if (status === 400 || status === 422) {
    return "This request could not be completed with the current data. Please review and try again.";
  }
  if (status === 503) return "The proposal service is temporarily unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

// history has at most one DRAFT at a time per the locked lifecycle, but this
// does not assume/enforce that -- it just returns the first match honestly.
export function findExistingDraft(history: ProposalRecord[]): ProposalRecord | null {
  return history.find((proposal) => proposal.status === "DRAFT") ?? null;
}
