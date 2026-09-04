import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { TechnicalDemonstrationPlanRecord, TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import type { CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
import { HEAD_ZONE_LABELS } from "./technical-visual-map-logic";
import type { TechnicalDemonstrationPlanActionOutcome } from "./use-technical-demonstration-plan";

// Technical Demonstration, Stage 2 -- pure logic for the professional review
// UI. No React, no fetch -- mirrors technical-visual-map-logic.ts's own
// plain-function style exactly (plain exported functions/types,
// unit-testable with zero rendering environment).

export type TechnicalDemonstrationPlanLoadStatus = "ready" | "error";

export function resolveTechnicalDemonstrationPlanLoadStatus(response: { ok: boolean; status: number }): TechnicalDemonstrationPlanLoadStatus {
  return response.ok ? "ready" : "error";
}

// History has at most one DRAFT at a time per the locked Stage 1 lifecycle,
// but this does not assume/enforce that -- it just returns the first match
// honestly. Mirrors findExistingDraftMap exactly.
export function findExistingDraftPlan(history: TechnicalDemonstrationPlanRecord[]): TechnicalDemonstrationPlanRecord | null {
  return history.find((plan) => plan.status === "DRAFT") ?? null;
}

// Short, safe, professional-facing messages -- never a raw internal error.
// Mirrors mapTechnicalVisualMapApiError exactly.
export function mapTechnicalDemonstrationPlanApiError(status: number, code?: string): string {
  if (status === 401) return "Please sign in again.";
  if (status === 404) return "This Technical Demonstration Plan is no longer available.";
  if (status === 409 && code === "TECHNICAL_DEMONSTRATION_CONFIRMATION_CONFLICT") {
    return "Another Technical Demonstration Plan was confirmed for this proposal while this draft was open. Review the current confirmed plan, then try again if you still want to replace it.";
  }
  if (status === 409 && code === "TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION") {
    return "This plan is no longer a draft, so it can't be confirmed again.";
  }
  if (status === 400 || status === 422) {
    return "This request could not be completed with the current data. Please review and try again.";
  }
  if (status === 503) return "The Technical Demonstration service is temporarily unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Provenance -- the honest "where did this value come from" vocabulary.
// UNKNOWN is deliberately never styled or worded as an error -- it means the
// currently approved data does not support this technical detail, and the
// system has not invented one (Decision Lock's own explicit requirement).
// ---------------------------------------------------------------------------

export const TECHNICAL_DEMONSTRATION_PROVENANCE_LABELS: Record<string, string> = {
  OBSERVED: "Observed",
  INFERRED: "Inferred",
  UNKNOWN: "Not yet available",
  PROFESSIONAL_OVERRIDE: "Professional override",
};

export function technicalDemonstrationProvenanceLabel(provenance: string): string {
  return TECHNICAL_DEMONSTRATION_PROVENANCE_LABELS[provenance] ?? provenance;
}

// Only OBSERVED/INFERRED/PROFESSIONAL_OVERRIDE ever carry a real value --
// UNKNOWN always pairs with `value: null` (enforced server-side by
// isProvenanceValue). This is the single predicate every rendering call site
// uses to decide "does this field have anything to show at all".
export function isProvenancePopulated(entry: { provenance: string } | undefined | null): boolean {
  return !!entry && entry.provenance !== "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Step field descriptors -- the ONE place the full Cutting V1 field list
// (Decision Lock's own field list) is enumerated for display. Each
// descriptor knows its own label and how to turn a raw provenance value
// into readable text -- this is what lets TechnicalDemonstrationStepCard
// render "only fields relevant to that step" (populated ones) without ever
// dumping raw JSON, and lets the same list separately drive the honest
// "not yet available" section for UNKNOWN fields.
// ---------------------------------------------------------------------------

export interface StepFieldDescriptor {
  key: keyof CuttingDemonstrationStepPayload;
  label: string;
  formatValue: (value: unknown) => string;
}

function joinZones(value: unknown): string {
  return Array.isArray(value) ? value.map((zone) => HEAD_ZONE_LABELS[zone as keyof typeof HEAD_ZONE_LABELS] ?? humanizeEnumValue(String(zone))).join(", ") : "";
}

function formatEnum(value: unknown): string {
  return typeof value === "string" ? humanizeEnumValue(value) : String(value);
}

function formatText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function formatBoolean(value: unknown): string {
  return value ? "Yes" : "No";
}

// Order here is the ON-CARD reading order -- matches the natural execution
// narrative (where/what technique -> how to hold/direct -> the cut itself
// -> progression -> finishing), not the payload's own object key order.
export const CUTTING_STEP_FIELD_DESCRIPTORS: readonly StepFieldDescriptor[] = [
  { key: "zones", label: "Zone(s)", formatValue: joinZones },
  { key: "structuralTechnique", label: "Structural technique", formatValue: formatEnum },
  { key: "cuttingTechnique", label: "Cutting technique", formatValue: formatEnum },
  { key: "texturizingTechnique", label: "Texturizing technique", formatValue: formatEnum },
  { key: "sectioning", label: "Sectioning", formatValue: formatEnum },
  { key: "subsectioning", label: "Subsectioning", formatValue: formatText },
  { key: "guideType", label: "Guide", formatValue: formatEnum },
  { key: "headBodyPositioning", label: "Head / body positioning", formatValue: formatText },
  { key: "combingDirection", label: "Combing direction", formatValue: formatText },
  { key: "fingerPosition", label: "Finger position", formatValue: formatText },
  { key: "elevation", label: "Elevation", formatValue: formatEnum },
  { key: "overdirection", label: "Overdirection", formatValue: formatBoolean },
  { key: "cuttingAngle", label: "Cutting angle", formatValue: formatText },
  { key: "cuttingLine", label: "Cutting line", formatValue: formatText },
  { key: "tool", label: "Tool", formatValue: formatText },
  { key: "zoneConnection", label: "Zone connection", formatValue: formatText },
  { key: "crossCheck", label: "Cross-check", formatValue: formatBoolean },
  { key: "styling", label: "Styling / finish", formatValue: formatText },
];

export interface StepFieldRow {
  key: string;
  label: string;
  value: string;
  provenance: string;
}

// Splits a step's payload into the fields that actually have something to
// show (any provenance except UNKNOWN) versus the ones that honestly don't
// yet (UNKNOWN) -- TechnicalDemonstrationStepCard renders the first group
// prominently and the second as a clearly-labeled, non-alarming list.
export function resolveStepFieldRows(payload: TechnicalDemonstrationStepRecord["payload"]): { populated: StepFieldRow[]; unknown: string[] } {
  const populated: StepFieldRow[] = [];
  const unknownLabels: string[] = [];

  for (const descriptor of CUTTING_STEP_FIELD_DESCRIPTORS) {
    const entry = (payload as unknown as CuttingDemonstrationStepPayload)[descriptor.key] as { value: unknown; provenance: string } | undefined;
    if (isProvenancePopulated(entry)) {
      populated.push({
        key: descriptor.key,
        label: descriptor.label,
        value: descriptor.formatValue(entry!.value),
        provenance: entry!.provenance,
      });
    } else {
      unknownLabels.push(descriptor.label);
    }
  }

  return { populated, unknown: unknownLabels };
}

export function resolveStepConstraints(payload: TechnicalDemonstrationStepRecord["payload"]): string[] {
  const constraints = (payload as unknown as CuttingDemonstrationStepPayload).constraints;
  return Array.isArray(constraints) ? constraints : [];
}

// The single, named, tested definition of "is this action outcome the
// confirm-time optimistic-concurrency conflict?" -- mirrors
// shouldShowTechnicalVisualMapConfirmConflictMessage
// (technical-visual-map-section-logic.ts) exactly, kept in this same file
// rather than a separate `-section-logic.ts` given Stage 2's smaller
// overall scope (no draft-editor, no zone/relationship logic to separate
// it from). Returns the outcome's message only for the exact 409
// TECHNICAL_DEMONSTRATION_CONFIRMATION_CONFLICT failure the confirm
// endpoint emits -- `null` for a success, a different error code, or a
// different status (a different 409, e.g.
// TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION, is a real error, not
// an expected, recoverable race).
export function shouldShowTechnicalDemonstrationConfirmConflictMessage(outcome: TechnicalDemonstrationPlanActionOutcome): string | null {
  if (!outcome.ok && outcome.status === 409 && outcome.code === "TECHNICAL_DEMONSTRATION_CONFIRMATION_CONFLICT") {
    return outcome.message;
  }
  return null;
}
