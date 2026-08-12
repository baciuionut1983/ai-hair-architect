import { Card } from "@/components/ui";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { TreatmentPlan } from "@/lib/contracts";

import { RecommendationPlanBase } from "./plan-base";

export interface TreatmentPlanViewProps {
  plan: TreatmentPlan;
}

export function TreatmentPlanView({ plan }: TreatmentPlanViewProps) {
  return (
    <Card className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-foreground">Treatment plan</h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Category" value={humanizeEnumValue(plan.treatmentCategory)} />
        <Field label="Recommended frequency" value={humanizeEnumValue(plan.recommendedFrequency)} />
        <Field label="Follow-up review" value={`${plan.followUpReviewWeeks} week(s)`} />
      </div>

      {plan.protocolSteps.length > 0 ? (
        <div>
          <p className="mb-2 text-xs text-muted">Protocol steps</p>
          <ol className="flex flex-col gap-2">
            {plan.protocolSteps.map((step) => (
              <li key={`${step.stepNumber}-${step.zone}`} className="rounded-xl border border-border bg-surface-alt p-3 text-sm">
                <span className="font-medium text-foreground">
                  Step {step.stepNumber}: {step.zone}
                </span>
                <p className="mt-1 text-muted">{step.action}</p>
                <p className="mt-1 text-xs text-muted">Tool: {step.toolRequired}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {plan.aftercareSteps.length > 0 ? (
        <div>
          <p className="mb-2 text-xs text-muted">Aftercare</p>
          <ul className="list-inside list-disc text-sm text-foreground">
            {plan.aftercareSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <RecommendationPlanBase plan={plan} planLabel="Treatment plan" />
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
