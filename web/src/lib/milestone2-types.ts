import type {
  AnalysisGoal,
  ColorPlan,
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
  TechnicalCutPlan,
  TreatmentGoalDetail,
  TreatmentPlan
} from "./contracts";

export interface AnalysisEngineInput {
  goal: AnalysisGoal;
  hairType: HairType;
  density: DensityLevel;
  porosity: PorosityLevel;
  faceShape?: FaceShape;
  headShape?: HeadShape;
  hairLength?: HairLength;
  hairTexture?: HairTexture;
  hairCondition?: HairCondition;
  growthPattern?: GrowthPattern;
  targetShape?: TargetShape;
  desiredColorResult?: DesiredColorResult;
  grayPercentage?: GrayPercentage;
  scalpCondition?: ScalpCondition;
  treatmentGoalDetail?: TreatmentGoalDetail;
}

export interface AnalysisCreateRecordInput extends AnalysisEngineInput {
  phase: "pending_questions" | "ready";
  confidenceScore: number;
  uncertaintyReasons: string[];
  followUpQuestions: string[];
  recommendations: string[];
  safetyNotes: string[];
  clarificationRound: number;
  technicalCutPlan?: TechnicalCutPlan;
  colorPlan?: ColorPlan;
  treatmentPlan?: TreatmentPlan;
}

export interface AnalysisClarifyRequest {
  answers: string[];
}

export interface AnalysisState extends AnalysisCreateRecordInput {
  id: string;
  clientId: string;
  createdByUserId: string;
  clarificationAnswers: string[];
  createdAt: string;
  updatedAt: string;
}
