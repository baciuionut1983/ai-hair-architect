"use client";

import { useState } from "react";

import { RecommendationPlanBase } from "@/components/analysis";
import { Alert, Button, Card, Dialog, Select, Textarea } from "@/components/ui";
import {
  CUT_DISTRIBUTION_OPTIONS,
  CUT_ELEVATION_OPTIONS,
  CUT_GUIDELINE_OPTIONS,
  CUT_SECTIONING_OPTIONS,
  CUTTING_TECHNIQUE_OPTIONS,
  STRUCTURAL_TECHNIQUE_OPTIONS,
  TEXTURIZING_TECHNIQUE_OPTIONS,
  type FieldOption,
} from "@/lib/analysis-field-options";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { ProposalRecord } from "@/lib/proposal-repository";
import type { ProposalEditEntry } from "@/lib/proposal-validators";

import { buildProposalEditEntries } from "./proposed-look-edit-form-logic";
import { ProposalEvidencePanel } from "./proposed-look-evidence";
import { computeEffectiveCuttingFields, type EditableCuttingField } from "./proposed-look-logic";
import { shouldShowConfirmConflictMessage } from "./proposed-look-section-logic";
import { ProposalStatusBadge } from "./proposed-look-status-badge";
import type { ProposedLookActionOutcome } from "./use-proposed-look";

const FIELD_META: Record<
  EditableCuttingField,
  { label: string; options: readonly FieldOption<string>[]; optional: boolean }
> = {
  structuralTechnique: { label: "Structural technique", options: STRUCTURAL_TECHNIQUE_OPTIONS, optional: false },
  cuttingTechnique: { label: "Cutting technique", options: CUTTING_TECHNIQUE_OPTIONS, optional: false },
  texturizingTechnique: { label: "Texturizing technique", options: TEXTURIZING_TECHNIQUE_OPTIONS, optional: true },
  sectioning: { label: "Sectioning", options: CUT_SECTIONING_OPTIONS, optional: false },
  elevation: { label: "Elevation", options: CUT_ELEVATION_OPTIONS, optional: false },
  distribution: { label: "Distribution", options: CUT_DISTRIBUTION_OPTIONS, optional: false },
  guideline: { label: "Guideline", options: CUT_GUIDELINE_OPTIONS, optional: false },
};

// Every Select/Textarea starts from server data (the `proposal` prop), never
// invented client-only state: the seed is exactly
// computeEffectiveCuttingFields(payload, edits).
function seedFormValues(proposal: ProposalRecord): Record<EditableCuttingField, string> {
  const seed = {} as Record<EditableCuttingField, string>;
  for (const entry of computeEffectiveCuttingFields(proposal.payload, proposal.edits)) {
    seed[entry.field] = entry.effectiveValue;
  }
  return seed;
}

export interface ProposedLookDraftEditorProps {
  proposal: ProposalRecord;
  onSave: (edits: ProposalEditEntry[]) => Promise<ProposedLookActionOutcome>;
  onConfirm: () => Promise<ProposedLookActionOutcome>;
  onReject: () => Promise<ProposedLookActionOutcome>;
  confirmConflictMessage: string | null;
}

// The DRAFT-only editable view. Owns local UI-only state (current Select
// values, a reason, per-action busy flags, per-action errors, and the
// reject-confirm Dialog), but everything rendered as "the proposal" derives
// from the `proposal` prop.
//
// After a successful save the PARENT remounts this component with the fresh
// `proposal` (its key includes `proposal.edits.length`), so the form re-seeds
// from the NEW effective values -- never stale ones. The frozen AI/engine
// baseline in `proposal.payload` is only ever annotated, never overwritten.
export function ProposedLookDraftEditor({
  proposal,
  onSave,
  onConfirm,
  onReject,
  confirmConflictMessage,
}: ProposedLookDraftEditorProps) {
  const [formValues, setFormValues] = useState<Record<EditableCuttingField, string>>(() => seedFormValues(proposal));
  const [reason, setReason] = useState("");

  const [savePending, setSavePending] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [rejectPending, setRejectPending] = useState(false);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const currentEffective = computeEffectiveCuttingFields(proposal.payload, proposal.edits);
  const pendingEdits = buildProposalEditEntries(currentEffective, formValues, "stylist_confirmed", reason);
  const nothingToSave = pendingEdits.length === 0;

  async function handleSave() {
    if (pendingEdits.length === 0) {
      return;
    }
    setSavePending(true);
    setSaveError(null);
    const outcome = await onSave(pendingEdits);
    if (!outcome.ok) {
      setSaveError(outcome.message);
    }
    setSavePending(false);
  }

  async function handleConfirm() {
    setConfirmPending(true);
    setConfirmError(null);
    const outcome = await onConfirm();
    // A confirmation conflict is surfaced by the parent as
    // `confirmConflictMessage` (a warning, not an error, and never an auto
    // retry). Only a NON-conflict failure becomes this component's own error.
    if (!outcome.ok && shouldShowConfirmConflictMessage(outcome) === null) {
      setConfirmError(outcome.message);
    }
    setConfirmPending(false);
  }

  async function handleReject() {
    setRejectPending(true);
    setRejectError(null);
    const outcome = await onReject();
    if (!outcome.ok) {
      setRejectError(outcome.message);
      setRejectPending(false);
      return;
    }
    setRejectPending(false);
    setRejectDialogOpen(false);
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-foreground">Draft proposed look</h3>
        <ProposalStatusBadge status={proposal.status} />
      </div>

      <ProposalEvidencePanel evidenceSnapshot={proposal.evidenceSnapshot} />

      <div className="flex flex-col gap-4">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Cutting technique fields</h4>
          <p className="text-xs text-muted">
            The AI/engine baseline is never overwritten -- a professional edit is layered on top and annotated under the
            field.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {currentEffective.map((effective) => {
            const meta = FIELD_META[effective.field];
            return (
              <div key={effective.field} className="flex flex-col gap-1">
                <Select
                  label={meta.label}
                  value={formValues[effective.field]}
                  onChange={(event) =>
                    setFormValues((previous) => ({ ...previous, [effective.field]: event.target.value }))
                  }
                >
                  {meta.optional ? <option value="">None</option> : null}
                  {meta.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                {effective.wasEdited ? (
                  <p className="text-xs font-medium text-warning">
                    Changed from{" "}
                    {effective.baselineValue ? humanizeEnumValue(effective.baselineValue) : "None"} (AI/engine baseline)
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <Textarea
          label="Reason for these changes (optional)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why are you adjusting this proposal?"
        />
      </div>

      <RecommendationPlanBase plan={proposal.payload} planLabel="Haircut plan" />

      {proposal.payload.cuttingSteps.length > 0 ? (
        <div>
          <p className="mb-2 text-xs text-muted">Cutting steps</p>
          <ol className="flex flex-col gap-2">
            {proposal.payload.cuttingSteps.map((step) => (
              <li
                key={`${step.stepNumber}-${step.zone}`}
                className="rounded-xl border border-border bg-surface-alt p-3 text-sm"
              >
                <span className="font-medium text-foreground">
                  Step {step.stepNumber}: {step.zone}
                </span>
                <p className="mt-1 text-muted">{step.action}</p>
                <p className="mt-1 text-xs text-muted">
                  Tool: {step.toolRequired} · Elevation: {humanizeEnumValue(step.elevationAngle)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={handleSave} loading={savePending} disabled={nothingToSave}>
            Save changes
          </Button>
          <Button type="button" variant="primary" onClick={handleConfirm} loading={confirmPending}>
            Confirm
          </Button>
          <Button type="button" variant="danger" onClick={() => setRejectDialogOpen(true)}>
            Reject
          </Button>
        </div>
        {nothingToSave ? <p className="text-xs text-muted">No changes to save yet.</p> : null}

        {saveError ? (
          <Alert variant="error" title="Couldn't save changes">
            {saveError}
          </Alert>
        ) : null}

        {confirmConflictMessage ? (
          <Alert variant="warning" title="Confirmation conflict">
            {confirmConflictMessage}
          </Alert>
        ) : null}

        {confirmError ? (
          <Alert variant="error" title="Couldn't confirm">
            {confirmError}
          </Alert>
        ) : null}
      </div>

      <Dialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        title="Reject proposed look"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setRejectDialogOpen(false)} disabled={rejectPending}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={handleReject} loading={rejectPending}>
              Reject
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Are you sure you want to reject this proposed look? This cannot be undone.
        </p>
        {rejectError ? (
          <Alert variant="error" className="mt-4">
            {rejectError}
          </Alert>
        ) : null}
      </Dialog>
    </Card>
  );
}
