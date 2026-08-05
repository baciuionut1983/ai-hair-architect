import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ColorPlan, TreatmentPlan } from "@/lib/contracts";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  transaction: vi.fn(),
  clientFindFirst: vi.fn(),
  analysisCreate: vi.fn(),
  analysisFindFirst: vi.fn(),
  analysisUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    $transaction: prismaMocks.transaction,
    analysis: {
      findFirst: prismaMocks.analysisFindFirst,
    },
  },
}));

import {
  AnalysisConcurrencyError,
  AnalysisDependencyError,
  AnalysisPersistenceError,
  analysisPersistenceUnavailableResponse,
  clarifyAnalysisForOwner,
  createAnalysisForOwner,
  findAnalysisForOwner,
} from "./analysis-repository";

const tx = {
  client: { findFirst: prismaMocks.clientFindFirst },
  analysis: {
    create: prismaMocks.analysisCreate,
    findFirst: prismaMocks.analysisFindFirst,
    update: prismaMocks.analysisUpdate,
  },
};

beforeEach(() => {
  prismaMocks.configured = true;
  prismaMocks.transaction.mockReset();
  prismaMocks.clientFindFirst.mockReset();
  prismaMocks.analysisCreate.mockReset();
  prismaMocks.analysisFindFirst.mockReset();
  prismaMocks.analysisUpdate.mockReset();
  prismaMocks.transaction.mockImplementation(async (operation) => operation(tx));
});

describe("analysis-repository", () => {
  it("creates an owner-scoped M2 Analysis after checking the active Client in the transaction", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisCreate.mockResolvedValue(analysisRow());

    const created = await createAnalysisForOwner("owner-1", "client-1", createInput());

    expect(created).toMatchObject({
      id: "analysis-1",
      clientId: "client-1",
      createdByUserId: "owner-1",
      phase: "ready",
    });
    expect(prismaMocks.clientFindFirst).toHaveBeenCalledWith({
      where: { id: "client-1", ownerUserId: "owner-1", deletedAt: null },
      select: { id: true },
    });
    expect(prismaMocks.analysisCreate).toHaveBeenCalledTimes(1);
    expect(prismaMocks.analysisCreate.mock.calls[0][0].data).toMatchObject({
      ownerUserId: "owner-1",
      clientId: "client-1",
      clarificationAnswers: [],
    });
    expect(prismaMocks.transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("persists null imageAssetId/imageAnalysisId/m8DraftCreatedAt for the manual flow (no photo provenance)", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisCreate.mockResolvedValue(analysisRow());

    await createAnalysisForOwner("owner-1", "client-1", createInput());

    expect(prismaMocks.analysisCreate.mock.calls[0][0].data).toMatchObject({
      imageAssetId: null,
      imageAnalysisId: null,
      m8DraftCreatedAt: null,
    });
  });

  it("persists imageAssetId/imageAnalysisId and stamps m8DraftCreatedAt for a photo-derived Analysis (M31 GO-4)", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisCreate.mockResolvedValue(analysisRow());

    await createAnalysisForOwner("owner-1", "client-1", {
      ...createInput(),
      imageAssetId: "asset-1",
      imageAnalysisId: "image-analysis-1",
    });

    const data = prismaMocks.analysisCreate.mock.calls[0][0].data;
    expect(data.imageAssetId).toBe("asset-1");
    expect(data.imageAnalysisId).toBe("image-analysis-1");
    expect(data.m8DraftCreatedAt).toBeInstanceOf(Date);
  });

  it("rejects missing or soft-deleted Clients without creating an Analysis", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue(null);

    await expect(createAnalysisForOwner("owner-1", "client-1", createInput())).rejects.toMatchObject({
      code: "ANALYSIS_CLIENT_NOT_FOUND",
      httpStatus: 404,
    });
    expect(prismaMocks.analysisCreate).not.toHaveBeenCalled();
  });

  it("finds only owner-scoped M2 rows and excludes M8 goal and phase values", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow());

    await expect(findAnalysisForOwner("owner-1", "analysis-1")).resolves.toMatchObject({
      id: "analysis-1",
      createdByUserId: "owner-1",
    });
    expect(prismaMocks.analysisFindFirst).toHaveBeenCalledWith({
      where: {
        id: "analysis-1",
        ownerUserId: "owner-1",
        goal: { in: ["refresh", "cover", "lighten", "correct", "reshape", "treat"] },
        phase: { in: ["pending_questions", "ready"] },
      },
    });
  });

  it("fails closed instead of filtering malformed persisted JSON", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue({
      ...analysisRow(),
      recommendations: ["valid", 42],
    });

    await expect(findAnalysisForOwner("owner-1", "analysis-1")).rejects.toBeInstanceOf(
      AnalysisPersistenceError,
    );
  });

  it("preserves a structurally valid technical plan and rejects a malformed plan", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ technicalCutPlan: technicalCutPlan() }));
    await expect(findAnalysisForOwner("owner-1", "analysis-1")).resolves.toMatchObject({
      technicalCutPlan: { version: "1.0.0-m8", structuralTechnique: "graduation" },
    });

    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({
      technicalCutPlan: { ...technicalCutPlan(), cuttingSteps: [{ stepNumber: 0 }] },
    }));
    await expect(findAnalysisForOwner("owner-1", "analysis-1")).rejects.toBeInstanceOf(
      AnalysisPersistenceError,
    );
  });

  it("preserves a structurally valid color plan and rejects a malformed plan", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ colorPlan: colorPlan() }));
    await expect(findAnalysisForOwner("owner-1", "analysis-1")).resolves.toMatchObject({
      colorPlan: { version: "1.0.0-m27", formulaDirection: "single_process_gray_coverage" },
    });

    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({
      colorPlan: { ...colorPlan(), developerVolume: "not-a-real-volume" },
    }));
    await expect(findAnalysisForOwner("owner-1", "analysis-1")).rejects.toBeInstanceOf(
      AnalysisPersistenceError,
    );
  });

  it("persists a colorPlan on create exactly like technicalCutPlan, and JsonNull when absent", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisCreate.mockResolvedValue(analysisRow());

    await createAnalysisForOwner("owner-1", "client-1", { ...createInput(), colorPlan: colorPlan() });
    expect(prismaMocks.analysisCreate.mock.calls[0][0].data.colorPlan).toEqual(colorPlan());

    await createAnalysisForOwner("owner-1", "client-1", createInput());
    expect(prismaMocks.analysisCreate.mock.calls[1][0].data.colorPlan).toBe(Prisma.JsonNull);
  });

  it("preserves a structurally valid treatment plan and rejects a malformed plan", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ treatmentPlan: treatmentPlan() }));
    await expect(findAnalysisForOwner("owner-1", "analysis-1")).resolves.toMatchObject({
      treatmentPlan: { version: "1.0.0-m27", treatmentCategory: "deep_hydration" },
    });

    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({
      treatmentPlan: { ...treatmentPlan(), recommendedFrequency: "not-a-real-frequency" },
    }));
    await expect(findAnalysisForOwner("owner-1", "analysis-1")).rejects.toBeInstanceOf(
      AnalysisPersistenceError,
    );
  });

  it("persists a treatmentPlan on create exactly like colorPlan, and JsonNull when absent", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisCreate.mockResolvedValue(analysisRow());

    await createAnalysisForOwner("owner-1", "client-1", { ...createInput(), treatmentPlan: treatmentPlan() });
    expect(prismaMocks.analysisCreate.mock.calls[0][0].data.treatmentPlan).toEqual(treatmentPlan());

    await createAnalysisForOwner("owner-1", "client-1", createInput());
    expect(prismaMocks.analysisCreate.mock.calls[1][0].data.treatmentPlan).toBe(Prisma.JsonNull);
  });

  it("carries colorPlan and treatmentPlan forward unchanged through a clarify update, unlike write-once profile fields", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({
      colorPlan: colorPlan(),
      treatmentPlan: treatmentPlan(),
      phase: "pending_questions",
    }));
    prismaMocks.analysisUpdate.mockImplementation(async ({ data }) => analysisRow({
      colorPlan: data.colorPlan === Prisma.JsonNull ? null : data.colorPlan,
      treatmentPlan: data.treatmentPlan === Prisma.JsonNull ? null : data.treatmentPlan,
      phase: data.phase,
    }));

    const transition = vi.fn((current) => ({ ...current, phase: "ready" as const }));
    const result = await clarifyAnalysisForOwner("owner-1", "analysis-1", transition);

    expect(prismaMocks.analysisUpdate.mock.calls[0][0].data.colorPlan).toEqual(colorPlan());
    expect(prismaMocks.analysisUpdate.mock.calls[0][0].data.treatmentPlan).toEqual(treatmentPlan());
    expect(result?.colorPlan).toEqual(colorPlan());
    expect(result?.treatmentPlan).toEqual(treatmentPlan());
  });

  it("retries serialization conflicts and recomputes the transition from transactional state", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", {
      code: "P2034",
      clientVersion: "test",
    });
    let attempts = 0;
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ phase: "pending_questions" }));
    prismaMocks.analysisUpdate.mockImplementation(async ({ data }) => analysisRow({
      phase: data.phase,
      clarificationRound: data.clarificationRound,
      confidenceScore: data.confidenceScore,
      clarificationAnswers: data.clarificationAnswers,
      updatedAt: new Date("2026-07-17T10:01:00.000Z"),
    }));
    prismaMocks.transaction.mockImplementation(async (operation) => {
      attempts += 1;
      const result = await operation(tx);
      if (attempts < 3) throw conflict;
      return result;
    });
    const transition = vi.fn((current) => ({
      ...current,
      phase: "ready" as const,
      clarificationRound: current.clarificationRound + 1,
      confidenceScore: 0.9,
      clarificationAnswers: [...current.clarificationAnswers, "safe"],
    }));

    await expect(clarifyAnalysisForOwner("owner-1", "analysis-1", transition)).resolves.toMatchObject({
      phase: "ready",
      clarificationRound: 1,
    });
    expect(prismaMocks.transaction).toHaveBeenCalledTimes(3);
    expect(transition).toHaveBeenCalledTimes(3);
  });

  it("returns a controlled conflict after exhausting serialization retries", async () => {
    prismaMocks.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("deadlock", {
      code: "P2034",
      clientVersion: "test",
    }));

    await expect(clarifyAnalysisForOwner("owner-1", "analysis-1", (current) => current))
      .rejects.toBeInstanceOf(AnalysisConcurrencyError);
    expect(prismaMocks.transaction).toHaveBeenCalledTimes(3);
  });

  it("maps dependency races and unexpected database failures to controlled errors", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("fk", {
      code: "P2003",
      clientVersion: "test",
    }));
    await expect(createAnalysisForOwner("owner-1", "client-1", createInput())).rejects.toMatchObject({
      code: "ANALYSIS_DEPENDENCY_CHANGED",
      httpStatus: 409,
    });

    prismaMocks.analysisFindFirst.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(findAnalysisForOwner("owner-1", "analysis-1")).rejects.toBeInstanceOf(
      AnalysisPersistenceError,
    );
  });

  it("fails closed without database configuration and exposes the standardized no-store response", async () => {
    prismaMocks.configured = false;
    await expect(findAnalysisForOwner("owner-1", "analysis-1")).rejects.toBeInstanceOf(
      AnalysisPersistenceError,
    );

    const response = analysisPersistenceUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "ANALYSIS_PERSISTENCE_UNAVAILABLE",
      message: "Analysis data is temporarily unavailable.",
    });
  });
});

function createInput() {
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

function analysisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "analysis-1",
    clientId: "client-1",
    ownerUserId: "owner-1",
    goal: "refresh",
    hairType: "medium",
    density: "medium",
    porosity: "low",
    phase: "ready",
    clarificationRound: 0,
    confidenceScore: 0.87,
    uncertaintyReasons: [],
    followUpQuestions: [],
    recommendations: ["Document the service."],
    safetyNotes: ["Perform a strand test."],
    faceShape: null,
    headShape: null,
    hairLength: null,
    hairTexture: null,
    hairCondition: null,
    growthPattern: null,
    targetShape: null,
    technicalCutPlan: null,
    colorPlan: null,
    desiredColorResult: null,
    grayPercentage: null,
    treatmentPlan: null,
    scalpCondition: null,
    treatmentGoalDetail: null,
    clarificationAnswers: [],
    imageAssetId: null,
    imageAnalysisId: null,
    m8DraftCreatedAt: null,
    m8FinalizedAt: null,
    createdAt: new Date("2026-07-17T10:00:00.000Z"),
    updatedAt: new Date("2026-07-17T10:00:00.000Z"),
    ...overrides,
  };
}

function technicalCutPlan() {
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

function colorPlan(): ColorPlan {
  return {
    formulaDirection: "single_process_gray_coverage",
    developerVolume: "20vol",
    liftLevels: 0,
    toneDirection: "neutral",
    applicationTechnique: "global_application",
    processingSteps: [{
      stepNumber: 1,
      zone: "Application",
      action: "Apply global formula.",
      toolRequired: "tint-brush",
    }],
    maintenancePlan: ["Refresh tone every 4-6 weeks."],
    strandTestRequired: true,
    stylistExplanation: "Explain the formula direction.",
    clientExplanation: "Explain the expected result.",
    professionalReason: "Cover gray uniformly.",
    warnings: [],
    contraindications: [],
    assumptions: [],
    missingData: [],
    confidence: 0.9,
    stylistValidationDisclaimer: "Validate the formula chair-side.",
    version: "1.0.0-m27",
  };
}

function treatmentPlan(): TreatmentPlan {
  return {
    treatmentCategory: "deep_hydration",
    protocolSteps: [{
      stepNumber: 1,
      zone: "Application",
      action: "Apply hydration mask.",
      toolRequired: "applicator-brush",
    }],
    aftercareSteps: ["Repeat weekly for 4 weeks."],
    recommendedFrequency: "weekly_for_4_weeks",
    followUpReviewWeeks: 4,
    stylistExplanation: "Explain the hydration protocol.",
    clientExplanation: "Explain the expected result.",
    professionalReason: "Address moisture deficit.",
    warnings: [],
    contraindications: [],
    assumptions: [],
    missingData: [],
    confidence: 0.9,
    stylistValidationDisclaimer: "Validate the protocol chair-side.",
    version: "1.0.0-m27",
  };
}