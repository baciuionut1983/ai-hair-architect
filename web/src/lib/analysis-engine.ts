import type { ColorPlan, HairCondition, TechnicalCutPlan, TreatmentPlan } from "./contracts";
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

// M27: each domain engine that fires contributes its own summary lines to
// the flat recommendations/safetyNotes arrays (backward-compatible with
// every existing consumer), in addition to exposing its own full
// structured plan. Haircut is checked first so recommendations[0] stays the
// haircut summary whenever technicalCutPlan fires, unchanged from pre-M27
// behavior. Shared by analyzeInitial and analyzeWithClarifications so a
// clarification-triggered recomputation produces recommendations/
// safetyNotes through the exact same logic as the first computation --
// never a second, drifting copy.
function buildRecommendationsAndSafetyNotes(
  technicalCutPlan: TechnicalCutPlan | undefined,
  colorPlan: ColorPlan | undefined,
  treatmentPlan: TreatmentPlan | undefined
): { recommendations: string[]; safetyNotes: string[] } {
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

  return { recommendations, safetyNotes };
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

  const { recommendations, safetyNotes } = buildRecommendationsAndSafetyNotes(technicalCutPlan, colorPlan, treatmentPlan);

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

// This codebase's two fixed low-confidence clarification questions are
// professionally designed to elicit exactly the two criteria the
// HairCondition enum is built from: recent chemical processing, and visible
// breakage/elasticity loss. Matched by exact question text against
// followUpQuestions -- the only two questions analyzeInitial ever asks --
// so this generalizes to every low-confidence analysis, not one photo.
// Never invents "yes"/"no" from an ambiguous answer, and never overwrites a
// hairCondition already known from the photo/manual form with a weaker
// inference from a clarification answer.
const BLEACH_QUESTION = "Did the client bleach in the last 90 days?";
const BREAKAGE_QUESTION = "Is there visible breakage or strong elasticity loss?";

function parseYesNo(answer: string | undefined): boolean | null {
  if (!answer) return null;
  const lowered = answer.trim().toLowerCase();
  if (/\byes\b/.test(lowered)) return true;
  if (/\bno\b/.test(lowered)) return false;
  return null;
}

export function deriveHairConditionFromClarifications(
  questionsAsked: string[],
  answersGiven: string[],
  existing: HairCondition | undefined
): HairCondition | undefined {
  if (existing) return existing;

  const answerTo = (question: string): boolean | null => {
    const index = questionsAsked.indexOf(question);
    if (index === -1) return null;
    return parseYesNo(answersGiven[index]);
  };

  const breakage = answerTo(BREAKAGE_QUESTION);
  if (breakage === true) return "fragile_breakage";

  const bleached = answerTo(BLEACH_QUESTION);
  if (bleached === true) return "chemically_treated";

  if (bleached === false && breakage === false) return "virgin_healthy";

  return existing;
}

export function analyzeWithClarifications(
  current: AnalysisState,
  request: AnalysisClarifyRequest
): Omit<AnalysisState, "id" | "clientId" | "createdByUserId" | "createdAt" | "updatedAt"> {
  // request.answers is position-aligned with current.followUpQuestions (the
  // questions the caller was actually shown this round) -- required to know
  // which specific answer belongs to which question. clarificationAnswers
  // (the persisted audit log) keeps its pre-existing semantics: only
  // non-empty answers, never blanks.
  const derivedHairCondition = deriveHairConditionFromClarifications(
    current.followUpQuestions,
    request.answers,
    current.hairCondition
  );

  const nonEmptyAnswers = request.answers.map((answer) => answer.trim()).filter(Boolean);
  const mergedAnswers = [...current.clarificationAnswers, ...nonEmptyAnswers].slice(0, 10);
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

  // The updated (possibly clarification-derived) input is what actually
  // gets re-planned -- this is the fix: a relevant clarification answer now
  // reaches the same deterministic engines analyzeInitial uses, instead of
  // only ever nudging confidence while leaving the original plan/warnings/
  // missingData/assumptions frozen from before the clarification existed.
  const updatedInput: AnalysisEngineInput = {
    goal: current.goal,
    hairType: current.hairType,
    density: current.density,
    porosity: current.porosity,
    faceShape: current.faceShape,
    headShape: current.headShape,
    hairLength: current.hairLength,
    hairTexture: current.hairTexture,
    hairCondition: derivedHairCondition,
    growthPattern: current.growthPattern,
    targetShape: current.targetShape,
    desiredColorResult: current.desiredColorResult,
    grayPercentage: current.grayPercentage,
    scalpCondition: current.scalpCondition,
    treatmentGoalDetail: current.treatmentGoalDetail
  };

  const technicalCutPlan = shouldGenerateTechnicalCutPlan(updatedInput)
    ? generateTechnicalCutPlan(updatedInput)
    : undefined;
  const colorPlan = shouldGenerateColorPlan(updatedInput) ? generateColorPlan(updatedInput) : undefined;
  const treatmentPlan = shouldGenerateTreatmentPlan(updatedInput) ? generateTreatmentPlan(updatedInput) : undefined;

  const { recommendations, safetyNotes } = buildRecommendationsAndSafetyNotes(technicalCutPlan, colorPlan, treatmentPlan);

  return {
    ...updatedInput,
    phase,
    confidenceScore,
    uncertaintyReasons,
    followUpQuestions: stillPendingQuestions,
    recommendations,
    safetyNotes,
    technicalCutPlan,
    colorPlan,
    treatmentPlan,
    clarificationAnswers: mergedAnswers,
    clarificationRound: nextRound
  };
}
