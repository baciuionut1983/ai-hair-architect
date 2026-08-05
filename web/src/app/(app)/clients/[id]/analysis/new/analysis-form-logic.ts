import type {
  AnalysisGoal,
  AnalysisRequest,
  DensityLevel,
  DesiredColorResult,
  FaceShape,
  GrayPercentage,
  GrowthPattern,
  HairCondition,
  HairLength,
  HairTexture,
  HairType,
  HeadShape,
  PorosityLevel,
  ScalpCondition,
  TargetShape,
  TreatmentGoalDetail
} from "@/lib/contracts";

// M31 GO-3: pure form logic, kept separate from the page component so the
// rules that decide which fields are relevant, and how the form maps onto
// AnalysisRequest, are unit-testable without a rendering environment.

export type RelevantFieldGroup = "cut" | "color" | "treatment" | "none";

// Mirrors the exact trigger conditions read directly from the M27 engines
// (shouldGenerateTechnicalCutPlan / shouldGenerateColorPlan /
// shouldGenerateTreatmentPlan): "refresh" and "correct" are deliberately
// ambiguous goals that trigger no plan on their own, so no domain-specific
// fields are relevant for them.
export function getRelevantFieldGroup(goal: AnalysisGoal | ""): RelevantFieldGroup {
  if (goal === "reshape") return "cut";
  if (goal === "cover" || goal === "lighten") return "color";
  if (goal === "treat") return "treatment";
  return "none";
}

export interface AnalysisFormValues {
  goal: AnalysisGoal | "";
  hairType: HairType;
  density: DensityLevel;
  porosity: PorosityLevel;
  faceShape: FaceShape | "";
  headShape: HeadShape | "";
  hairLength: HairLength | "";
  hairTexture: HairTexture | "";
  hairCondition: HairCondition | "";
  growthPattern: GrowthPattern | "";
  targetShape: TargetShape | "";
  desiredColorResult: DesiredColorResult | "";
  grayPercentage: GrayPercentage | "";
  scalpCondition: ScalpCondition | "";
  treatmentGoalDetail: TreatmentGoalDetail | "";
}

export const DEFAULT_ANALYSIS_FORM: AnalysisFormValues = {
  goal: "",
  hairType: "medium",
  density: "medium",
  porosity: "medium",
  faceShape: "",
  headShape: "",
  hairLength: "",
  hairTexture: "",
  hairCondition: "",
  growthPattern: "",
  targetShape: "",
  desiredColorResult: "",
  grayPercentage: "",
  scalpCondition: "",
  treatmentGoalDetail: ""
};

export function canStartAnalysis(form: AnalysisFormValues): boolean {
  return form.goal !== "";
}

// Returns null when the (mandatory) goal is missing, instead of throwing --
// callers decide how to surface that as a validation message. Only sends
// the conditional fields that are actually relevant to the selected goal,
// per M31 GO-1's explicit "don't ask for fields just for implementation
// convenience" instruction; hairCondition is included in all three active
// groups because generateColorPlan/generateTreatmentPlan/
// generateTechnicalCutPlan all read it directly (verified in the M27
// engines, not assumed).
export function buildAnalysisRequest(clientId: string, form: AnalysisFormValues): AnalysisRequest | null {
  if (form.goal === "") {
    return null;
  }

  const request: AnalysisRequest = {
    clientId,
    goal: form.goal,
    hairType: form.hairType,
    density: form.density,
    porosity: form.porosity
  };

  const group = getRelevantFieldGroup(form.goal);

  if (group === "cut") {
    if (form.faceShape) request.faceShape = form.faceShape;
    if (form.headShape) request.headShape = form.headShape;
    if (form.hairLength) request.hairLength = form.hairLength;
    if (form.hairTexture) request.hairTexture = form.hairTexture;
    if (form.hairCondition) request.hairCondition = form.hairCondition;
    if (form.growthPattern) request.growthPattern = form.growthPattern;
    if (form.targetShape) request.targetShape = form.targetShape;
  } else if (group === "color") {
    if (form.desiredColorResult) request.desiredColorResult = form.desiredColorResult;
    if (form.grayPercentage) request.grayPercentage = form.grayPercentage;
    if (form.hairCondition) request.hairCondition = form.hairCondition;
  } else if (group === "treatment") {
    if (form.treatmentGoalDetail) request.treatmentGoalDetail = form.treatmentGoalDetail;
    if (form.scalpCondition) request.scalpCondition = form.scalpCondition;
    if (form.hairCondition) request.hairCondition = form.hairCondition;
  }

  return request;
}

// Mirrors the exact behavior of the pre-existing milestone2-analysis-panel.tsx:
// trim every answer, drop empty ones, send whatever remains (the backend
// only requires answers.length > 0, not a 1:1 match with followUpQuestions).
export function collectClarificationAnswers(inputs: string[]): string[] {
  return inputs.map((input) => input.trim()).filter(Boolean);
}
