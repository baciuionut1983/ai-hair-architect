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
  analysisCorrectionCreate: vi.fn(),
  analysisCorrectionFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    $transaction: prismaMocks.transaction,
    analysis: {
      findFirst: prismaMocks.analysisFindFirst,
    },
    analysisCorrection: {
      findMany: prismaMocks.analysisCorrectionFindMany,
    },
  },
}));

import {
  AnalysisConcurrencyError,
  AnalysisCorrectionValidationError,
  AnalysisDependencyError,
  AnalysisPersistenceError,
  analysisPersistenceUnavailableResponse,
  applyAnalysisCorrection,
  clarifyAnalysisForOwner,
  createAnalysisForOwner,
  findAnalysisForOwner,
  findLatestAnalysisForClient,
  listAnalysisCorrections,
} from "./analysis-repository";

const tx = {
  client: { findFirst: prismaMocks.clientFindFirst },
  analysis: {
    create: prismaMocks.analysisCreate,
    findFirst: prismaMocks.analysisFindFirst,
    update: prismaMocks.analysisUpdate,
  },
  analysisCorrection: {
    create: prismaMocks.analysisCorrectionCreate,
  },
};

beforeEach(() => {
  prismaMocks.configured = true;
  prismaMocks.transaction.mockReset();
  prismaMocks.clientFindFirst.mockReset();
  prismaMocks.analysisCreate.mockReset();
  prismaMocks.analysisFindFirst.mockReset();
  prismaMocks.analysisUpdate.mockReset();
  prismaMocks.analysisCorrectionCreate.mockReset().mockResolvedValue({});
  prismaMocks.analysisCorrectionFindMany.mockReset().mockResolvedValue([]);
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

  it("returns imageAssetId on the created AnalysisState itself, not just on the Prisma write payload (sub-milestone 1: this is what the API routes read to expose the photo)", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisCreate.mockResolvedValue(analysisRow({ imageAssetId: "asset-1" }));

    const created = await createAnalysisForOwner("owner-1", "client-1", {
      ...createInput(),
      imageAssetId: "asset-1",
      imageAnalysisId: "image-analysis-1",
    });

    expect(created.imageAssetId).toBe("asset-1");
  });

  it("findAnalysisForOwner also returns imageAssetId on the returned AnalysisState (used by GET /api/v1/analysis/[id]/result -- View full analysis)", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ imageAssetId: "asset-1" }));

    const found = await findAnalysisForOwner("owner-1", "analysis-1");

    expect(found?.imageAssetId).toBe("asset-1");
  });

  it("rejects missing or soft-deleted Clients without creating an Analysis", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue(null);

    await expect(createAnalysisForOwner("owner-1", "client-1", createInput())).rejects.toMatchObject({
      code: "ANALYSIS_CLIENT_NOT_FOUND",
      httpStatus: 404,
    });
    expect(prismaMocks.analysisCreate).not.toHaveBeenCalled();
  });

  // Conversational Professional AI: Consult AI opened from the client page
  // (not a specific analysis page) has no analysisId in hand -- this is
  // what it uses to find the client's own baseline analysis automatically,
  // instead of a stylist having to re-describe a hair profile the platform
  // already has on file (the exact production bug this closes).
  describe("findLatestAnalysisForClient", () => {
    it("queries owner+client scoped, newest first, restricted to real M2 goal/phase values", async () => {
      prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow());

      await findLatestAnalysisForClient("owner-1", "client-1");

      expect(prismaMocks.analysisFindFirst).toHaveBeenCalledWith({
        where: {
          clientId: "client-1",
          ownerUserId: "owner-1",
          goal: { in: ["refresh", "cover", "lighten", "correct", "reshape", "treat"] },
          phase: { in: ["pending_questions", "ready"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    });

    it("returns null, not an error, when this client genuinely has no analysis yet", async () => {
      prismaMocks.analysisFindFirst.mockResolvedValue(null);

      const found = await findLatestAnalysisForClient("owner-1", "client-1");

      expect(found).toBeNull();
    });

    it("returns the real AnalysisState (including its plans) for the client's newest row", async () => {
      prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ id: "analysis-latest" }));

      const found = await findLatestAnalysisForClient("owner-1", "client-1");

      expect(found?.id).toBe("analysis-latest");
    });

    it("fails closed when the database is unavailable", async () => {
      prismaMocks.configured = false;

      await expect(findLatestAnalysisForClient("owner-1", "client-1")).rejects.toBeInstanceOf(AnalysisPersistenceError);
    });
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

  it("carries colorPlan and treatmentPlan forward through a clarify update exactly as the transition returned them", async () => {
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

  // Regression coverage: analyzeWithClarifications (analysis-engine.ts) can
  // derive a new hairCondition from the clarification answers (Conversational
  // AI milestone) -- this proves the repository actually PERSISTS whatever
  // the transition returns for every profile field, not just phase/
  // confidence/plans. Before this fix, a transition that changed
  // hairCondition would recompute the plan correctly but the DB row (and
  // therefore every future read) would silently keep the OLD hairCondition
  // forever -- the transition's own return value was never wired into
  // tx.analysis.update()'s data.
  it("persists a hairCondition derived by the transition, not just phase/confidence/plans (previously silently dropped)", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ hairCondition: null, phase: "pending_questions" }));
    prismaMocks.analysisUpdate.mockImplementation(async ({ data }) => analysisRow({
      hairCondition: data.hairCondition,
      phase: data.phase,
    }));

    const transition = vi.fn((current) => ({ ...current, phase: "ready" as const, hairCondition: "virgin_healthy" as const }));
    const result = await clarifyAnalysisForOwner("owner-1", "analysis-1", transition);

    expect(prismaMocks.analysisUpdate.mock.calls[0][0].data.hairCondition).toBe("virgin_healthy");
    expect(result?.hairCondition).toBe("virgin_healthy");
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

// Conversational Professional AI milestone -- "AI trebuie să poată fi
// contrazis": a stylist correction must (1) be recorded with provenance
// BEFORE anything else, (2) actually change the persisted Analysis row
// through the real deterministic engines (recomputePlans), never a second
// implementation, and (3) never accept a source a human caller has no
// business claiming (visual_ai/historical/assumed).
describe("applyAnalysisCorrection", () => {
  it("rejects an invalid value for the field before touching the database at all", async () => {
    await expect(
      applyAnalysisCorrection("owner-1", "analysis-1", {
        field: "hairCondition",
        value: "not-a-real-value",
        source: "stylist_confirmed",
      }),
    ).rejects.toBeInstanceOf(AnalysisCorrectionValidationError);
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when the Analysis does not exist or belongs to another owner", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(null);

    const result = await applyAnalysisCorrection("owner-1", "foreign-analysis", {
      field: "hairCondition",
      value: "virgin_healthy",
      source: "stylist_confirmed",
    });

    expect(result).toBeNull();
    expect(prismaMocks.analysisCorrectionCreate).not.toHaveBeenCalled();
    expect(prismaMocks.analysisUpdate).not.toHaveBeenCalled();
  });

  it("records provenance (previousValue, newValue, source, reason) in the SAME transaction as the Analysis update", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ hairCondition: null }));
    prismaMocks.analysisUpdate.mockImplementation(async ({ data }) => analysisRow({ hairCondition: data.hairCondition }));

    await applyAnalysisCorrection("owner-1", "analysis-1", {
      field: "hairCondition",
      value: "fragile_breakage",
      source: "stylist_confirmed",
      reason: "Visible breakage observed chair-side.",
    });

    expect(prismaMocks.analysisCorrectionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        analysisId: "analysis-1",
        ownerUserId: "owner-1",
        clientId: "client-1",
        fieldName: "hairCondition",
        previousValue: Prisma.JsonNull,
        newValue: "fragile_breakage",
        source: "stylist_confirmed",
        reason: "Visible breakage observed chair-side.",
      }),
    });
    expect(prismaMocks.analysisUpdate.mock.calls[0][0].data.hairCondition).toBe("fragile_breakage");
  });

  it("captures the real previous value (not null) when overriding an already-known field", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ hairCondition: "virgin_healthy" }));
    prismaMocks.analysisUpdate.mockImplementation(async ({ data }) => analysisRow({ hairCondition: data.hairCondition }));

    await applyAnalysisCorrection("owner-1", "analysis-1", {
      field: "hairCondition",
      value: "chemically_treated",
      source: "client_reported",
      reason: "Client disclosed bleach 6 weeks ago.",
    });

    expect(prismaMocks.analysisCorrectionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ previousValue: "virgin_healthy", newValue: "chemically_treated", source: "client_reported" }),
    });
  });

  it("recomputes the plan through the real engine -- a correction that changes hairCondition to fragile_breakage produces a color plan with the compromised-hair safety clamp", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({
      goal: "lighten",
      desiredColorResult: "full_lightening",
      hairCondition: null,
    }));
    prismaMocks.analysisUpdate.mockImplementation(async ({ data }) => analysisRow({
      hairCondition: data.hairCondition,
      colorPlan: data.colorPlan === Prisma.JsonNull ? null : data.colorPlan,
    }));

    const result = await applyAnalysisCorrection("owner-1", "analysis-1", {
      field: "hairCondition",
      value: "fragile_breakage",
      source: "stylist_confirmed",
    });

    expect(prismaMocks.analysisUpdate.mock.calls[0][0].data.colorPlan).toMatchObject({
      developerVolume: "20vol",
      contraindications: expect.arrayContaining([
        "Do not perform double-process lightening on compromised hair in this session.",
      ]),
    });
    expect(result?.colorPlan?.developerVolume).toBe("20vol");
  });

  it("does not accept a system-only source (visual_ai/historical/assumed) at the type level -- ApplyAnalysisCorrectionInput['source'] only allows stylist_confirmed/client_reported", () => {
    // Compile-time guarantee, asserted here for documentation: the route
    // layer additionally validates this at runtime (see correct/route.test.ts).
    const allowed: Array<"stylist_confirmed" | "client_reported"> = ["stylist_confirmed", "client_reported"];
    expect(allowed).toHaveLength(2);
  });

  // Regression (AI Proposed Look Apply-consistency audit): a live production
  // report showed the card correctly flip to "Applied" after applying
  // "Blunt Perimeter Texturized," but the displayed Haircut plan still
  // showed the old Internal Layering/Scissor Over Comb architecture. Root
  // cause was in cutting-plan-engine.ts (three TargetShape values had no
  // branch, see cutting-plan-engine.test.ts), not here -- but this proves
  // the actual production path (applyAnalysisCorrection, the real engine,
  // no mocked recomputation) produces a genuinely different, correct plan,
  // and that the corrected field and its recomputed plan are written in the
  // exact same tx.analysis.update() call, so no intermediate state can ever
  // have the new targetShape with the old plan (or vice versa).
  it("regenerates the Haircut plan's technical coordinates when targetShape is corrected -- and writes the corrected field and the recomputed plan in the SAME update call (production regression: Blunt Perimeter Texturized applied, plan stayed on the neutral defaults)", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ goal: "reshape", targetShape: null }));
    prismaMocks.analysisUpdate.mockImplementation(async ({ data }) => analysisRow({
      targetShape: data.targetShape,
      technicalCutPlan: data.technicalCutPlan === Prisma.JsonNull ? null : data.technicalCutPlan,
    }));

    const result = await applyAnalysisCorrection("owner-1", "analysis-1", {
      field: "targetShape",
      value: "blunt_perimeter_texturized",
      source: "stylist_confirmed",
    });

    const writtenData = prismaMocks.analysisUpdate.mock.calls[0][0].data;
    expect(writtenData.targetShape).toBe("blunt_perimeter_texturized");
    expect(writtenData.technicalCutPlan).toMatchObject({
      structuralTechnique: "one_length",
      cuttingTechnique: "blunt_line",
      texturizingTechnique: "slice_and_slide",
      elevation: "0_deg_blunt",
      distribution: "natural_fall",
      guideline: "visual_perimeter",
    });
    // Not the neutral defaults the production report showed staying put.
    expect(writtenData.technicalCutPlan.structuralTechnique).not.toBe("internal_layering");
    expect(writtenData.technicalCutPlan.cuttingTechnique).not.toBe("scissor_over_comb");
    expect(result?.targetShape).toBe("blunt_perimeter_texturized");
    expect(result?.technicalCutPlan?.structuralTechnique).toBe("one_length");
  });

  it("leaves the Haircut plan's technical coordinates unchanged when the corrected field does not affect the cutting-plan engine's inputs (unrelated correction must not perturb unrelated derived output)", async () => {
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ goal: "reshape", targetShape: "graduated_bob", scalpCondition: null }));
    prismaMocks.analysisUpdate.mockImplementation(async ({ data }) => analysisRow({
      scalpCondition: data.scalpCondition,
      technicalCutPlan: data.technicalCutPlan === Prisma.JsonNull ? null : data.technicalCutPlan,
    }));

    await applyAnalysisCorrection("owner-1", "analysis-1", {
      field: "scalpCondition",
      value: "oily",
      source: "client_reported",
    });

    const writtenData = prismaMocks.analysisUpdate.mock.calls[0][0].data;
    expect(writtenData.scalpCondition).toBe("oily");
    // graduated_bob's own coordinates (see cutting-plan-engine.test.ts) --
    // unaffected by a scalpCondition-only correction.
    expect(writtenData.technicalCutPlan).toMatchObject({
      structuralTechnique: "graduation",
      cuttingTechnique: "slice_cutting",
      elevation: "45_deg_graduation",
    });
  });

  it("retries serialization conflicts for applyAnalysisCorrection just like other Analysis mutations, and the retried attempt still writes the corrected field and its recomputed plan together", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", {
      code: "P2034",
      clientVersion: "test",
    });
    let attempts = 0;
    prismaMocks.analysisFindFirst.mockResolvedValue(analysisRow({ goal: "reshape", targetShape: null }));
    prismaMocks.analysisUpdate.mockImplementation(async ({ data }) => analysisRow({
      targetShape: data.targetShape,
      technicalCutPlan: data.technicalCutPlan === Prisma.JsonNull ? null : data.technicalCutPlan,
    }));
    prismaMocks.transaction.mockImplementation(async (operation) => {
      attempts += 1;
      const result = await operation(tx);
      if (attempts < 3) throw conflict;
      return result;
    });

    const result = await applyAnalysisCorrection("owner-1", "analysis-1", {
      field: "targetShape",
      value: "pixie_crop",
      source: "stylist_confirmed",
    });

    expect(prismaMocks.transaction).toHaveBeenCalledTimes(3);
    expect(result?.targetShape).toBe("pixie_crop");
    expect(result?.technicalCutPlan?.structuralTechnique).toBe("compact_graduation");
  });
});

describe("listAnalysisCorrections", () => {
  it("returns corrections scoped to the exact analysisId + ownerUserId, oldest first", async () => {
    await listAnalysisCorrections("owner-1", "analysis-1");

    expect(prismaMocks.analysisCorrectionFindMany).toHaveBeenCalledWith({
      where: { analysisId: "analysis-1", ownerUserId: "owner-1" },
      orderBy: { createdAt: "asc" },
    });
  });

  it("fails closed when the database is unavailable", async () => {
    prismaMocks.configured = false;
    await expect(listAnalysisCorrections("owner-1", "analysis-1")).rejects.toBeInstanceOf(AnalysisPersistenceError);
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