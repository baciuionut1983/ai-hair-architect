import { Alert, Badge } from "@/components/ui";

import type { TechnicalDemonstrationCoherenceResult } from "./use-technical-demonstration-coherence";

export interface TechnicalDemonstrationCoherenceSummaryProps {
  coherence: TechnicalDemonstrationCoherenceResult;
}

// Technical Demonstration, Stage 2.5.g.2 -- the smallest honest UI for
// Professional Coherence, VISIBILITY ONLY. Mirrors
// TechnicalExecutionVideoReadinessSummary's own structure exactly (a
// clearly separate section, a status Badge, server-provided messages
// rendered verbatim, no Generate/Confirm/enforcement affordance of any
// kind) -- but coherence and readiness are DELIBERATELY two separate
// sections, never merged into one list: readiness answers "is this
// complete enough", coherence answers "do the populated fields agree with
// each other" -- a field can be complete but incoherent, or incomplete but
// not incoherent, and both must stay independently understandable (Stage
// 2.5.g decision lock).
//
// `coherence` is always the server's own computed result (GET .../
// technical-demonstration-plans/[planId]/coherence) -- this component
// never recomputes, re-derives, or infers anything from free text; every
// finding's own `message` is rendered exactly as the server produced it,
// never rewritten or summarized into a different meaning.
//
// NO ENFORCEMENT: no disabled/hidden Confirm button, no blocking dialog,
// no video-generation CTA anywhere in this file -- Stage 2.5.g.2's own
// explicit "visibility before enforcement" scope. A BLOCKER finding is
// shown with the most severe styling available, but it never disables
// anything on this screen.
export function TechnicalDemonstrationCoherenceSummary({ coherence }: TechnicalDemonstrationCoherenceSummaryProps) {
  const { blockers, warnings, reviewItems } = coherence;
  const isCleanPass = coherence.pass && warnings.length === 0 && reviewItems.length === 0;
  const badgeVariant = blockers.length > 0 ? "danger" : warnings.length > 0 || reviewItems.length > 0 ? "warning" : "success";

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-foreground">Professional Coherence</h4>
        <Badge variant={badgeVariant}>{isCleanPass ? "Pass" : "Review required"}</Badge>
      </div>

      {isCleanPass ? (
        <p className="text-xs text-muted">
          Version {coherence.planVersion} of this plan&apos;s populated structured fields do not contradict each
          other, under the current coherence rules ({coherence.coherenceRulesVersion}).
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {blockers.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-foreground">Blocking contradictions</p>
              {blockers.map((finding, index) => (
                <Alert key={`blocker-${finding.stepNumber ?? "plan"}-${index}`} variant="error">
                  {finding.message}
                </Alert>
              ))}
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-foreground">Warnings</p>
              {warnings.map((finding, index) => (
                <Alert key={`warning-${finding.stepNumber ?? "plan"}-${index}`} variant="warning">
                  {finding.message}
                </Alert>
              ))}
            </div>
          ) : null}

          {reviewItems.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-foreground">Professional review</p>
              {reviewItems.map((finding, index) => (
                <Alert key={`review-${finding.stepNumber ?? "plan"}-${index}`} variant="info">
                  {finding.message}
                </Alert>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
