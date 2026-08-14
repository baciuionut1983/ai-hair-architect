import { randomUUID } from "crypto";

import { Prisma, type Analysis as PrismaAnalysisRow, type AnalysisFieldSource } from "@prisma/client";

import type {
  AnalysisGoal,
  AnalysisPhase,
  ColorApplicationTechnique,
  ColorDeveloperVolume,
  ColorFormulaDirection,
  ColorPlan,
  ColorStep,
  ColorToneDirection,
  CuttingStep,
  CuttingTechnique,
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
  StructuralTechnique,
  TargetShape,
  TechnicalCutDistribution,
  TechnicalCutElevation,
  TechnicalCutGuideline,
  TechnicalCutPlan,
  TechnicalCutSectioning,
  TexturizingTechnique,
  TreatmentCategory,
  TreatmentFrequency,
  TreatmentGoalDetail,
  TreatmentPlan,
  TreatmentStep,
} from "@/lib/contracts";
import type { AnalysisCreateRecordInput, AnalysisEngineInput, AnalysisState } from "@/lib/milestone2-types";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { recomputePlans } from "@/lib/analysis-engine";

export const ANALYSIS_PERSISTENCE_ERROR_CODE = "ANALYSIS_PERSISTENCE_UNAVAILABLE";
const MAX_ANALYSIS_TRANSACTION_ATTEMPTS = 3;

const ANALYSIS_GOALS = ["refresh", "cover", "lighten", "correct", "reshape", "treat"] as const;
const ANALYSIS_PHASES = ["pending_questions", "ready"] as const;
const HAIR_TYPES = ["fine", "medium", "coarse"] as const;
const LEVELS = ["low", "medium", "high"] as const;
const FACE_SHAPES = ["oval", "round", "square", "heart", "diamond", "oblong"] as const;
const HEAD_SHAPES = ["balanced", "flat_occipital", "prominent_crown", "wide_parietal", "irregular_occipital"] as const;
const HAIR_LENGTHS = ["pixie", "short", "medium", "long", "extra_long"] as const;
const HAIR_TEXTURES = ["straight", "wavy", "curly", "coily"] as const;
const HAIR_CONDITIONS = ["virgin_healthy", "chemically_treated", "high_porosity_damaged", "fragile_breakage"] as const;
const GROWTH_PATTERNS = ["regular", "double_crown", "front_cowlick", "nape_whorl", "strong_widow_peak"] as const;
const TARGET_SHAPES = ["precision_bob", "graduated_bob", "long_layers", "shag_mullet", "pixie_crop", "face_framing_cascade", "blunt_perimeter_texturized"] as const;
const STRUCTURAL_TECHNIQUES = ["precision_layering", "graduation", "one_length", "internal_layering", "compact_graduation"] as const;
const CUTTING_TECHNIQUES = ["blunt_line", "scissor_over_comb", "slice_cutting", "elevation_cutting"] as const;
const TEXTURIZING_TECHNIQUES = ["point_cutting", "slice_and_slide", "razor_texturizing", "channel_cutting", "debulking"] as const;
const SECTIONING_OPTIONS = ["4_quadrant_profile_radial", "horseshoe_crown", "diagonal_back", "pivot_radial", "horseshoe_fringe"] as const;
const ELEVATION_OPTIONS = ["0_deg_blunt", "45_deg_graduation", "90_deg_uniform_layer", "135_deg_long_layer", "180_deg_overdirection"] as const;
const DISTRIBUTION_OPTIONS = ["natural_fall", "perpendicular", "overdirected_back", "overdirected_forward", "shifting_line"] as const;
const GUIDELINE_OPTIONS = ["stationary", "traveling", "visual_perimeter", "multiple_reference"] as const;
const COLOR_FORMULA_DIRECTIONS = ["single_process_gray_coverage", "gloss_demi_permanent", "root_shadow_melt", "balayage_freehand", "double_process_lightening", "color_correction_neutralize"] as const;
const COLOR_DEVELOPER_VOLUMES = ["10vol", "20vol", "30vol", "40vol"] as const;
const COLOR_TONE_DIRECTIONS = ["cool_ash", "warm_gold", "neutral", "cool_violet", "warm_copper"] as const;
const COLOR_APPLICATION_TECHNIQUES = ["global_application", "root_touch_up", "foils", "balayage_freehand", "color_melt"] as const;
const DESIRED_COLOR_RESULTS = ["gray_coverage", "gloss_refresh", "root_shadow", "balayage_highlights", "full_lightening", "color_correction"] as const;
const GRAY_PERCENTAGES = ["none", "low", "medium", "high"] as const;
const SCALP_CONDITIONS = ["normal", "oily", "dry", "sensitive", "flaking"] as const;
const TREATMENT_GOAL_DETAILS = ["hydration", "repair", "detox_scalp", "bonding_repair", "post_color_recovery"] as const;
const TREATMENT_CATEGORIES = ["deep_hydration", "bond_repair", "scalp_therapy", "post_color_recovery", "protein_reconstruction"] as const;
const TREATMENT_FREQUENCIES = ["weekly_for_4_weeks", "biweekly_for_6_weeks", "single_session_reassess", "monthly_maintenance"] as const;

export class AnalysisPersistenceError extends Error {
  readonly code = ANALYSIS_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Analysis data is temporarily unavailable.");
    this.name = "AnalysisPersistenceError";
  }
}

export class AnalysisDependencyError extends Error {
  constructor(
    readonly code: "ANALYSIS_CLIENT_NOT_FOUND" | "ANALYSIS_DEPENDENCY_CHANGED",
    readonly httpStatus: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AnalysisDependencyError";
  }
}

export class AnalysisConcurrencyError extends Error {
  readonly code = "ANALYSIS_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Analysis could not be updated because of concurrent changes.");
    this.name = "AnalysisConcurrencyError";
  }
}

export type AnalysisTransition = (
  current: AnalysisState,
) => Omit<AnalysisState, "id" | "clientId" | "createdByUserId" | "createdAt" | "updatedAt">;

type AnalysisTransaction = Pick<Prisma.TransactionClient, "analysis" | "client" | "analysisCorrection">;

// Conversational Professional AI milestone: the fields a correction (manual
// or conversational) is ever allowed to change. Deliberately excludes
// "goal" -- changing the fundamental service goal is a new analysis, not a
// correction to an existing one.
export const CORRECTABLE_ANALYSIS_FIELDS = [
  "hairType",
  "density",
  "porosity",
  "faceShape",
  "headShape",
  "hairLength",
  "hairTexture",
  "hairCondition",
  "growthPattern",
  "targetShape",
  "desiredColorResult",
  "grayPercentage",
  "scalpCondition",
  "treatmentGoalDetail",
] as const;
export type CorrectableAnalysisField = (typeof CORRECTABLE_ANALYSIS_FIELDS)[number];

const CORRECTABLE_FIELD_ENUMS: Record<CorrectableAnalysisField, readonly string[]> = {
  hairType: HAIR_TYPES,
  density: LEVELS,
  porosity: LEVELS,
  faceShape: FACE_SHAPES,
  headShape: HEAD_SHAPES,
  hairLength: HAIR_LENGTHS,
  hairTexture: HAIR_TEXTURES,
  hairCondition: HAIR_CONDITIONS,
  growthPattern: GROWTH_PATTERNS,
  targetShape: TARGET_SHAPES,
  desiredColorResult: DESIRED_COLOR_RESULTS,
  grayPercentage: GRAY_PERCENTAGES,
  scalpCondition: SCALP_CONDITIONS,
  treatmentGoalDetail: TREATMENT_GOAL_DETAILS,
};

// A human caller (a form edit or a conversational message the stylist
// confirmed) can only ever claim one of these two sources -- "visual_ai",
// "historical", and "assumed" are system-derived provenance values, never
// something an API caller is allowed to assert about their own input.
export type HumanCorrectionSource = "stylist_confirmed" | "client_reported";

export class AnalysisCorrectionValidationError extends Error {
  constructor(
    readonly code: "ANALYSIS_CORRECTION_INVALID_FIELD" | "ANALYSIS_CORRECTION_INVALID_VALUE",
    message: string,
  ) {
    super(message);
    this.name = "AnalysisCorrectionValidationError";
  }
}

export function isCorrectableAnalysisField(field: string): field is CorrectableAnalysisField {
  return (CORRECTABLE_ANALYSIS_FIELDS as readonly string[]).includes(field);
}

export interface ApplyAnalysisCorrectionInput {
  field: CorrectableAnalysisField;
  value: string;
  source: HumanCorrectionSource;
  reason?: string;
}

export interface AnalysisCorrectionRecord {
  id: string;
  analysisId: string;
  fieldName: string;
  previousValue: unknown;
  newValue: unknown;
  source: AnalysisFieldSource;
  reason: string | null;
  createdAt: string;
}

export async function createAnalysisForOwner(
  ownerUserId: string,
  clientId: string,
  input: AnalysisCreateRecordInput,
): Promise<AnalysisState> {
  return runAnalysisQuery(() => runSerializableTransaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: clientId, ownerUserId, deletedAt: null },
      select: { id: true },
    });
    if (!client) {
      throw new AnalysisDependencyError("ANALYSIS_CLIENT_NOT_FOUND", 404, "Client not found.");
    }

    const row = await tx.analysis.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId: client.id,
        goal: input.goal,
        hairType: input.hairType,
        density: input.density,
        porosity: input.porosity,
        phase: input.phase,
        clarificationRound: input.clarificationRound,
        confidenceScore: input.confidenceScore,
        uncertaintyReasons: input.uncertaintyReasons,
        followUpQuestions: input.followUpQuestions,
        recommendations: input.recommendations,
        safetyNotes: input.safetyNotes,
        faceShape: input.faceShape ?? null,
        headShape: input.headShape ?? null,
        hairLength: input.hairLength ?? null,
        hairTexture: input.hairTexture ?? null,
        hairCondition: input.hairCondition ?? null,
        growthPattern: input.growthPattern ?? null,
        targetShape: input.targetShape ?? null,
        desiredColorResult: input.desiredColorResult ?? null,
        grayPercentage: input.grayPercentage ?? null,
        scalpCondition: input.scalpCondition ?? null,
        treatmentGoalDetail: input.treatmentGoalDetail ?? null,
        technicalCutPlan: input.technicalCutPlan
          ? (input.technicalCutPlan as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        colorPlan: input.colorPlan
          ? (input.colorPlan as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        treatmentPlan: input.treatmentPlan
          ? (input.treatmentPlan as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        clarificationAnswers: [],
        imageAssetId: input.imageAssetId ?? null,
        imageAnalysisId: input.imageAnalysisId ?? null,
        m8DraftCreatedAt: input.imageAssetId ? new Date() : null,
      },
    });

    return toAnalysisState(row);
  }));
}

export async function findAnalysisForOwner(
  ownerUserId: string,
  analysisId: string,
): Promise<AnalysisState | null> {
  return runAnalysisQuery(async () => {
    const row = await prisma.analysis.findFirst({
      where: m2AnalysisWhere(ownerUserId, analysisId),
    });
    return row ? toAnalysisState(row) : null;
  });
}

// Conversational Professional AI: resolves the client's own most recent
// analysis when the caller (Consult AI opened from the client page, not a
// specific analysis page) has no particular analysisId in hand. Owner+client
// scoped exactly like every other lookup here -- never returns an analysis
// belonging to a different owner or a different client. Returns null (not
// an error) when the client genuinely has no analysis yet, which the caller
// must report honestly rather than inventing one.
export async function findLatestAnalysisForClient(
  ownerUserId: string,
  clientId: string,
): Promise<AnalysisState | null> {
  return runAnalysisQuery(async () => {
    const row = await prisma.analysis.findFirst({
      where: {
        clientId,
        ownerUserId,
        goal: { in: [...ANALYSIS_GOALS] },
        phase: { in: [...ANALYSIS_PHASES] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return row ? toAnalysisState(row) : null;
  });
}

export async function clarifyAnalysisForOwner(
  ownerUserId: string,
  analysisId: string,
  transition: AnalysisTransition,
): Promise<AnalysisState | null> {
  return runAnalysisQuery(() => runSerializableTransaction(async (tx) => {
    const row = await tx.analysis.findFirst({
      where: m2AnalysisWhere(ownerUserId, analysisId),
    });
    if (!row) return null;

    const current = toAnalysisState(row);
    const next = transition(current);
    assertTransitionResult(next);

    const updated = await tx.analysis.update({
      where: { id: row.id },
      data: {
        phase: next.phase,
        clarificationRound: next.clarificationRound,
        confidenceScore: next.confidenceScore,
        uncertaintyReasons: next.uncertaintyReasons,
        followUpQuestions: next.followUpQuestions,
        recommendations: next.recommendations,
        safetyNotes: next.safetyNotes,
        technicalCutPlan: next.technicalCutPlan
          ? (next.technicalCutPlan as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        colorPlan: next.colorPlan
          ? (next.colorPlan as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        treatmentPlan: next.treatmentPlan
          ? (next.treatmentPlan as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        clarificationAnswers: next.clarificationAnswers,
        // Conversational AI milestone: analyzeWithClarifications can now
        // derive hairCondition from the answers (see
        // deriveHairConditionFromClarifications in analysis-engine.ts) --
        // previously these profile fields were "write-once" (only ever set
        // at creation) because no transition ever legitimately changed them.
        // Persisting the full set here, not just hairCondition, closes that
        // whole class of "engine computed a new value but the repository
        // silently dropped it" gap rather than patching one field.
        goal: next.goal,
        hairType: next.hairType,
        density: next.density,
        porosity: next.porosity,
        faceShape: next.faceShape ?? null,
        headShape: next.headShape ?? null,
        hairLength: next.hairLength ?? null,
        hairTexture: next.hairTexture ?? null,
        hairCondition: next.hairCondition ?? null,
        growthPattern: next.growthPattern ?? null,
        targetShape: next.targetShape ?? null,
        desiredColorResult: next.desiredColorResult ?? null,
        grayPercentage: next.grayPercentage ?? null,
        scalpCondition: next.scalpCondition ?? null,
        treatmentGoalDetail: next.treatmentGoalDetail ?? null,
      },
    });

    return toAnalysisState(updated);
  }));
}

// Conversational Professional AI milestone: "AI trebuie să poată fi
// contrazis" -- a stylist (directly via a form, or via the conversational
// endpoint proposing a change the stylist then confirms) can override any
// single visually-observed or historical field. Every correction is
// recorded as an AnalysisCorrection row (provenance: what changed, from
// what, to what, why, and under what source) in the SAME transaction as the
// Analysis update, and the plan is recomputed through recomputePlans --
// the exact same deterministic engines analyzeInitial/analyzeWithClarifications
// use, never a second implementation. Never silent: the correction row is
// the permanent, queryable trace of "who said what changed and when."
export async function applyAnalysisCorrection(
  ownerUserId: string,
  analysisId: string,
  input: ApplyAnalysisCorrectionInput,
): Promise<AnalysisState | null> {
  const allowedValues = CORRECTABLE_FIELD_ENUMS[input.field];
  if (!allowedValues.includes(input.value)) {
    throw new AnalysisCorrectionValidationError(
      "ANALYSIS_CORRECTION_INVALID_VALUE",
      `"${input.value}" is not a valid value for ${input.field}.`,
    );
  }

  return runAnalysisQuery(() => runSerializableTransaction(async (tx) => {
    const row = await tx.analysis.findFirst({
      where: m2AnalysisWhere(ownerUserId, analysisId),
    });
    if (!row) return null;

    const current = toAnalysisState(row);
    const previousValue = (current as unknown as Record<CorrectableAnalysisField, unknown>)[input.field] ?? null;

    const updatedInput: AnalysisEngineInput = {
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
      [input.field]: input.value,
    };

    const { technicalCutPlan, colorPlan, treatmentPlan, recommendations, safetyNotes } = recomputePlans(updatedInput);

    await tx.analysisCorrection.create({
      data: {
        id: randomUUID(),
        analysisId: row.id,
        ownerUserId,
        clientId: row.clientId,
        fieldName: input.field,
        previousValue: (previousValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        newValue: input.value,
        source: input.source,
        reason: input.reason?.trim() || null,
      },
    });

    const updated = await tx.analysis.update({
      where: { id: row.id },
      data: {
        hairType: updatedInput.hairType,
        density: updatedInput.density,
        porosity: updatedInput.porosity,
        faceShape: updatedInput.faceShape ?? null,
        headShape: updatedInput.headShape ?? null,
        hairLength: updatedInput.hairLength ?? null,
        hairTexture: updatedInput.hairTexture ?? null,
        hairCondition: updatedInput.hairCondition ?? null,
        growthPattern: updatedInput.growthPattern ?? null,
        targetShape: updatedInput.targetShape ?? null,
        desiredColorResult: updatedInput.desiredColorResult ?? null,
        grayPercentage: updatedInput.grayPercentage ?? null,
        scalpCondition: updatedInput.scalpCondition ?? null,
        treatmentGoalDetail: updatedInput.treatmentGoalDetail ?? null,
        recommendations,
        safetyNotes,
        technicalCutPlan: technicalCutPlan ? (technicalCutPlan as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        colorPlan: colorPlan ? (colorPlan as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        treatmentPlan: treatmentPlan ? (treatmentPlan as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    return toAnalysisState(updated);
  }));
}

export async function listAnalysisCorrections(
  ownerUserId: string,
  analysisId: string,
): Promise<AnalysisCorrectionRecord[]> {
  return runAnalysisQuery(async () => {
    const rows = await prisma.analysisCorrection.findMany({
      where: { analysisId, ownerUserId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => ({
      id: row.id,
      analysisId: row.analysisId,
      fieldName: row.fieldName,
      previousValue: row.previousValue,
      newValue: row.newValue,
      source: row.source,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

export function isAnalysisPersistenceError(error: unknown): error is AnalysisPersistenceError {
  return error instanceof AnalysisPersistenceError;
}

export function analysisPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: ANALYSIS_PERSISTENCE_ERROR_CODE, message: "Analysis data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function m2AnalysisWhere(ownerUserId: string, analysisId: string): Prisma.AnalysisWhereInput {
  return {
    id: analysisId,
    ownerUserId,
    goal: { in: [...ANALYSIS_GOALS] },
    phase: { in: [...ANALYSIS_PHASES] },
  };
}

async function runAnalysisQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new AnalysisPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof AnalysisPersistenceError ||
      error instanceof AnalysisDependencyError ||
      error instanceof AnalysisConcurrencyError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new AnalysisDependencyError("ANALYSIS_DEPENDENCY_CHANGED", 409, "Analysis dependencies changed.");
    }
    throw new AnalysisPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: AnalysisTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ANALYSIS_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_ANALYSIS_TRANSACTION_ATTEMPTS) throw new AnalysisConcurrencyError();
    }
  }

  throw new AnalysisConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2034";
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function toAnalysisState(row: PrismaAnalysisRow): AnalysisState {
  if (
    !isOneOf(row.goal, ANALYSIS_GOALS) ||
    !isOneOf(row.hairType, HAIR_TYPES) ||
    !isOneOf(row.density, LEVELS) ||
    !isOneOf(row.porosity, LEVELS) ||
    !isOneOf(row.phase, ANALYSIS_PHASES) ||
    !Number.isInteger(row.clarificationRound) || row.clarificationRound < 0 ||
    !Number.isFinite(row.confidenceScore) || row.confidenceScore < 0 || row.confidenceScore > 1 ||
    !isValidDate(row.createdAt) || !isValidDate(row.updatedAt) || row.updatedAt < row.createdAt
  ) {
    throw new AnalysisPersistenceError();
  }

  const technicalCutPlan = parseTechnicalCutPlan(row.technicalCutPlan);
  const colorPlan = parseColorPlan(row.colorPlan);
  const treatmentPlan = parseTreatmentPlan(row.treatmentPlan);
  return {
    id: row.id,
    clientId: row.clientId,
    createdByUserId: row.ownerUserId,
    goal: row.goal as AnalysisGoal,
    hairType: row.hairType as HairType,
    density: row.density as DensityLevel,
    porosity: row.porosity as PorosityLevel,
    phase: row.phase as AnalysisPhase,
    clarificationRound: row.clarificationRound,
    confidenceScore: row.confidenceScore,
    uncertaintyReasons: parseStringArray(row.uncertaintyReasons),
    followUpQuestions: parseStringArray(row.followUpQuestions),
    recommendations: parseStringArray(row.recommendations),
    safetyNotes: parseStringArray(row.safetyNotes),
    clarificationAnswers: parseStringArray(row.clarificationAnswers),
    faceShape: parseNullableEnum(row.faceShape, FACE_SHAPES),
    headShape: parseNullableEnum(row.headShape, HEAD_SHAPES),
    hairLength: parseNullableEnum(row.hairLength, HAIR_LENGTHS),
    hairTexture: parseNullableEnum(row.hairTexture, HAIR_TEXTURES),
    hairCondition: parseNullableEnum(row.hairCondition, HAIR_CONDITIONS),
    growthPattern: parseNullableEnum(row.growthPattern, GROWTH_PATTERNS),
    targetShape: parseNullableEnum(row.targetShape, TARGET_SHAPES),
    desiredColorResult: parseNullableEnum(row.desiredColorResult, DESIRED_COLOR_RESULTS),
    grayPercentage: parseNullableEnum(row.grayPercentage, GRAY_PERCENTAGES),
    scalpCondition: parseNullableEnum(row.scalpCondition, SCALP_CONDITIONS),
    treatmentGoalDetail: parseNullableEnum(row.treatmentGoalDetail, TREATMENT_GOAL_DETAILS),
    ...(technicalCutPlan ? { technicalCutPlan } : {}),
    ...(colorPlan ? { colorPlan } : {}),
    ...(treatmentPlan ? { treatmentPlan } : {}),
    ...(row.imageAssetId ? { imageAssetId: row.imageAssetId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertTransitionResult(value: ReturnType<AnalysisTransition>): void {
  if (
    !isOneOf(value.goal, ANALYSIS_GOALS) ||
    !isOneOf(value.hairType, HAIR_TYPES) ||
    !isOneOf(value.density, LEVELS) ||
    !isOneOf(value.porosity, LEVELS) ||
    !isOneOf(value.phase, ANALYSIS_PHASES) ||
    !Number.isInteger(value.clarificationRound) || value.clarificationRound < 0 ||
    !Number.isFinite(value.confidenceScore) || value.confidenceScore < 0 || value.confidenceScore > 1 ||
    !isStringArray(value.uncertaintyReasons) ||
    !isStringArray(value.followUpQuestions) ||
    !isStringArray(value.recommendations) ||
    !isStringArray(value.safetyNotes) ||
    !isStringArray(value.clarificationAnswers) ||
    !isNullableEnum(value.faceShape, FACE_SHAPES) ||
    !isNullableEnum(value.headShape, HEAD_SHAPES) ||
    !isNullableEnum(value.hairLength, HAIR_LENGTHS) ||
    !isNullableEnum(value.hairTexture, HAIR_TEXTURES) ||
    !isNullableEnum(value.hairCondition, HAIR_CONDITIONS) ||
    !isNullableEnum(value.growthPattern, GROWTH_PATTERNS) ||
    !isNullableEnum(value.targetShape, TARGET_SHAPES) ||
    !isNullableEnum(value.desiredColorResult, DESIRED_COLOR_RESULTS) ||
    !isNullableEnum(value.grayPercentage, GRAY_PERCENTAGES) ||
    !isNullableEnum(value.scalpCondition, SCALP_CONDITIONS) ||
    !isNullableEnum(value.treatmentGoalDetail, TREATMENT_GOAL_DETAILS) ||
    (value.technicalCutPlan !== undefined && !isTechnicalCutPlan(value.technicalCutPlan)) ||
    (value.colorPlan !== undefined && !isColorPlan(value.colorPlan)) ||
    (value.treatmentPlan !== undefined && !isTreatmentPlan(value.treatmentPlan))
  ) {
    throw new AnalysisPersistenceError();
  }
}

function parseStringArray(value: Prisma.JsonValue): string[] {
  if (!isStringArray(value)) throw new AnalysisPersistenceError();
  return [...value];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseNullableEnum<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isOneOf(value, allowed)) throw new AnalysisPersistenceError();
  return value;
}

function isNullableEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T | undefined {
  return value === undefined || isOneOf(value, allowed);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function parseTechnicalCutPlan(value: Prisma.JsonValue | null): TechnicalCutPlan | undefined {
  if (value === null) return undefined;
  if (!isTechnicalCutPlan(value)) throw new AnalysisPersistenceError();
  return value;
}

function isTechnicalCutPlan(value: unknown): value is TechnicalCutPlan {
  if (!isRecord(value)) return false;
  return isOneOf(value.structuralTechnique, STRUCTURAL_TECHNIQUES) &&
    isOneOf(value.cuttingTechnique, CUTTING_TECHNIQUES) &&
    (value.texturizingTechnique === undefined || isOneOf(value.texturizingTechnique, TEXTURIZING_TECHNIQUES)) &&
    isOneOf(value.sectioning, SECTIONING_OPTIONS) &&
    isOneOf(value.elevation, ELEVATION_OPTIONS) &&
    isOneOf(value.distribution, DISTRIBUTION_OPTIONS) &&
    isOneOf(value.guideline, GUIDELINE_OPTIONS) &&
    Array.isArray(value.cuttingSteps) && value.cuttingSteps.every(isCuttingStep) &&
    isNonEmptyString(value.stylistExplanation) &&
    isNonEmptyString(value.clientExplanation) &&
    isNonEmptyString(value.professionalReason) &&
    isStringArray(value.warnings) &&
    isStringArray(value.contraindications) &&
    isStringArray(value.assumptions) &&
    isStringArray(value.missingData) &&
    typeof value.confidence === "number" && Number.isFinite(value.confidence) &&
    value.confidence >= 0 && value.confidence <= 1 &&
    (value.notes === undefined || isStringArray(value.notes)) &&
    isNonEmptyString(value.stylistValidationDisclaimer) &&
    isNonEmptyString(value.version);
}

function isCuttingStep(value: unknown): value is CuttingStep {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.stepNumber) && (value.stepNumber as number) > 0 &&
    isNonEmptyString(value.zone) &&
    isNonEmptyString(value.action) &&
    isOneOf(value.elevationAngle, ELEVATION_OPTIONS) &&
    isNonEmptyString(value.toolRequired);
}

function parseColorPlan(value: Prisma.JsonValue | null): ColorPlan | undefined {
  if (value === null) return undefined;
  if (!isColorPlan(value)) throw new AnalysisPersistenceError();
  return value;
}

function isColorPlan(value: unknown): value is ColorPlan {
  if (!isRecord(value)) return false;
  return isOneOf(value.formulaDirection, COLOR_FORMULA_DIRECTIONS) &&
    isOneOf(value.developerVolume, COLOR_DEVELOPER_VOLUMES) &&
    Number.isFinite(value.liftLevels) && (value.liftLevels as number) >= 0 &&
    isOneOf(value.toneDirection, COLOR_TONE_DIRECTIONS) &&
    isOneOf(value.applicationTechnique, COLOR_APPLICATION_TECHNIQUES) &&
    Array.isArray(value.processingSteps) && value.processingSteps.every(isColorStep) &&
    isStringArray(value.maintenancePlan) &&
    typeof value.strandTestRequired === "boolean" &&
    isNonEmptyString(value.stylistExplanation) &&
    isNonEmptyString(value.clientExplanation) &&
    isNonEmptyString(value.professionalReason) &&
    isStringArray(value.warnings) &&
    isStringArray(value.contraindications) &&
    isStringArray(value.assumptions) &&
    isStringArray(value.missingData) &&
    typeof value.confidence === "number" && Number.isFinite(value.confidence) &&
    value.confidence >= 0 && value.confidence <= 1 &&
    (value.notes === undefined || isStringArray(value.notes)) &&
    isNonEmptyString(value.stylistValidationDisclaimer) &&
    isNonEmptyString(value.version);
}

function isColorStep(value: unknown): value is ColorStep {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.stepNumber) && (value.stepNumber as number) > 0 &&
    isNonEmptyString(value.zone) &&
    isNonEmptyString(value.action) &&
    (value.processingTimeMinutes === undefined ||
      (typeof value.processingTimeMinutes === "number" && Number.isFinite(value.processingTimeMinutes))) &&
    isNonEmptyString(value.toolRequired);
}

function parseTreatmentPlan(value: Prisma.JsonValue | null): TreatmentPlan | undefined {
  if (value === null) return undefined;
  if (!isTreatmentPlan(value)) throw new AnalysisPersistenceError();
  return value;
}

function isTreatmentPlan(value: unknown): value is TreatmentPlan {
  if (!isRecord(value)) return false;
  return isOneOf(value.treatmentCategory, TREATMENT_CATEGORIES) &&
    Array.isArray(value.protocolSteps) && value.protocolSteps.every(isTreatmentStep) &&
    isStringArray(value.aftercareSteps) &&
    isOneOf(value.recommendedFrequency, TREATMENT_FREQUENCIES) &&
    Number.isFinite(value.followUpReviewWeeks) && (value.followUpReviewWeeks as number) > 0 &&
    isNonEmptyString(value.stylistExplanation) &&
    isNonEmptyString(value.clientExplanation) &&
    isNonEmptyString(value.professionalReason) &&
    isStringArray(value.warnings) &&
    isStringArray(value.contraindications) &&
    isStringArray(value.assumptions) &&
    isStringArray(value.missingData) &&
    typeof value.confidence === "number" && Number.isFinite(value.confidence) &&
    value.confidence >= 0 && value.confidence <= 1 &&
    (value.notes === undefined || isStringArray(value.notes)) &&
    isNonEmptyString(value.stylistValidationDisclaimer) &&
    isNonEmptyString(value.version);
}

function isTreatmentStep(value: unknown): value is TreatmentStep {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.stepNumber) && (value.stepNumber as number) > 0 &&
    isNonEmptyString(value.zone) &&
    isNonEmptyString(value.action) &&
    isNonEmptyString(value.toolRequired);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

type _ContractAssertions = [
  AnalysisGoal,
  AnalysisPhase,
  HairType,
  DensityLevel,
  PorosityLevel,
  FaceShape,
  HeadShape,
  HairLength,
  HairTexture,
  HairCondition,
  GrowthPattern,
  TargetShape,
  StructuralTechnique,
  CuttingTechnique,
  TexturizingTechnique,
  TechnicalCutSectioning,
  TechnicalCutElevation,
  TechnicalCutDistribution,
  TechnicalCutGuideline,
  ColorFormulaDirection,
  ColorDeveloperVolume,
  ColorToneDirection,
  ColorApplicationTechnique,
  DesiredColorResult,
  GrayPercentage,
  ScalpCondition,
  TreatmentGoalDetail,
  TreatmentCategory,
  TreatmentFrequency,
];