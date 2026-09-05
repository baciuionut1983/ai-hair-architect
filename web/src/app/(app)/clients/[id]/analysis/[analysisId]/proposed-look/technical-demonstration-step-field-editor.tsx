"use client";

import { useState } from "react";

import { Alert, Button, Input, Select, Textarea } from "@/components/ui";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { CuttingStepOverrideFieldName } from "@/lib/technical-demonstration-cutting-overrides";

import { HEAD_ZONE_LABELS } from "./technical-visual-map-logic";
import { resolveCuttingStepFieldEditor, zoneOptionsForEditor, type CuttingStepFieldEditorDescriptor } from "./technical-demonstration-plan-logic";

export interface TechnicalDemonstrationStepFieldEditSubmission {
  op: "set_value" | "mark_not_applicable" | "reset_field";
  field: CuttingStepOverrideFieldName;
  value?: unknown;
}

export interface TechnicalDemonstrationStepFieldEditorProps {
  field: CuttingStepOverrideFieldName;
  label: string;
  // The step's own EFFECTIVE current value for this field, if any (used to
  // pre-fill the editor so "keep the current value" needs no re-typing) --
  // null when the field is UNKNOWN/NOT_APPLICABLE today.
  currentValue: unknown;
  hasBeenOverridden: boolean;
  onSubmit: (submission: TechnicalDemonstrationStepFieldEditSubmission) => Promise<boolean>;
  onCancel: () => void;
  // Stage 2.5.d (round 2) -- narrows a "select"-kind field's own generic
  // options list for THIS specific step (used only for actionType, to
  // offer the 2 phase-appropriate choices on a GUIDE/FINAL_CHECK step
  // instead of the full 7-value vocabulary). Falls back to the field's own
  // registered descriptor options when not supplied -- every other field
  // is unaffected.
  optionsOverride?: readonly string[];
}

// Technical Demonstration, Stage 2.5.b -- the ONE reusable inline editor for
// every professionally-editable Cutting V1 field. Never raw JSON: the
// control shown is driven entirely by the field's own registered "kind"
// (zones / select / text / boolean) -- see CUTTING_STEP_FIELD_EDITORS
// (technical-demonstration-plan-logic.ts). Deliberately renders inline,
// one field at a time (progressive disclosure -- the parent step card
// only ever has one field editor open at once), never a giant whole-step
// form.
export function TechnicalDemonstrationStepFieldEditor({
  field,
  label,
  currentValue,
  hasBeenOverridden,
  onSubmit,
  onCancel,
  optionsOverride,
}: TechnicalDemonstrationStepFieldEditorProps) {
  const editor: CuttingStepFieldEditorDescriptor = resolveCuttingStepFieldEditor(field);
  const selectOptions = optionsOverride ?? editor.options;
  const [textValue, setTextValue] = useState(typeof currentValue === "string" ? currentValue : "");
  const [selectValue, setSelectValue] = useState(typeof currentValue === "string" ? currentValue : "");
  const [boolValue, setBoolValue] = useState(currentValue === true ? "true" : currentValue === false ? "false" : "");
  const [zoneValues, setZoneValues] = useState<string[]>(Array.isArray(currentValue) ? (currentValue as string[]) : []);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(submission: TechnicalDemonstrationStepFieldEditSubmission) {
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(submission);
    setSubmitting(false);
    if (!ok) {
      setError("This change could not be saved. Please try again.");
    }
  }

  function handleSaveValue() {
    if (editor.kind === "zones") {
      if (zoneValues.length === 0) {
        setError("Select at least one zone.");
        return;
      }
      void submit({ op: "set_value", field, value: zoneValues });
      return;
    }
    if (editor.kind === "select") {
      if (!selectValue) {
        setError("Choose a value.");
        return;
      }
      void submit({ op: "set_value", field, value: selectValue });
      return;
    }
    if (editor.kind === "boolean") {
      if (boolValue === "") {
        setError("Choose Yes or No.");
        return;
      }
      void submit({ op: "set_value", field, value: boolValue === "true" });
      return;
    }
    if (!textValue.trim()) {
      setError("Enter a value, or use \"Mark not applicable\" instead.");
      return;
    }
    void submit({ op: "set_value", field, value: textValue.trim() });
  }

  function toggleZone(zone: string) {
    setZoneValues((current) => (current.includes(zone) ? current.filter((z) => z !== zone) : [...current, zone]));
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-alt p-3">
      <p className="text-xs font-semibold text-foreground">Edit: {label}</p>

      {editor.kind === "zones" ? (
        <div className="flex flex-wrap gap-2">
          {zoneOptionsForEditor().map((zone) => (
            <button
              key={zone}
              type="button"
              onClick={() => toggleZone(zone)}
              className={
                "rounded-full border px-2.5 py-1 text-xs " +
                (zoneValues.includes(zone) ? "border-accent bg-accent/10 text-accent" : "border-border text-muted")
              }
            >
              {HEAD_ZONE_LABELS[zone as keyof typeof HEAD_ZONE_LABELS] ?? humanizeEnumValue(zone)}
            </button>
          ))}
        </div>
      ) : null}

      {editor.kind === "select" ? (
        <Select value={selectValue} onChange={(e) => setSelectValue(e.target.value)}>
          <option value="">Choose...</option>
          {selectOptions?.map((option) => (
            <option key={option} value={option}>
              {humanizeEnumValue(option)}
            </option>
          ))}
        </Select>
      ) : null}

      {editor.kind === "boolean" ? (
        <Select value={boolValue} onChange={(e) => setBoolValue(e.target.value)}>
          <option value="">Choose...</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      ) : null}

      {editor.kind === "text" ? (
        field === "stateBefore" || field === "stateAfter" || field === "styling" ? (
          <Textarea rows={2} value={textValue} onChange={(e) => setTextValue(e.target.value)} placeholder={`Describe ${label.toLowerCase()}...`} />
        ) : (
          <Input value={textValue} onChange={(e) => setTextValue(e.target.value)} placeholder={`Enter ${label.toLowerCase()}...`} />
        )
      ) : null}

      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleSaveValue} loading={submitting}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={() => void submit({ op: "mark_not_applicable", field })} loading={submitting}>
          Mark not applicable
        </Button>
        {hasBeenOverridden ? (
          <Button type="button" variant="secondary" onClick={() => void submit({ op: "reset_field", field })} loading={submitting}>
            Reset to original
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
