import { Prisma } from "@prisma/client";

import type { TechnicalCutPlan } from "./contracts";
import { isDatabaseConfigured, prisma } from "./prisma";

export interface PersistedAnalysisSnapshot {
  id: string;
  clientId: string;
  ownerUserId: string;
  goal: string;
  hairType: string;
  density: string;
  porosity: string;
  phase: string;
  clarificationRound: number;
  confidenceScore: number;
  uncertaintyReasons: string[];
  followUpQuestions: string[];
  recommendations: string[];
  safetyNotes: string[];
  faceShape?: string | null;
  headShape?: string | null;
  hairLength?: string | null;
  hairTexture?: string | null;
  hairCondition?: string | null;
  growthPattern?: string | null;
  targetShape?: string | null;
  technicalCutPlan?: TechnicalCutPlan | null;
  clarificationAnswers: string[];
  createdAt: string;
  updatedAt: string;
}

export async function upsertPersistedAnalysis(snapshot: PersistedAnalysisSnapshot): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await prisma.analysis.upsert({
      where: { id: snapshot.id },
      create: toCreateData(snapshot),
      update: toUpdateData(snapshot)
    });
  } catch {
    // Non-fatal hybrid fallback.
  }
}

export async function findPersistedAnalysisById(
  analysisId: string,
  ownerUserId?: string
): Promise<PersistedAnalysisSnapshot | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const analysis = await prisma.analysis.findFirst({
      where: {
        id: analysisId,
        ...(ownerUserId ? { ownerUserId } : {})
      }
    });

    return analysis ? fromRow(analysis) : null;
  } catch {
    return null;
  }
}

function toCreateData(snapshot: PersistedAnalysisSnapshot): Prisma.AnalysisUncheckedCreateInput {
  return {
    id: snapshot.id,
    clientId: snapshot.clientId,
    ownerUserId: snapshot.ownerUserId,
    goal: snapshot.goal,
    hairType: snapshot.hairType,
    density: snapshot.density,
    porosity: snapshot.porosity,
    phase: snapshot.phase,
    clarificationRound: snapshot.clarificationRound,
    confidenceScore: snapshot.confidenceScore,
    uncertaintyReasons: snapshot.uncertaintyReasons,
    followUpQuestions: snapshot.followUpQuestions,
    recommendations: snapshot.recommendations,
    safetyNotes: snapshot.safetyNotes,
    faceShape: snapshot.faceShape ?? null,
    headShape: snapshot.headShape ?? null,
    hairLength: snapshot.hairLength ?? null,
    hairTexture: snapshot.hairTexture ?? null,
    hairCondition: snapshot.hairCondition ?? null,
    growthPattern: snapshot.growthPattern ?? null,
    targetShape: snapshot.targetShape ?? null,
    technicalCutPlan: snapshot.technicalCutPlan
      ? (snapshot.technicalCutPlan as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    clarificationAnswers: snapshot.clarificationAnswers,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt)
  };
}

function toUpdateData(snapshot: PersistedAnalysisSnapshot): Prisma.AnalysisUncheckedUpdateInput {
  return {
    clientId: snapshot.clientId,
    ownerUserId: snapshot.ownerUserId,
    goal: snapshot.goal,
    hairType: snapshot.hairType,
    density: snapshot.density,
    porosity: snapshot.porosity,
    phase: snapshot.phase,
    clarificationRound: snapshot.clarificationRound,
    confidenceScore: snapshot.confidenceScore,
    uncertaintyReasons: snapshot.uncertaintyReasons,
    followUpQuestions: snapshot.followUpQuestions,
    recommendations: snapshot.recommendations,
    safetyNotes: snapshot.safetyNotes,
    faceShape: snapshot.faceShape ?? null,
    headShape: snapshot.headShape ?? null,
    hairLength: snapshot.hairLength ?? null,
    hairTexture: snapshot.hairTexture ?? null,
    hairCondition: snapshot.hairCondition ?? null,
    growthPattern: snapshot.growthPattern ?? null,
    targetShape: snapshot.targetShape ?? null,
    technicalCutPlan: snapshot.technicalCutPlan
      ? (snapshot.technicalCutPlan as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    clarificationAnswers: snapshot.clarificationAnswers,
    updatedAt: new Date(snapshot.updatedAt)
  };
}

function fromRow(row: {
  id: string;
  clientId: string;
  ownerUserId: string;
  goal: string;
  hairType: string;
  density: string;
  porosity: string;
  phase: string;
  clarificationRound: number;
  confidenceScore: number;
  uncertaintyReasons: Prisma.JsonValue;
  followUpQuestions: Prisma.JsonValue;
  recommendations: Prisma.JsonValue;
  safetyNotes: Prisma.JsonValue;
  faceShape: string | null;
  headShape: string | null;
  hairLength: string | null;
  hairTexture: string | null;
  hairCondition: string | null;
  growthPattern: string | null;
  targetShape: string | null;
  technicalCutPlan: Prisma.JsonValue | null;
  clarificationAnswers: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): PersistedAnalysisSnapshot {
  return {
    id: row.id,
    clientId: row.clientId,
    ownerUserId: row.ownerUserId,
    goal: row.goal,
    hairType: row.hairType,
    density: row.density,
    porosity: row.porosity,
    phase: row.phase,
    clarificationRound: row.clarificationRound,
    confidenceScore: row.confidenceScore,
    uncertaintyReasons: asStringArray(row.uncertaintyReasons),
    followUpQuestions: asStringArray(row.followUpQuestions),
    recommendations: asStringArray(row.recommendations),
    safetyNotes: asStringArray(row.safetyNotes),
    faceShape: row.faceShape,
    headShape: row.headShape,
    hairLength: row.hairLength,
    hairTexture: row.hairTexture,
    hairCondition: row.hairCondition,
    growthPattern: row.growthPattern,
    targetShape: row.targetShape,
    technicalCutPlan: row.technicalCutPlan as TechnicalCutPlan | null,
    clarificationAnswers: asStringArray(row.clarificationAnswers),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function asStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
