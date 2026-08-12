import { Card } from "@/components/ui";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { TechnicalCutPlan } from "@/lib/contracts";

import { RecommendationPlanBase } from "./plan-base";

export interface TechnicalCutPlanViewProps {
  plan: TechnicalCutPlan;
}

export function TechnicalCutPlanView({ plan }: TechnicalCutPlanViewProps) {
  return (
    <Card className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-foreground">Haircut plan</h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Structural technique" value={humanizeEnumValue(plan.structuralTechnique)} />
        <Field label="Cutting technique" value={humanizeEnumValue(plan.cuttingTechnique)} />
        {plan.texturizingTechnique ? (
          <Field label="Texturizing technique" value={humanizeEnumValue(plan.texturizingTechnique)} />
        ) : null}
        <Field label="Sectioning" value={humanizeEnumValue(plan.sectioning)} />
        <Field label="Elevation" value={humanizeEnumValue(plan.elevation)} />
        <Field label="Distribution" value={humanizeEnumValue(plan.distribution)} />
        <Field label="Guideline" value={humanizeEnumValue(plan.guideline)} />
      </div>

      {plan.cuttingSteps.length > 0 ? (
        <div>
          <p className="mb-2 text-xs text-muted">Cutting steps</p>
          <ol className="flex flex-col gap-2">
            {plan.cuttingSteps.map((step) => (
              <li key={`${step.stepNumber}-${step.zone}`} className="rounded-xl border border-border bg-surface-alt p-3 text-sm">
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

      <RecommendationPlanBase plan={plan} planLabel="Haircut plan" />
    </Card>
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
