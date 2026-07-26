import { randomUUID } from "crypto";

import { Prisma, type Analysis as PrismaAnalysisRow } from "@prisma/client";

import type {
  AnalysisGoal,
  AnalysisPhase,
  CuttingStep,
  CuttingTechnique,
  DensityLevel,
  FaceShape,
  GrowthPattern,
  HairCondition,
  HairLength,
  HairTexture,
  HairType,
  HeadShape,
  PorosityLevel,
  StructuralTechnique,
  TargetShape,
  TechnicalCutDistribution,
  TechnicalCutElevation,
  TechnicalCutGuideline,
  TechnicalCutPlan,
  TechnicalCutSectioning,
  TexturizingTechnique,
} from "@/lib/contracts";
import type { AnalysisCreateRecordInput, AnalysisState } from "@/lib/milestone2-types";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

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

type AnalysisTransaction = Pick<Prisma.TransactionClient, "analysis" | "client">;

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
        technicalCutPlan: input.technicalCutPlan
          ? (input.technicalCutPlan as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        clarificationAnswers: [],
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
        clarificationAnswers: next.clarificationAnswers,
      },
    });

    return toAnalysisState(updated);
  }));
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
    ...(technicalCutPlan ? { technicalCutPlan } : {}),
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
    (value.technicalCutPlan !== undefined && !isTechnicalCutPlan(value.technicalCutPlan))
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
];