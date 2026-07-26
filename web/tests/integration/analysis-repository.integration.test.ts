import { randomUUID } from "crypto";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import {
  AnalysisPersistenceError,
  clarifyAnalysisForOwner,
  createAnalysisForOwner,
  findAnalysisForOwner,
} from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("Analysis durable repository", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.consultation.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAnalysisReview.deleteMany({
      where: { analysis: { asset: { ownerUserId: { in: ownerUserIds } } } },
    });
    await prisma.imageAnalysis.deleteMany({
      where: { asset: { ownerUserId: { in: ownerUserIds } } },
    });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("creates a durable Analysis and preserves owner isolation across a fresh Prisma client", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const created = await createAnalysisForOwner(ownerUserId, clientId, readyInput());

    const freshClient = new PrismaClient();
    try {
      await expect(freshClient.analysis.findUnique({ where: { id: created.id } })).resolves.toMatchObject({
        ownerUserId,
        clientId,
        goal: "refresh",
        phase: "ready",
      });
    } finally {
      await freshClient.$disconnect();
    }

    await expect(findAnalysisForOwner(ownerUserId, created.id)).resolves.toMatchObject({ id: created.id });
    await expect(findAnalysisForOwner(randomUUID(), created.id)).resolves.toBeNull();
  });

  it("persists and reads a technicalCutPlan round-trip through PostgreSQL", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const plan = technicalCutPlan();

    const created = await createAnalysisForOwner(ownerUserId, clientId, {
      ...readyInput(),
      technicalCutPlan: plan,
    });

    const freshClient = new PrismaClient();
    try {
      await expect(freshClient.analysis.findUnique({ where: { id: created.id } }))
        .resolves.toMatchObject({ technicalCutPlan: plan });
    } finally {
      await freshClient.$disconnect();
    }

    await expect(findAnalysisForOwner(ownerUserId, created.id)).resolves.toMatchObject({
      technicalCutPlan: plan,
    });
  });

  it("rejects missing, cross-owner and soft-deleted Clients", async () => {
    const first = await createOwnerAndClient();
    const second = await createOwnerAndClient();

    await expect(createAnalysisForOwner(first.ownerUserId, randomUUID(), readyInput())).rejects.toMatchObject({
      code: "ANALYSIS_CLIENT_NOT_FOUND",
      httpStatus: 404,
    });
    await expect(createAnalysisForOwner(first.ownerUserId, second.clientId, readyInput())).rejects.toMatchObject({
      code: "ANALYSIS_CLIENT_NOT_FOUND",
      httpStatus: 404,
    });

    await prisma.client.update({ where: { id: first.clientId }, data: { deletedAt: new Date() } });
    await expect(createAnalysisForOwner(first.ownerUserId, first.clientId, readyInput())).rejects.toMatchObject({
      code: "ANALYSIS_CLIENT_NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("keeps M8 Analysis rows invisible and unchanged", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const asset = await prisma.imageAsset.create({
      data: {
        ownerUserId,
        clientId,
        fileName: "m8.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1,
        storagePath: "dc-m3-m8-test",
      },
    });
    const imageAnalysis = await prisma.imageAnalysis.create({
      data: { assetId: asset.id, status: "confirmed" },
    });
    const m8 = await prisma.analysis.create({
      data: {
        id: `m8-${randomUUID()}`,
        ownerUserId,
        clientId,
        goal: "hair_analysis",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        phase: "analysis",
        clarificationRound: 0,
        confidenceScore: 0.9,
        uncertaintyReasons: [],
        followUpQuestions: [],
        recommendations: [],
        safetyNotes: [],
        clarificationAnswers: [],
        imageAssetId: asset.id,
        imageAnalysisId: imageAnalysis.id,
        m8DraftCreatedAt: new Date(),
      },
    });
    const transition = vi.fn((current) => current);

    await expect(findAnalysisForOwner(ownerUserId, m8.id)).resolves.toBeNull();
    await expect(clarifyAnalysisForOwner(ownerUserId, m8.id, transition)).resolves.toBeNull();
    expect(transition).not.toHaveBeenCalled();
    await expect(prisma.analysis.findUnique({ where: { id: m8.id } })).resolves.toMatchObject({
      goal: "hair_analysis",
      phase: "analysis",
      clarificationRound: 0,
    });
  });

  it("fails closed when persisted Analysis JSON is malformed", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const created = await createAnalysisForOwner(ownerUserId, clientId, readyInput());
    await prisma.analysis.update({
      where: { id: created.id },
      data: { recommendations: { invalid: true } },
    });

    await expect(findAnalysisForOwner(ownerUserId, created.id)).rejects.toBeInstanceOf(
      AnalysisPersistenceError,
    );
  });

  it("serializes concurrent clarifications without losing accepted answers", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const created = await createAnalysisForOwner(ownerUserId, clientId, pendingInput());

    const clarify = (answer: string) => clarifyAnalysisForOwner(ownerUserId, created.id, (current) => ({
      ...current,
      phase: current.clarificationRound + 1 >= 2 ? "ready" : "pending_questions",
      clarificationRound: current.clarificationRound + 1,
      confidenceScore: Math.min(0.95, current.confidenceScore + 0.1),
      clarificationAnswers: [...current.clarificationAnswers, answer],
    }));

    await Promise.all([clarify("first answer"), clarify("second answer")]);

    const final = await findAnalysisForOwner(ownerUserId, created.id);
    expect(final).toMatchObject({ clarificationRound: 2, phase: "ready" });
    expect(final?.clarificationAnswers).toHaveLength(2);
    expect(new Set(final?.clarificationAnswers)).toEqual(new Set(["first answer", "second answer"]));
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@analysis-repository.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({
    data: { id: clientId, ownerUserId, fullName: "Analysis Repository Client" },
  });
  return { ownerUserId, clientId };
}

function readyInput() {
  return {
    goal: "refresh" as const,
    hairType: "medium" as const,
    density: "medium" as const,
    porosity: "low" as const,
    phase: "ready" as const,
    clarificationRound: 0,
    confidenceScore: 0.87,
    uncertaintyReasons: [],
    followUpQuestions: [],
    recommendations: ["Document the service."],
    safetyNotes: ["Perform a strand test."],
  };
}

function pendingInput() {
  return {
    ...readyInput(),
    goal: "lighten" as const,
    hairType: "fine" as const,
    porosity: "high" as const,
    phase: "pending_questions" as const,
    confidenceScore: 0.62,
    uncertaintyReasons: ["More history is required."],
    followUpQuestions: ["Was the hair recently bleached?"],
  };
}

function technicalCutPlan(): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation",
    cuttingTechnique: "slice_cutting",
    texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back",
    elevation: "45_deg_graduation",
    distribution: "overdirected_back",
    guideline: "stationary",
    cuttingSteps: [{
      stepNumber: 1,
      zone: "nape",
      action: "Establish guideline",
      elevationAngle: "45_deg_graduation",
      toolRequired: "shears",
    }],
    stylistExplanation: "Explain the sectioning.",
    clientExplanation: "Explain the shape.",
    professionalReason: "Control weight.",
    warnings: [],
    contraindications: [],
    assumptions: [],
    missingData: [],
    confidence: 0.9,
    stylistValidationDisclaimer: "Validate before cutting.",
    version: "1.0.0-m8",
  };
}