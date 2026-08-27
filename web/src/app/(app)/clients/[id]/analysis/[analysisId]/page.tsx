"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import {
  AnalysisOriginalPhoto,
  ColorPlanView,
  getConfidenceBadgeVariant,
  TechnicalCutPlanView,
  TreatmentPlanView
} from "@/components/analysis";
import { ConsultationChat } from "@/components/consultation";
import { Alert, Badge, Card, ErrorState, LoadingState } from "@/components/ui";

import { formatOverallConfidenceLabel } from "./analysis-result-logic";
import { ProposedLookSection } from "./proposed-look/proposed-look-section";
import { useAnalysisResult } from "./use-analysis-result";

export default function AnalysisResultPage() {
  const params = useParams<{ id: string; analysisId: string }>();
  const clientId = params.id;
  const analysisId = params.analysisId;
  const [state, reload] = useAnalysisResult(analysisId);

  const backLink = (
    <Link href={`/clients/${clientId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to client
    </Link>
  );

  if (state.status === "loading") {
    return <LoadingState label="Loading analysis..." />;
  }

  if (state.status === "not-found") {
    return (
      <ErrorState
        title="Analysis not found"
        description="This analysis doesn't exist or is not available."
        action={backLink}
      />
    );
  }

  if (state.status === "error") {
    return (
      <ErrorState
        title="Couldn't load this analysis"
        description="Please try refreshing the page."
        action={backLink}
      />
    );
  }

  const { result } = state;

  return (
    <div className="flex flex-col gap-6">
      <div>
        {backLink}
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Analysis result</h1>
      </div>

      <AnalysisOriginalPhoto imageAssetId={result.imageAssetId} />

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={getConfidenceBadgeVariant(result.confidenceScore)}>
            {formatOverallConfidenceLabel(result.confidenceScore)}
          </Badge>
        </div>

        {result.recommendations.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold text-foreground">Summary</h2>
            <ul className="list-inside list-disc text-sm text-foreground">
              {result.recommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {result.safetyNotes.length > 0 ? (
          <ul className="list-inside list-disc text-sm text-muted">
            {result.safetyNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        {result.uncertaintyReasons.length > 0 ? (
          <Alert variant="warning">{result.uncertaintyReasons.join(" ")}</Alert>
        ) : null}
      </Card>

      {result.technicalCutPlan ? <TechnicalCutPlanView plan={result.technicalCutPlan} /> : null}
      {result.colorPlan ? <ColorPlanView plan={result.colorPlan} /> : null}
      {result.treatmentPlan ? <TreatmentPlanView plan={result.treatmentPlan} /> : null}

      <ProposedLookSection
        clientId={clientId}
        analysisId={analysisId}
        technicalCutPlan={result.technicalCutPlan}
        analysisUpdatedAt={result.updatedAt}
      />

      <ConsultationChat clientId={clientId} analysisId={analysisId} onCorrectionApplied={reload} />
    </div>
  );
}
