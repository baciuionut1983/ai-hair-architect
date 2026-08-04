import type {
  AnalysisClarifyRequest,
  AnalysisCreateRecordInput,
  AnalysisEngineInput,
  AnalysisState
} from "./milestone2-types";

import { ANALYSIS_READY_THRESHOLD, MAX_CLARIFICATION_ROUNDS } from "./analysis-thresholds";
import { generateColorPlan, shouldGenerateColorPlan } from "./color-plan-engine";
import { generateTechnicalCutPlan, shouldGenerateTechnicalCutPlan } from "./cutting-plan-engine";
import { readable } from "./recommendation-engine-shared";
import { generateTreatmentPlan, shouldGenerateTreatmentPlan } from "./treatment-plan-engine";

function isLikelyLowConfidence(input: AnalysisEngineInput): boolean {
  return input.goal === "lighten" || input.porosity === "high" || input.hairType === "fine";
}

export function analyzeInitial(input: AnalysisEngineInput): AnalysisCreateRecordInput {
  const lowConfidence = isLikelyLowConfidence(input);
  const confidenceScore = lowConfidence ? 0.62 : 0.87;
  const technicalCutPlan = shouldGenerateTechnicalCutPlan(input)
    ? generateTechnicalCutPlan(input)
    : undefined;
  const colorPlan = shouldGenerateColorPlan(input) ? generateColorPlan(input) : undefined;
  const treatmentPlan = shouldGenerateTreatmentPlan(input) ? generateTreatmentPlan(input) : undefined;
  const uncertaintyReasons = lowConfidence
    ? [
        "High-risk combination detected for target service.",
        "Chemical history and elasticity details are incomplete."
      ]
    : [];
  const followUpQuestions = lowConfidence
    ? [
        "Did the client bleach in the last 90 days?",
        "Is there visible breakage or strong elasticity loss?"
      ]
    : [];

  // M27: each domain engine that fires contributes its own summary lines to
  // the flat recommendations/safetyNotes arrays (backward-compatible with
  // every existing consumer), in addition to exposing its own full
  // structured plan below. Haircut is checked first so recommendations[0]
  // stays the haircut summary whenever technicalCutPlan fires, unchanged
  // from pre-M27 behavior. The three engines are independently triggered --
  // a Color plan's warnings may suggest a Treatment plan first, but nothing
  // here ever auto-generates a plan the caller's input didn't itself
  // request.
  const recommendations: string[] = [];
  const safetyNotes: string[] = [];

  if (technicalCutPlan) {
    recommendations.push(
      `Structural technique: ${technicalCutPlan.structuralTechnique.replaceAll("_", " ")} with cutting technique ${technicalCutPlan.cuttingTechnique.replaceAll("_", " ")}${technicalCutPlan.texturizingTechnique ? ` and texturizing finish ${technicalCutPlan.texturizingTechnique.replaceAll("_", " ")}` : ""}.`,
      technicalCutPlan.professionalReason,
      "Document the cutting map in the consultation record for repeatable execution."
    );
    safetyNotes.push(...technicalCutPlan.warnings, technicalCutPlan.stylistValidationDisclaimer);
  }

  if (colorPlan) {
    recommendations.push(
      `Color direction: ${readable(colorPlan.formulaDirection)} with ${colorPlan.developerVolume} developer.`,
      colorPlan.professionalReason,
      "Document the formula direction in the consultation record for repeatable execution."
    );
    safetyNotes.push(...colorPlan.warnings, colorPlan.stylistValidationDisclaimer);
  }

  if (treatmentPlan) {
    recommendations.push(
      `Treatment category: ${readable(treatmentPlan.treatmentCategory)} at a ${readable(treatmentPlan.recommendedFrequency)} cadence.`,
      treatmentPlan.professionalReason,
      "Document the treatment protocol in the consultation record for repeatable execution."
    );
    safetyNotes.push(...treatmentPlan.warnings, treatmentPlan.stylistValidationDisclaimer);
  }

  if (!technicalCutPlan && !colorPlan && !treatmentPlan) {
    recommendations.push(
      "Use conservative formula strategy and document service context.",
      "Save follow-up protocol in client timeline for safer next visit."
    );
    safetyNotes.push("Perform strand test before high-lift or correction services.");
  }

  return {
    ...input,
    phase: confidenceScore >= ANALYSIS_READY_THRESHOLD ? "ready" : "pending_questions",
    confidenceScore,
    uncertaintyReasons,
    followUpQuestions,
    recommendations,
    safetyNotes,
    clarificationRound: 0,
    technicalCutPlan,
    colorPlan,
    treatmentPlan
  };
}

export function analyzeWithClarifications(
  current: AnalysisState,
  request: AnalysisClarifyRequest
): Omit<AnalysisState, "id" | "clientId" | "createdByUserId" | "createdAt" | "updatedAt"> {
  const mergedAnswers = [...current.clarificationAnswers, ...request.answers].slice(0, 10);
  const positiveAnswers = mergedAnswers.filter((answer) => {
    const lowered = answer.toLowerCase();
    return lowered.includes("no") || lowered.includes("healthy") || lowered.includes("safe");
  }).length;

  const nextRound = current.clarificationRound + 1;
  const confidenceBoost = Math.min(0.18, positiveAnswers * 0.06);
  const confidenceScore = Math.min(0.95, current.confidenceScore + confidenceBoost + 0.07);
  const reachedMaxRounds = nextRound >= MAX_CLARIFICATION_ROUNDS;
  const phase =
    confidenceScore >= ANALYSIS_READY_THRESHOLD || reachedMaxRounds ? "ready" : "pending_questions";

  const stillPendingQuestions = phase === "pending_questions"
    ? [
        "Any scalp sensitivity during the last coloring service?",
        "Was heat styling used daily in the last two weeks?"
      ]
    : [];

  const uncertaintyReasons =
    phase === "ready"
      ? []
      : ["Additional consultation details are still required for safer execution."];

  return {
    goal: current.goal,
    hairType: current.hairType,
    density: current.density,
    porosity: current.porosity,
    faceShape: current.faceShape,
    headShape: current.headShape,
    hairLength: current.hairLength,
    hairTexture: current.hairTexture,
    hairCondition: current.hairCondition,
    growthPattern: current.growthPattern,
    targetShape: current.targetShape,
    desiredColorResult: current.desiredColorResult,
    grayPercentage: current.grayPercentage,
    scalpCondition: current.scalpCondition,
    treatmentGoalDetail: current.treatmentGoalDetail,
    phase,
    confidenceScore,
    uncertaintyReasons,
    followUpQuestions: stillPendingQuestions,
    recommendations: current.recommendations,
    safetyNotes: current.safetyNotes,
    technicalCutPlan: current.technicalCutPlan,
    colorPlan: current.colorPlan,
    treatmentPlan: current.treatmentPlan,
    clarificationAnswers: mergedAnswers,
    clarificationRound: nextRound
  };
}
