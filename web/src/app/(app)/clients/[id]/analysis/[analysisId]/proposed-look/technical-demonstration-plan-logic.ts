import {
  CUTTING_TECHNIQUES,
  ELEVATION_OPTIONS,
  GUIDELINE_OPTIONS,
  SECTIONING_OPTIONS,
  STRUCTURAL_TECHNIQUES,
  TEXTURIZING_TECHNIQUES,
} from "@/lib/proposal-validators";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { TechnicalDemonstrationPlanRecord, TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import type { CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
import { CUTTING_STEP_OVERRIDE_FIELD_NAMES, type CuttingStepOverrideFieldName } from "@/lib/technical-demonstration-cutting-overrides";
import { isProvenanceNotApplicable, isProvenancePopulated } from "@/lib/technical-demonstration-contracts";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
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
  // Stage 2.5.b -- a real professional decision ("this genuinely doesn't
  // apply here"), deliberately worded distinctly from "Not yet available"
  // (UNKNOWN) -- the professional actively decided this, it isn't a gap.
  NOT_APPLICABLE: "Not applicable",
};

export function technicalDemonstrationProvenanceLabel(provenance: string): string {
  return TECHNICAL_DEMONSTRATION_PROVENANCE_LABELS[provenance] ?? provenance;
}

// Stage 2.5.c -- relocated to technical-demonstration-contracts.ts (a
// server-side readiness evaluator in src/lib now needs these same two
// generic predicates and must never import from this route's own
// colocated logic file). Imported above and re-exported here, unchanged,
// so every existing import site in this UI feature keeps working
// verbatim.
export { isProvenancePopulated, isProvenanceNotApplicable };

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
// narrative (starting state -> where/what technique -> how to hold/direct
// -> the cut itself -> progression -> finishing -> resulting state), not
// the payload's own object key order. Stage 2.5.b addition: `phase`
// (read-only context -- see CUTTING_STEP_OVERRIDE_FIELD_NAMES's own
// deliberate exclusion of it from the editable set) and the six Stage
// 2.5.a execution fields (fingerAngle, subsectionThickness, toolOrientation,
// progression, stateBefore, stateAfter) that Stage 2.5.a's own domain
// foundation added but deliberately left undisplayed pending this stage's
// review UI.
export const CUTTING_STEP_FIELD_DESCRIPTORS: readonly StepFieldDescriptor[] = [
  { key: "phase", label: "Execution phase", formatValue: formatEnum },
  { key: "stateBefore", label: "State before", formatValue: formatText },
  { key: "zones", label: "Zone(s)", formatValue: joinZones },
  { key: "structuralTechnique", label: "Structural technique", formatValue: formatEnum },
  { key: "cuttingTechnique", label: "Cutting technique", formatValue: formatEnum },
  { key: "texturizingTechnique", label: "Texturizing technique", formatValue: formatEnum },
  { key: "sectioning", label: "Sectioning", formatValue: formatEnum },
  { key: "subsectioning", label: "Subsectioning", formatValue: formatText },
  { key: "subsectionThickness", label: "Subsection thickness", formatValue: formatText },
  { key: "guideType", label: "Guide", formatValue: formatEnum },
  // Stage 2.5.c: `headBodyPositioning` is deprecated (kept only for
  // backward compatibility with already-recorded data -- see its own doc
  // comment in technical-demonstration-cutting-contracts.ts) but still
  // shown if a real value happens to be present on an older record. New
  // professional input targets the two fields below instead.
  { key: "headBodyPositioning", label: "Head / body positioning (deprecated)", formatValue: formatText },
  { key: "clientHeadPosition", label: "Client head position", formatValue: formatText },
  { key: "observationView", label: "Observation viewpoint", formatValue: formatText },
  { key: "combingDirection", label: "Combing direction", formatValue: formatText },
  { key: "fingerPosition", label: "Finger position", formatValue: formatText },
  { key: "fingerAngle", label: "Finger angle", formatValue: formatText },
  { key: "elevation", label: "Elevation", formatValue: formatEnum },
  { key: "overdirection", label: "Overdirection", formatValue: formatBoolean },
  { key: "cuttingAngle", label: "Cutting angle", formatValue: formatText },
  { key: "cuttingLine", label: "Cutting line", formatValue: formatText },
  { key: "tool", label: "Tool", formatValue: formatText },
  { key: "toolOrientation", label: "Tool orientation", formatValue: formatText },
  { key: "progression", label: "Progression", formatValue: formatText },
  { key: "zoneConnection", label: "Zone connection", formatValue: formatText },
  { key: "crossCheck", label: "Cross-check", formatValue: formatBoolean },
  { key: "styling", label: "Styling / finish", formatValue: formatText },
  { key: "stateAfter", label: "State after", formatValue: formatText },
];

export interface StepFieldRow {
  key: string;
  label: string;
  value: string;
  provenance: string;
}

// Splits a step's payload into three buckets: fields that actually have
// something to show (any provenance except UNKNOWN/NOT_APPLICABLE), fields
// a professional actively decided don't apply here (NOT_APPLICABLE), and
// fields that honestly don't have a value yet (UNKNOWN) --
// TechnicalDemonstrationStepCard renders all three, each with its own
// distinct, non-alarming presentation.
export function resolveStepFieldRows(
  payload: TechnicalDemonstrationStepRecord["payload"],
): { populated: StepFieldRow[]; notApplicable: string[]; unknown: string[] } {
  const populated: StepFieldRow[] = [];
  const notApplicableLabels: string[] = [];
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
    } else if (isProvenanceNotApplicable(entry)) {
      notApplicableLabels.push(descriptor.label);
    } else {
      unknownLabels.push(descriptor.label);
    }
  }

  return { populated, notApplicable: notApplicableLabels, unknown: unknownLabels };
}

// ---------------------------------------------------------------------------
// Stage 2.5.b -- professional editor descriptors. A SMALLER, SEPARATE list
// from CUTTING_STEP_FIELD_DESCRIPTORS above (display) -- deliberately
// excludes `phase` (system-derived, never professionally editable; see
// technical-demonstration-cutting-overrides.ts's own header comment for
// why) and `constraints` (safety-critical, never editable). Every OTHER
// display field has exactly one editor descriptor here, enforced at the
// type level via `satisfies` against CuttingStepOverrideFieldName.
// ---------------------------------------------------------------------------

export type CuttingStepFieldEditorKind = "zones" | "select" | "text" | "boolean";

export interface CuttingStepFieldEditorDescriptor {
  key: CuttingStepOverrideFieldName;
  kind: CuttingStepFieldEditorKind;
  // Present only for kind "select" -- the closed vocabulary a <select>
  // control offers, reusing the EXACT SAME arrays the server-side
  // validator (technical-demonstration-cutting-overrides.ts) checks
  // against, never a second, competing list.
  options?: readonly string[];
}

export const CUTTING_STEP_FIELD_EDITORS: readonly CuttingStepFieldEditorDescriptor[] = [
  { key: "zones", kind: "zones" },
  { key: "elevation", kind: "select", options: ELEVATION_OPTIONS },
  { key: "tool", kind: "text" },
  { key: "sectioning", kind: "select", options: SECTIONING_OPTIONS },
  { key: "guideType", kind: "select", options: GUIDELINE_OPTIONS },
  { key: "structuralTechnique", kind: "select", options: STRUCTURAL_TECHNIQUES },
  { key: "cuttingTechnique", kind: "select", options: CUTTING_TECHNIQUES },
  { key: "texturizingTechnique", kind: "select", options: TEXTURIZING_TECHNIQUES },
  { key: "combingDirection", kind: "text" },
  { key: "overdirection", kind: "boolean" },
  { key: "headBodyPositioning", kind: "text" },
  { key: "clientHeadPosition", kind: "text" },
  { key: "observationView", kind: "text" },
  { key: "fingerPosition", kind: "text" },
  { key: "fingerAngle", kind: "text" },
  { key: "cuttingAngle", kind: "text" },
  { key: "cuttingLine", kind: "text" },
  { key: "subsectioning", kind: "text" },
  { key: "subsectionThickness", kind: "text" },
  { key: "toolOrientation", kind: "text" },
  { key: "progression", kind: "text" },
  { key: "zoneConnection", kind: "text" },
  { key: "crossCheck", kind: "boolean" },
  { key: "styling", kind: "text" },
  { key: "stateBefore", kind: "text" },
  { key: "stateAfter", kind: "text" },
] as const satisfies readonly { key: CuttingStepOverrideFieldName; kind: CuttingStepFieldEditorKind; options?: readonly string[] }[];

// Every field in CUTTING_STEP_OVERRIDE_FIELD_NAMES has exactly one editor
// descriptor -- proven once, here, rather than trusted by construction (a
// future field added to one list and forgotten in the other would
// otherwise fail silently, not loudly).
if (CUTTING_STEP_FIELD_EDITORS.length !== CUTTING_STEP_OVERRIDE_FIELD_NAMES.length) {
  throw new Error("CUTTING_STEP_FIELD_EDITORS is out of sync with CUTTING_STEP_OVERRIDE_FIELD_NAMES.");
}

export function resolveCuttingStepFieldEditor(field: CuttingStepOverrideFieldName): CuttingStepFieldEditorDescriptor {
  const editor = CUTTING_STEP_FIELD_EDITORS.find((e) => e.key === field);
  if (!editor) throw new Error(`No editor descriptor for field "${field}".`);
  return editor;
}

export function zoneOptionsForEditor(): readonly string[] {
  return HEAD_ZONES;
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

// Stage 2.5.c (DRAFT readiness visibility fix) -- which plan the Technical
// Execution Video readiness section should be requested/rendered for: the
// DRAFT awaiting professional review when one exists, otherwise the
// CONFIRMED plan -- the EXACT same priority TechnicalDemonstrationPlanSection
// already uses to decide WHICH plan's own step list to render (`draft ?
// ... : current ? ... : ...`). Readiness must always describe the plan
// actually on screen -- never a different, stale plan for the same
// (client, proposal) scope (e.g. an older CONFIRMED plan still sitting
// around while a newer DRAFT revision is what the professional is
// currently reviewing). Returns the whole plan record (not just its id) so
// the caller can also read `updatedAt` from the SAME object -- picking the
// id from one plan and a timestamp from a different one would silently
// point the readiness fetch at a moving target.
export function resolveReadinessTargetPlan(
  draftPlan: TechnicalDemonstrationPlanRecord | null | undefined,
  confirmedPlan: TechnicalDemonstrationPlanRecord | null | undefined,
): TechnicalDemonstrationPlanRecord | null {
  return draftPlan ?? confirmedPlan ?? null;
}
