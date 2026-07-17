import type {
  AnalysisClarifyRequest,
  AnalysisCreateRecordInput,
  AnalysisEngineInput,
  AnalysisState
} from "./milestone2-types";

import { ANALYSIS_READY_THRESHOLD, MAX_CLARIFICATION_ROUNDS } from "./analysis-thresholds";
import { generateTechnicalCutPlan, shouldGenerateTechnicalCutPlan } from "./cutting-plan-engine";

function isLikelyLowConfidence(input: AnalysisEngineInput): boolean {
  return input.goal === "lighten" || input.porosity === "high" || input.hairType === "fine";
}

export function analyzeInitial(input: AnalysisEngineInput): AnalysisCreateRecordInput {
  const lowConfidence = isLikelyLowConfidence(input);
  const confidenceScore = lowConfidence ? 0.62 : 0.87;
  const technicalCutPlan = shouldGenerateTechnicalCutPlan(input)
    ? generateTechnicalCutPlan(input)
    : undefined;
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

  return {
    ...input,
    phase: confidenceScore >= ANALYSIS_READY_THRESHOLD ? "ready" : "pending_questions",
    confidenceScore,
    uncertaintyReasons,
    followUpQuestions,
    recommendations: technicalCutPlan
      ? [
          `Structural technique: ${technicalCutPlan.structuralTechnique.replaceAll("_", " ")} with cutting technique ${technicalCutPlan.cuttingTechnique.replaceAll("_", " ")}${technicalCutPlan.texturizingTechnique ? ` and texturizing finish ${technicalCutPlan.texturizingTechnique.replaceAll("_", " ")}` : ""}.`,
          technicalCutPlan.professionalReason,
          "Document the cutting map in the consultation record for repeatable execution."
        ]
      : [
          "Use conservative formula strategy and document service context.",
          "Save follow-up protocol in client timeline for safer next visit."
        ],
    safetyNotes: technicalCutPlan
      ? [
          ...technicalCutPlan.warnings,
          technicalCutPlan.stylistValidationDisclaimer
        ]
      : ["Perform strand test before high-lift or correction services."],
    clarificationRound: 0,
    technicalCutPlan
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
    phase,
    confidenceScore,
    uncertaintyReasons,
    followUpQuestions: stillPendingQuestions,
    recommendations: current.recommendations,
    safetyNotes: current.safetyNotes,
    technicalCutPlan: current.technicalCutPlan,
    clarificationAnswers: mergedAnswers,
    clarificationRound: nextRound
  };
}
