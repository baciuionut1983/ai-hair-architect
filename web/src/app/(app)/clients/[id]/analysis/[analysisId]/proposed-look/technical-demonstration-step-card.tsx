import { Card } from "@/components/ui";
import type { TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";

import { resolveStepConstraints, resolveStepFieldRows } from "./technical-demonstration-plan-logic";
import { TechnicalDemonstrationProvenanceBadge } from "./technical-demonstration-provenance-badge";

export interface TechnicalDemonstrationStepCardProps {
  step: TechnicalDemonstrationStepRecord;
}

// Technical Demonstration, Stage 2 -- one ordered execution step, rendered
// for professional review. Never dumps raw JSON (Decision Lock's own
// explicit requirement): only fields the derivation actually populated for
// THIS step are shown as structured rows, each with its own provenance
// badge; the human-readable `explanation` is shown separately, clearly
// distinguished from the structured fields (never parsed as one of them).
// UNKNOWN fields are listed too, but honestly, as a muted "not yet
// available" note -- never omitted entirely (the professional needs to see
// what the plan does NOT yet know, not just what it does) and never styled
// as an error.
export function TechnicalDemonstrationStepCard({ step }: TechnicalDemonstrationStepCardProps) {
  const { populated, unknown } = resolveStepFieldRows(step.payload);
  const constraints = resolveStepConstraints(step.payload);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-base font-semibold text-foreground">Step {step.stepNumber}</h4>
      </div>

      {step.explanation ? <p className="text-sm text-foreground">{step.explanation}</p> : null}

      {populated.length > 0 ? (
        <dl className="flex flex-col gap-1.5">
          {populated.map((row) => (
            <div key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-muted">{row.label}</dt>
              <dd className="flex flex-wrap items-center justify-end gap-1.5 text-right font-medium text-foreground">
                {row.value}
                <TechnicalDemonstrationProvenanceBadge provenance={row.provenance} />
              </dd>
            </div>
          ))}
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

      {unknown.length > 0 ? (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">Not yet available for this step ({unknown.length})</summary>
          <p className="mt-1">
            The current approved data does not support these technical details yet -- nothing has been invented for
            them.
          </p>
          <ul className="mt-1 list-inside list-disc">
            {unknown.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
