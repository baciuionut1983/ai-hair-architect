"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";
import type { TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import type { CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
import type { CuttingStepOverrideFieldName } from "@/lib/technical-demonstration-cutting-overrides";

import {
  CUTTING_STEP_FIELD_DESCRIPTORS,
  CUTTING_STEP_FIELD_EDITORS,
  resolveActionTypeOptionsForPhase,
  resolveStepConstraints,
  resolveStepFieldRows,
} from "./technical-demonstration-plan-logic";
import { TechnicalDemonstrationProvenanceBadge } from "./technical-demonstration-provenance-badge";
import { TechnicalDemonstrationStepFieldEditor, type TechnicalDemonstrationStepFieldEditSubmission } from "./technical-demonstration-step-field-editor";

export interface TechnicalDemonstrationStepCardProps {
  step: TechnicalDemonstrationStepRecord;
  // Stage 2.5.b -- present ONLY for a DRAFT plan's own steps; a CONFIRMED
  // (or SUPERSEDED) plan's step card never receives this prop, so it stays
  // fully read-only structurally, not just by convention (see
  // technical-demonstration-plan-view.tsx's own call site).
  onEditField?: (submission: TechnicalDemonstrationStepFieldEditSubmission & { stepNumber: number }) => Promise<boolean>;
}

// Built once, module scope -- display label -> editable field name, derived
// from the SAME CUTTING_STEP_FIELD_DESCRIPTORS list resolveStepFieldRows
// itself iterates, filtered to only fields that have a real editor
// (excludes `phase`, the one display-only, non-editable descriptor -- see
// technical-demonstration-cutting-overrides.ts's own header comment for
// why it is deliberately never professionally editable). This is what lets
// an "Edit" button be offered even for a currently-UNKNOWN field, whose
// bucket (resolveStepFieldRows's own `unknown` list) only ever carries a
// display label, not the field key itself.
const EDITABLE_FIELD_SET = new Set<string>(CUTTING_STEP_FIELD_EDITORS.map((e) => e.key));
const UNKNOWN_LABEL_TO_FIELD: Record<string, CuttingStepOverrideFieldName> = Object.fromEntries(
  CUTTING_STEP_FIELD_DESCRIPTORS.filter((d) => EDITABLE_FIELD_SET.has(d.key)).map((d) => [d.label, d.key as CuttingStepOverrideFieldName]),
);

// Technical Demonstration, Stage 2 (+ Stage 2.5.b) -- one ordered execution
// step, rendered for professional review. Never dumps raw JSON (Decision
// Lock's own explicit requirement): only fields the derivation (or a
// professional override) actually populated for THIS step are shown as
// structured rows, each with its own provenance badge; the human-readable
// `explanation` is shown separately, clearly distinguished from the
// structured fields (never parsed as one of them). UNKNOWN fields are
// listed too, but honestly, as a muted "not yet available" note -- never
// omitted entirely -- and NOT_APPLICABLE fields (Stage 2.5.b) get their own
// distinct, equally honest bucket. When `onEditField` is supplied (DRAFT
// only), every editable field row gets a small "Edit" affordance that opens
// ONE inline editor at a time (progressive disclosure -- never a giant
// whole-step form, never raw JSON).
export function TechnicalDemonstrationStepCard({ step, onEditField }: TechnicalDemonstrationStepCardProps) {
  const { populated, notApplicable, unknown } = resolveStepFieldRows(step.payload);
  const constraints = resolveStepConstraints(step.payload);
  const [editingField, setEditingField] = useState<CuttingStepOverrideFieldName | null>(null);

  const payload = step.payload as unknown as CuttingDemonstrationStepPayload;

  // Stage 2.5.d (round 2, UI/read-model compatibility fix) -- Execution
  // action is a FIRST-CLASS field, never buried in the generic collapsed
  // "not yet available" bucket alongside ~15 unrelated fields: extracted
  // from whichever of the 3 generic buckets resolveStepFieldRows already
  // classified it into, and rendered in its own dedicated, always-visible
  // block instead. The 3 general lists below are filtered to exclude it,
  // so it is never shown twice.
  const actionTypeRow = populated.find((row) => row.key === "actionType") ?? null;
  const actionTypeIsNotApplicable = notApplicable.includes("Execution action");
  const populatedWithoutActionType = populated.filter((row) => row.key !== "actionType");
  const notApplicableWithoutActionType = notApplicable.filter((label) => label !== "Execution action");
  const unknownWithoutActionType = unknown.filter((label) => label !== "Execution action");
  const stepPhase = payload.phase?.provenance !== "UNKNOWN" && payload.phase?.provenance !== "NOT_APPLICABLE" ? (payload.phase.value as string) : null;

  function isEditableField(field: string): field is CuttingStepOverrideFieldName {
    return EDITABLE_FIELD_SET.has(field);
  }

  function currentValueFor(field: CuttingStepOverrideFieldName): unknown {
    const entry = payload[field] as { value: unknown } | undefined;
    return entry?.value ?? null;
  }

  function hasBeenOverriddenFor(field: CuttingStepOverrideFieldName): boolean {
    const entry = payload[field] as { provenance: string } | undefined;
    return entry?.provenance === "PROFESSIONAL_OVERRIDE" || entry?.provenance === "NOT_APPLICABLE";
  }

  async function handleEditorSubmit(submission: TechnicalDemonstrationStepFieldEditSubmission): Promise<boolean> {
    if (!onEditField) return false;
    const ok = await onEditField({ ...submission, stepNumber: step.stepNumber });
    if (ok) setEditingField(null);
    return ok;
  }

  function editButton(field: CuttingStepOverrideFieldName) {
    if (!onEditField) return null;
    if (editingField === field) return null;
    return (
      <Button type="button" variant="ghost" className="!px-2 !py-0.5 !text-xs" onClick={() => setEditingField(field)}>
        Edit
      </Button>
    );
  }

  function editorFor(field: CuttingStepOverrideFieldName, label: string, currentValue: unknown, overridden: boolean, optionsOverride?: readonly string[]) {
    if (editingField !== field) return null;
    return (
      <TechnicalDemonstrationStepFieldEditor
        field={field}
        label={label}
        currentValue={currentValue}
        hasBeenOverridden={overridden}
        onSubmit={handleEditorSubmit}
        onCancel={() => setEditingField(null)}
        optionsOverride={optionsOverride}
      />
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-base font-semibold text-foreground">Step {step.stepNumber}</h4>
      </div>

      {step.explanation ? <p className="text-sm text-foreground">{step.explanation}</p> : null}

      <div className="flex flex-col gap-1 rounded-lg border border-border p-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-muted">Execution action</dt>
          <dd className="flex flex-wrap items-center justify-end gap-1.5 text-right font-medium text-foreground">
            {actionTypeRow ? (
              <>
                {actionTypeRow.value}
                <TechnicalDemonstrationProvenanceBadge provenance={actionTypeRow.provenance} />
              </>
            ) : (
              "Not classified"
            )}
            {onEditField ? editButton("actionType") : null}
          </dd>
        </div>
        {!actionTypeRow ? (
          <p className="text-xs text-muted">
            {actionTypeIsNotApplicable
              ? "A professional determined this step genuinely has no applicable execution action."
              : "Needs professional classification -- readiness cannot fully determine which technical fields apply to this step until this is set."}
          </p>
        ) : null}
        {editorFor(
          "actionType",
          "Execution action",
          actionTypeRow ? currentValueFor("actionType") : null,
          hasBeenOverriddenFor("actionType"),
          resolveActionTypeOptionsForPhase(stepPhase),
        )}
      </div>

      {populatedWithoutActionType.length > 0 ? (
        <dl className="flex flex-col gap-1.5">
          {populatedWithoutActionType.map((row) => {
            const field = isEditableField(row.key) ? row.key : null;
            return (
              <div key={row.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                  <dt className="text-muted">{row.label}</dt>
                  <dd className="flex flex-wrap items-center justify-end gap-1.5 text-right font-medium text-foreground">
                    {row.value}
                    <TechnicalDemonstrationProvenanceBadge provenance={row.provenance} />
                    {field ? editButton(field) : null}
                  </dd>
                </div>
                {field ? editorFor(field, row.label, currentValueFor(field), hasBeenOverriddenFor(field)) : null}
              </div>
            );
          })}
        </dl>
      ) : null}

      {constraints.length > 0 ? (
        <div className="rounded-lg bg-surface-alt p-2.5">
          <p className="text-xs font-semibold text-foreground">Constraints / must-not-do</p>
          <ul className="mt-1 list-inside list-disc text-xs text-muted">
            {constraints.map((constraint) => (
              <li key={constraint}>{constraint}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {notApplicableWithoutActionType.length > 0 ? (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">Marked not applicable for this step ({notApplicableWithoutActionType.length})</summary>
          <p className="mt-1">A professional determined these details genuinely do not apply to this specific step.</p>
          <ul className="mt-2 flex flex-col gap-1.5 list-none p-0">
            {notApplicableWithoutActionType.map((label) => {
              const field = UNKNOWN_LABEL_TO_FIELD[label] ?? null;
              return (
                <li key={label} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span>{label}</span>
                    {field ? editButton(field) : null}
                  </div>
                  {field ? editorFor(field, label, null, true) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {unknownWithoutActionType.length > 0 ? (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">Not yet available for this step ({unknownWithoutActionType.length})</summary>
          <p className="mt-1">
            The current approved data does not support these technical details yet -- nothing has been invented for
            them.
            {onEditField ? " A professional can complete or mark any of these below." : ""}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 list-none p-0">
            {unknownWithoutActionType.map((label) => {
              const field = UNKNOWN_LABEL_TO_FIELD[label] ?? null;
              return (
                <li key={label} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span>{label}</span>
                    {field ? editButton(field) : null}
                  </div>
                  {field ? editorFor(field, label, null, false) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
