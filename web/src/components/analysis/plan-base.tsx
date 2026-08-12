import type { BadgeVariant } from "@/components/ui";
import { Alert, Badge } from "@/components/ui";
// Type-only import from the M27 engine's shared module -- reuses the exact
// shape ColorPlan/TreatmentPlan already extend, rather than redefining a
// parallel interface. Zero runtime dependency on engine logic; this is a
// display component, not a modification of any recommendation engine.
import type { BaseRecommendationPlan } from "@/lib/recommendation-engine-shared";

export function getConfidenceBadgeVariant(confidence: number): BadgeVariant {
  if (confidence >= 0.7) return "success";
  if (confidence >= 0.4) return "warning";
  return "danger";
}

// This plan-level confidence (calculateRecommendationConfidence, penalized
// per missing optional field/warning/contraindication specific to THIS
// plan) is a different metric from Analysis.confidenceScore (the coarse,
// overall-analysis gate shown separately -- see
// analysis-result-logic.ts's formatOverallConfidenceLabel). The two are
// intentionally never synchronized; this label exists so the UI never
// presents them as if they were the same number under the same word.
export type RecommendationPlanLabel = "Haircut plan" | "Color plan" | "Treatment plan";

export function formatPlanConfidenceLabel(planLabel: RecommendationPlanLabel, confidence: number): string {
  return `${planLabel} confidence: ${Math.round(confidence * 100)}%`;
}

export interface RecommendationPlanBaseProps {
  plan: BaseRecommendationPlan;
  planLabel: RecommendationPlanLabel;
}

// M31 GO-2: shared rendering for the fields every M27 recommendation plan
// (TechnicalCutPlan, ColorPlan, TreatmentPlan) has in common. Each
// domain-specific view (technical-cut-plan-view.tsx, color-plan-view.tsx,
// treatment-plan-view.tsx) renders only its own extra fields and embeds
// this component for everything else, so the common-field markup exists
// exactly once.
export function RecommendationPlanBase({ plan, planLabel }: RecommendationPlanBaseProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={getConfidenceBadgeVariant(plan.confidence)}>
          {formatPlanConfidenceLabel(planLabel, plan.confidence)}
        </Badge>
        <span className="text-xs text-muted">v{plan.version}</span>
      </div>

      <div>
        <p className="text-xs text-muted">For the stylist</p>
        <p className="text-sm text-foreground">{plan.stylistExplanation}</p>
      </div>

      <div>
        <p className="text-xs text-muted">For the client</p>
        <p className="text-sm text-foreground">{plan.clientExplanation}</p>
      </div>

      <div>
        <p className="text-xs text-muted">Professional reasoning</p>
        <p className="text-sm text-foreground">{plan.professionalReason}</p>
      </div>

      {plan.warnings.length > 0 ? (
        <Alert variant="warning" title="Warnings">
          <ul className="list-inside list-disc">
            {plan.warnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {plan.contraindications.length > 0 ? (
        <Alert variant="error" title="Contraindications">
          <ul className="list-inside list-disc">
            {plan.contraindications.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {plan.assumptions.length > 0 ? (
        <div>
          <p className="text-xs text-muted">Assumptions</p>
          <ul className="list-inside list-disc text-sm text-muted">
            {plan.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.missingData.length > 0 ? (
        <div>
          <p className="text-xs text-muted">Missing data</p>
          <ul className="list-inside list-disc text-sm text-muted">
            {plan.missingData.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.notes?.length ? (
        <div>
          <p className="text-xs text-muted">Notes</p>
          <ul className="list-inside list-disc text-sm text-muted">
            {plan.notes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Alert variant="info">{plan.stylistValidationDisclaimer}</Alert>
    </div>
  );
}
