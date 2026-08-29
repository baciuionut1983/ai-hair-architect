import { Badge, Card } from "@/components/ui";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { HeadZone, ZoneIntentEntry } from "@/lib/technical-visual-map-validators";

import { HEAD_ZONE_LABELS, ZONE_LENGTH_INTENT_LABELS, ZONE_WEIGHT_INTENT_LABELS, zoneFieldSourceBadgeLabel } from "./technical-visual-map-logic";

export interface TechnicalVisualMapZoneSummaryProps {
  zone: HeadZone;
  entry: ZoneIntentEntry;
}

interface SummaryRow {
  label: string;
  value: string;
  source: string | null;
}

// Read-only zone presentation -- used for the CONFIRMED "Current Technical
// Visual Map" card, SUPERSEDED history rows, and (read-only reference)
// alongside the DRAFT editor's own controls. Always reads from an EFFECTIVE
// zone entry (baseline + adjustments already resolved), never a raw baseline
// alone -- so a professionally-adjusted zone is shown as it actually stands
// today, not as it was originally generated. An empty/unspecified zone is
// never treated as an error: length/weight always render ("Not specified" is
// itself an honest value), and every optional override is simply omitted
// when absent rather than shown as a fabricated default.
export function TechnicalVisualMapZoneSummary({ zone, entry }: TechnicalVisualMapZoneSummaryProps) {
  const rows: SummaryRow[] = [
    { label: "Length", value: ZONE_LENGTH_INTENT_LABELS[entry.lengthIntent], source: zoneFieldSourceBadgeLabel(entry.lengthIntentSource) },
    { label: "Weight", value: ZONE_WEIGHT_INTENT_LABELS[entry.weightIntent], source: zoneFieldSourceBadgeLabel(entry.weightIntentSource) },
  ];
  if (entry.elevationOverride) {
    rows.push({
      label: "Elevation override",
      value: humanizeEnumValue(entry.elevationOverride),
      source: zoneFieldSourceBadgeLabel(entry.elevationOverrideSource ?? "global_default"),
    });
  }
  if (entry.distributionOverride) {
    rows.push({
      label: "Distribution override",
      value: humanizeEnumValue(entry.distributionOverride),
      source: zoneFieldSourceBadgeLabel(entry.distributionOverrideSource ?? "global_default"),
    });
  }
  if (entry.texturizingApplicable !== undefined) {
    rows.push({
      label: "Localized texturizing",
      value: entry.texturizingApplicable ? "Applicable" : "Not applicable",
      source: zoneFieldSourceBadgeLabel(entry.texturizingApplicableSource ?? "global_default"),
    });
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-base font-semibold text-foreground">{HEAD_ZONE_LABELS[zone]}</h4>
        {entry.preserve ? <Badge variant="warning">Preserve</Badge> : null}
        {entry.densitySensitive ? <Badge variant="warning">Density-sensitive</Badge> : null}
      </div>
      <dl className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
            <dt className="text-muted">{row.label}</dt>
            <dd className="flex flex-wrap items-center justify-end gap-1.5 text-right font-medium text-foreground">
              {row.value}
              {row.source ? <span className="text-xs font-normal text-muted">({row.source})</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
