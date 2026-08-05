import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  transaction: vi.fn(),
  clientFindFirst: vi.fn(),
  analysisFindFirst: vi.fn(),
  clientFormulaCreate: vi.fn(),
  clientFormulaFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    $transaction: prismaMocks.transaction,
    clientFormula: { findMany: prismaMocks.clientFormulaFindMany },
  },
}));

const tx = {
  client: { findFirst: prismaMocks.clientFindFirst },
  analysis: { findFirst: prismaMocks.analysisFindFirst },
  clientFormula: { create: prismaMocks.clientFormulaCreate },
};

import {
  ClientFormulaDependencyError,
  ClientFormulaPersistenceError,
  clientFormulaPersistenceUnavailableResponse,
  createClientFormulaForOwner,
  isClientFormulaPersistenceError,
  listClientFormulasForOwner,
} from "@/lib/client-formula-repository";

function formulaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "formula-1",
    clientId: "client-1",
    ownerUserId: "owner-1",
    formulaName: "Gray coverage",
    formulaDetails: "6N + 20vol, 35 min",
    sourceAnalysisId: null,
    createdAt: new Date("2026-08-05T10:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  prismaMocks.configured = true;
  prismaMocks.transaction.mockReset();
  prismaMocks.clientFindFirst.mockReset();
  prismaMocks.analysisFindFirst.mockReset();
  prismaMocks.clientFormulaCreate.mockReset();
  prismaMocks.clientFormulaFindMany.mockReset();
  prismaMocks.transaction.mockImplementation(async (operation) => operation(tx));
});

const BASE_INPUT = {
  clientId: "client-1",
  ownerUserId: "owner-1",
  formulaName: "Gray coverage",
  formulaDetails: "6N + 20vol, 35 min",
};

describe("client-formula-repository", () => {
  it("creates a formula with no sourceAnalysisId, never checking Analysis at all", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.clientFormulaCreate.mockResolvedValue(formulaRow());

    const result = await createClientFormulaForOwner(BASE_INPUT);

    expect(prismaMocks.analysisFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.clientFormulaCreate).toHaveBeenCalledWith({
      data: { ...BASE_INPUT, sourceAnalysisId: null },
    });
    expect(result).toEqual({
      id: "formula-1",
      clientId: "client-1",
      formulaName: "Gray coverage",
      formulaDetails: "6N + 20vol, 35 min",
      createdAt: "2026-08-05T10:00:00.000Z",
    });
    expect(result).not.toHaveProperty("ownerUserId");
    expect(result).not.toHaveProperty("sourceAnalysisId");
  });

  it("rejects when the client does not exist, without checking Analysis or creating anything", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue(null);

    await expect(createClientFormulaForOwner(BASE_INPUT)).rejects.toMatchObject({
      code: "CLIENT_FORMULA_CLIENT_NOT_FOUND",
      httpStatus: 404,
    });
    expect(prismaMocks.analysisFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.clientFormulaCreate).not.toHaveBeenCalled();
  });

  it("accepts a valid sourceAnalysisId belonging to the same owner and client", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisFindFirst.mockResolvedValue({ id: "analysis-1" });
    prismaMocks.clientFormulaCreate.mockResolvedValue(formulaRow({ sourceAnalysisId: "analysis-1" }));

    await createClientFormulaForOwner({ ...BASE_INPUT, sourceAnalysisId: "analysis-1" });

    expect(prismaMocks.analysisFindFirst).toHaveBeenCalledWith({
      where: { id: "analysis-1", ownerUserId: "owner-1", clientId: "client-1" },
      select: { id: true },
    });
    expect(prismaMocks.clientFormulaCreate).toHaveBeenCalledWith({
      data: { ...BASE_INPUT, sourceAnalysisId: "analysis-1" },
    });
  });

  it("rejects a sourceAnalysisId belonging to a different owner (query is owner-scoped)", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisFindFirst.mockResolvedValue(null);

    await expect(
      createClientFormulaForOwner({ ...BASE_INPUT, sourceAnalysisId: "someone-elses-analysis" }),
    ).rejects.toMatchObject({ code: "CLIENT_FORMULA_SOURCE_ANALYSIS_NOT_FOUND", httpStatus: 404 });
    expect(prismaMocks.clientFormulaCreate).not.toHaveBeenCalled();
  });

  it("rejects a sourceAnalysisId belonging to a different client of the same owner", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisFindFirst.mockResolvedValue(null);

    await expect(
      createClientFormulaForOwner({ ...BASE_INPUT, sourceAnalysisId: "other-clients-analysis" }),
    ).rejects.toBeInstanceOf(ClientFormulaDependencyError);
    expect(prismaMocks.analysisFindFirst).toHaveBeenCalledWith({
      where: { id: "other-clients-analysis", ownerUserId: "owner-1", clientId: "client-1" },
      select: { id: true },
    });
  });

  it("lists formulas newest-first, scoped to owner and client", async () => {
    prismaMocks.clientFormulaFindMany.mockResolvedValue([formulaRow()]);

    const result = await listClientFormulasForOwner("owner-1", "client-1");

    expect(prismaMocks.clientFormulaFindMany).toHaveBeenCalledWith({
      where: { clientId: "client-1", ownerUserId: "owner-1", client: { deletedAt: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(result).toHaveLength(1);
  });

  it("fails closed when the database is not configured", async () => {
    prismaMocks.configured = false;
    await expect(listClientFormulasForOwner("owner-1", "client-1")).rejects.toBeInstanceOf(
      ClientFormulaPersistenceError,
    );
  });

  it("sanitizes unexpected Prisma failures", async () => {
    prismaMocks.clientFormulaFindMany.mockRejectedValue(new Error("password=secret host=internal"));
    await expect(listClientFormulasForOwner("owner-1", "client-1")).rejects.toMatchObject({
      code: "CLIENT_FORMULA_PERSISTENCE_UNAVAILABLE",
      httpStatus: 503,
    });
  });

  it("exposes the standardized no-store error response and the type guard", () => {
    expect(isClientFormulaPersistenceError(new ClientFormulaPersistenceError())).toBe(true);
    expect(isClientFormulaPersistenceError(new Error("other"))).toBe(false);

    const response = clientFormulaPersistenceUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
