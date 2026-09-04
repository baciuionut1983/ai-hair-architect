import { Alert, Badge } from "@/components/ui";
import type { PlanReadinessResult } from "@/lib/technical-demonstration-cutting-video-readiness";

export interface TechnicalExecutionVideoReadinessSummaryProps {
  readiness: PlanReadinessResult;
}

// Technical Demonstration, Stage 2.5.c -- the smallest honest UI for the
// Technical Execution Video readiness gate. Rendered ONLY alongside a
// CONFIRMED plan (see technical-demonstration-plan-section.tsx, the only
// caller) -- a DRAFT plan is never READY by construction (server-side
// evaluatePlanReadiness's own unconditional check), so there is nothing
// honest to show it there.
//
// Deliberately READ-ONLY: no Generate/Create button anywhere in this file,
// no disabled placeholder either -- Stage 2.5.c's own explicit "prefer NO
// generation CTA in this stage" instruction. `readiness` is always the
// server's own computed result (GET .../technical-demonstration-plans/
// [planId]/readiness) -- this component never recomputes or asserts
// readiness itself, only renders what the server already decided.
//
// NAMING LOCK: this is the TECHNICAL EXECUTION VIDEO readiness gate --
// professional step-by-step execution visualization from a CONFIRMED,
// VIDEO_READY plan. Never to be confused with, or labeled the same as, the
// existing RESULT VIDEO feature (visualization of the expected final
// result) -- the two are unrelated features and this file never renders
// anything that could be mistaken for the Result Video's own UI.
export function TechnicalExecutionVideoReadinessSummary({ readiness }: TechnicalExecutionVideoReadinessSummaryProps) {
  const blockingReasons = [...readiness.planLevelReasons, ...readiness.steps.flatMap((step) => step.reasons)];

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-foreground">Technical Execution Video readiness</h4>
        <Badge variant={readiness.ready ? "success" : "neutral"}>{readiness.ready ? "Ready" : "Not ready"}</Badge>
      </div>

      {readiness.ready ? (
        <p className="text-xs text-muted">
          Version {readiness.planVersion} of this plan has enough approved structured information to support a
          future Technical Execution Video, without inventing any missing technical action.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            Version {readiness.planVersion} of this plan is not yet ready for a Technical Execution Video:
          </p>
          <div className="flex flex-col gap-1.5">
            {blockingReasons.map((reason, index) => (
              <Alert key={`${reason.stepNumber ?? "plan"}-${reason.field ?? reason.code}-${index}`} variant="warning">
                {reason.message}
              </Alert>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
