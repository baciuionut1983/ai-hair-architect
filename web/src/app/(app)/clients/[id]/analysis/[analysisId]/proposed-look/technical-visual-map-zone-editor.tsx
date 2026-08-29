"use client";

import { useState } from "react";

import { Alert, Button, Card, Select } from "@/components/ui";
import { CUT_DISTRIBUTION_OPTIONS, CUT_ELEVATION_OPTIONS } from "@/lib/analysis-field-options";
import {
  ZONE_LENGTH_INTENTS,
  ZONE_WEIGHT_INTENTS,
  type HeadZone,
  type MapAdjustmentEntry,
  type ZoneIntentEntry,
} from "@/lib/technical-visual-map-validators";

import {
  HEAD_ZONE_LABELS,
  ZONE_LENGTH_INTENT_LABELS,
  ZONE_WEIGHT_INTENT_LABELS,
  buildZoneAdjustmentEntries,
  seedZoneFormValues,
  type ZoneFormValues,
} from "./technical-visual-map-logic";
import type { TechnicalVisualMapActionOutcome } from "./use-technical-visual-map";

export interface TechnicalVisualMapZoneEditorProps {
  zone: HeadZone;
  entry: ZoneIntentEntry;
  onSave: (adjustments: MapAdjustmentEntry[]) => Promise<TechnicalVisualMapActionOutcome>;
}

// Technical Visual Map, Stage 4 -- the DRAFT-only zone editor. Only the
// closed, structured controls the Stage 2 adjustment contract actually
// supports for a single zone are exposed here: length intent, weight intent,
// the elevation/distribution/texturizing overrides (reusing the EXISTING
// CUT_ELEVATION_OPTIONS/CUT_DISTRIBUTION_OPTIONS -- never a second,
// hardcoded copy of those enums), and the density-sensitive/preserve
// toggles. There is no generic JSON field here, and no control that could
// ever target a proposal-global field -- the closed MapAdjustmentEntry
// target vocabulary structurally forbids it.
//
// Local form state is seeded from the CURRENT EFFECTIVE zone entry (baseline
// + any adjustments already applied), so re-opening this editor after a save
// never shows stale pre-adjustment values. Saving compares the form against
// that same effective entry and sends only the fields that actually changed
// (buildZoneAdjustmentEntries) -- an unchanged field is never resubmitted.
export function TechnicalVisualMapZoneEditor({ zone, entry, onSave }: TechnicalVisualMapZoneEditorProps) {
  const [formValues, setFormValues] = useState<ZoneFormValues>(() => seedZoneFormValues(entry));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const pendingEntries = buildZoneAdjustmentEntries(zone, entry, formValues);
  const nothingToSave = pendingEntries.length === 0;

  async function handleSave() {
    if (nothingToSave) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const outcome = await onSave(pendingEntries);
    if (!outcome.ok) {
      setError(outcome.message);
    } else {
      setSaved(true);
    }
    setSaving(false);
  }

  function update<K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) {
    setSaved(false);
    setFormValues((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <Card className="flex flex-col gap-3">
      <h4 className="text-base font-semibold text-foreground">{HEAD_ZONE_LABELS[zone]}</h4>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Length intent"
          value={formValues.lengthIntent}
          onChange={(event) => update("lengthIntent", event.target.value as ZoneFormValues["lengthIntent"])}
        >
          {ZONE_LENGTH_INTENTS.map((value) => (
            <option key={value} value={value}>
              {ZONE_LENGTH_INTENT_LABELS[value]}
            </option>
          ))}
        </Select>

        <Select
          label="Weight intent"
          value={formValues.weightIntent}
          onChange={(event) => update("weightIntent", event.target.value as ZoneFormValues["weightIntent"])}
        >
          {ZONE_WEIGHT_INTENTS.map((value) => (
            <option key={value} value={value}>
              {ZONE_WEIGHT_INTENT_LABELS[value]}
            </option>
          ))}
        </Select>

        <Select
          label="Elevation override"
          value={formValues.elevationOverride}
          onChange={(event) => update("elevationOverride", event.target.value as ZoneFormValues["elevationOverride"])}
        >
          <option value="">Not overridden (uses global elevation)</option>
          {CUT_ELEVATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          label="Distribution override"
          value={formValues.distributionOverride}
          onChange={(event) => update("distributionOverride", event.target.value as ZoneFormValues["distributionOverride"])}
        >
          <option value="">Not overridden (uses global distribution)</option>
          {CUT_DISTRIBUTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          label="Localized texturizing"
          value={formValues.texturizingApplicable}
          onChange={(event) => update("texturizingApplicable", event.target.value as ZoneFormValues["texturizingApplicable"])}
        >
          <option value="unspecified">Not specified</option>
          <option value="yes">Applicable</option>
          <option value="no">Not applicable</option>
        </Select>

        <Select
          label="Density-sensitive"
          value={formValues.densitySensitive ? "yes" : "no"}
          onChange={(event) => update("densitySensitive", event.target.value === "yes")}
        >
          <option value="no">No</option>
          <option value="yes">Yes -- handle with care</option>
        </Select>

        <Select
          label="Preserve this zone"
          value={formValues.preserve ? "yes" : "no"}
          onChange={(event) => update("preserve", event.target.value === "yes")}
        >
          <option value="no">No</option>
          <option value="yes">Yes -- do not change</option>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <Button type="button" variant="secondary" onClick={handleSave} loading={saving} disabled={nothingToSave}>
          Save {HEAD_ZONE_LABELS[zone]}
        </Button>
        {nothingToSave ? <p className="text-xs text-muted">No changes to save.</p> : null}
        {saved ? <p className="text-xs font-medium text-success">Saved.</p> : null}
      </div>

      {error ? (
        <Alert variant="error" title="Couldn't save this zone">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}
