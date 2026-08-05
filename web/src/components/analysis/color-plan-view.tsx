import { Alert, Badge, Card } from "@/components/ui";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { ColorPlan } from "@/lib/contracts";

import { RecommendationPlanBase } from "./plan-base";

export interface ColorPlanViewProps {
  plan: ColorPlan;
}

export function ColorPlanView({ plan }: ColorPlanViewProps) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-foreground">Color plan</h3>
        {plan.strandTestRequired ? <Badge variant="warning">Strand test required</Badge> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Formula direction" value={humanizeEnumValue(plan.formulaDirection)} />
        <Field label="Developer volume" value={plan.developerVolume} />
        <Field label="Lift levels" value={String(plan.liftLevels)} />
        <Field label="Tone direction" value={humanizeEnumValue(plan.toneDirection)} />
        <Field label="Application technique" value={humanizeEnumValue(plan.applicationTechnique)} />
      </div>

      {plan.processingSteps.length > 0 ? (
        <div>
          <p className="mb-2 text-xs text-muted">Processing steps</p>
          <ol className="flex flex-col gap-2">
            {plan.processingSteps.map((step) => (
              <li key={`${step.stepNumber}-${step.zone}`} className="rounded-xl border border-border bg-surface-alt p-3 text-sm">
                <span className="font-medium text-foreground">
                  Step {step.stepNumber}: {step.zone}
                </span>
                <p className="mt-1 text-muted">{step.action}</p>
                <p className="mt-1 text-xs text-muted">
                  Tool: {step.toolRequired}
                  {typeof step.processingTimeMinutes === "number" ? ` · ${step.processingTimeMinutes} min` : ""}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {plan.maintenancePlan.length > 0 ? (
        <div>
          <p className="mb-2 text-xs text-muted">Maintenance plan</p>
          <ul className="list-inside list-disc text-sm text-foreground">
            {plan.maintenancePlan.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.strandTestRequired ? (
        <Alert variant="warning">A strand test is required before applying this formula.</Alert>
      ) : null}

      <RecommendationPlanBase plan={plan} />
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
