import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { TechnicalVisualMapGlobalIntent } from "@/lib/technical-visual-map-validators";

export interface TechnicalVisualMapGlobalIntentViewProps {
  globalIntent: TechnicalVisualMapGlobalIntent;
}

// Technical Visual Map, Stage 4 -- the confirmed PLAN-LEVEL intent, rendered
// SEPARATELY from the six zone cards. This distinction is critical: these are
// the SAME seven technique fields already approved in Proposed Look, copied
// here once as a read-only mirror -- never six separate zone values, and
// never editable from this map (a global field can only ever be changed by
// going back to Proposed Look and reconfirming, which produces a brand new
// map generation).
export function TechnicalVisualMapGlobalIntentView({ globalIntent }: TechnicalVisualMapGlobalIntentViewProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-alt p-4">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Global approved intent</h4>
        <p className="text-xs text-muted">
          Copied once from the confirmed Proposed Look. To change any of these values, go back to Proposed Look --
          they can&apos;t be edited here.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Structural technique" value={humanizeEnumValue(globalIntent.structuralTechnique)} />
        <Field label="Cutting technique" value={humanizeEnumValue(globalIntent.cuttingTechnique)} />
        {globalIntent.texturizingTechnique ? (
          <Field label="Texturizing technique" value={humanizeEnumValue(globalIntent.texturizingTechnique)} />
        ) : null}
        <Field label="Sectioning" value={humanizeEnumValue(globalIntent.sectioning)} />
        <Field label="Elevation" value={humanizeEnumValue(globalIntent.elevation)} />
        <Field label="Distribution" value={humanizeEnumValue(globalIntent.distribution)} />
        <Field label="Guideline" value={humanizeEnumValue(globalIntent.guideline)} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}
