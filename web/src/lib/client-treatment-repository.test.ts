import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  transaction: vi.fn(),
  clientFindFirst: vi.fn(),
  analysisFindFirst: vi.fn(),
  clientTreatmentCreate: vi.fn(),
  clientTreatmentFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    $transaction: prismaMocks.transaction,
    clientTreatment: { findMany: prismaMocks.clientTreatmentFindMany },
  },
}));

const tx = {
  client: { findFirst: prismaMocks.clientFindFirst },
  analysis: { findFirst: prismaMocks.analysisFindFirst },
  clientTreatment: { create: prismaMocks.clientTreatmentCreate },
};

import {
  ClientTreatmentDependencyError,
  ClientTreatmentPersistenceError,
  clientTreatmentPersistenceUnavailableResponse,
  createClientTreatmentForOwner,
  isClientTreatmentPersistenceError,
  listClientTreatmentsForOwner,
} from "@/lib/client-treatment-repository";

function treatmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "treatment-1",
    clientId: "client-1",
    ownerUserId: "owner-1",
    treatmentName: "Deep hydration",
    treatmentDetails: "Bond-building mask, 20 min under heat",
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
  prismaMocks.clientTreatmentCreate.mockReset();
  prismaMocks.clientTreatmentFindMany.mockReset();
  prismaMocks.transaction.mockImplementation(async (operation) => operation(tx));
});

const BASE_INPUT = {
  clientId: "client-1",
  ownerUserId: "owner-1",
  treatmentName: "Deep hydration",
  treatmentDetails: "Bond-building mask, 20 min under heat",
};

describe("client-treatment-repository", () => {
  it("creates a treatment with no sourceAnalysisId, never checking Analysis at all", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.clientTreatmentCreate.mockResolvedValue(treatmentRow());

    const result = await createClientTreatmentForOwner(BASE_INPUT);

    expect(prismaMocks.analysisFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.clientTreatmentCreate).toHaveBeenCalledWith({
      data: { ...BASE_INPUT, sourceAnalysisId: null },
    });
    expect(result).toEqual({
      id: "treatment-1",
      clientId: "client-1",
      treatmentName: "Deep hydration",
      treatmentDetails: "Bond-building mask, 20 min under heat",
      createdAt: "2026-08-05T10:00:00.000Z",
    });
    expect(result).not.toHaveProperty("ownerUserId");
    expect(result).not.toHaveProperty("sourceAnalysisId");
  });

  it("rejects when the client does not exist, without checking Analysis or creating anything", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue(null);

    await expect(createClientTreatmentForOwner(BASE_INPUT)).rejects.toMatchObject({
      code: "CLIENT_TREATMENT_CLIENT_NOT_FOUND",
      httpStatus: 404,
    });
    expect(prismaMocks.analysisFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.clientTreatmentCreate).not.toHaveBeenCalled();
  });

  it("accepts a valid sourceAnalysisId belonging to the same owner and client", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisFindFirst.mockResolvedValue({ id: "analysis-1" });
    prismaMocks.clientTreatmentCreate.mockResolvedValue(treatmentRow({ sourceAnalysisId: "analysis-1" }));

    await createClientTreatmentForOwner({ ...BASE_INPUT, sourceAnalysisId: "analysis-1" });

    expect(prismaMocks.analysisFindFirst).toHaveBeenCalledWith({
      where: { id: "analysis-1", ownerUserId: "owner-1", clientId: "client-1" },
      select: { id: true },
    });
    expect(prismaMocks.clientTreatmentCreate).toHaveBeenCalledWith({
      data: { ...BASE_INPUT, sourceAnalysisId: "analysis-1" },
    });
  });

  it("rejects a sourceAnalysisId belonging to a different owner (query is owner-scoped)", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisFindFirst.mockResolvedValue(null);

    await expect(
      createClientTreatmentForOwner({ ...BASE_INPUT, sourceAnalysisId: "someone-elses-analysis" }),
    ).rejects.toMatchObject({ code: "CLIENT_TREATMENT_SOURCE_ANALYSIS_NOT_FOUND", httpStatus: 404 });
    expect(prismaMocks.clientTreatmentCreate).not.toHaveBeenCalled();
  });

  it("rejects a sourceAnalysisId belonging to a different client of the same owner", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.analysisFindFirst.mockResolvedValue(null);

    await expect(
      createClientTreatmentForOwner({ ...BASE_INPUT, sourceAnalysisId: "other-clients-analysis" }),
    ).rejects.toBeInstanceOf(ClientTreatmentDependencyError);
    expect(prismaMocks.analysisFindFirst).toHaveBeenCalledWith({
      where: { id: "other-clients-analysis", ownerUserId: "owner-1", clientId: "client-1" },
      select: { id: true },
    });
  });

  it("lists treatments newest-first, scoped to owner and client", async () => {
    prismaMocks.clientTreatmentFindMany.mockResolvedValue([treatmentRow()]);

    const result = await listClientTreatmentsForOwner("owner-1", "client-1");

    expect(prismaMocks.clientTreatmentFindMany).toHaveBeenCalledWith({
      where: { clientId: "client-1", ownerUserId: "owner-1", client: { deletedAt: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(result).toHaveLength(1);
  });

  it("fails closed when the database is not configured", async () => {
    prismaMocks.configured = false;
    await expect(listClientTreatmentsForOwner("owner-1", "client-1")).rejects.toBeInstanceOf(
      ClientTreatmentPersistenceError,
    );
  });

  it("sanitizes unexpected Prisma failures", async () => {
    prismaMocks.clientTreatmentFindMany.mockRejectedValue(new Error("password=secret host=internal"));
    await expect(listClientTreatmentsForOwner("owner-1", "client-1")).rejects.toMatchObject({
      code: "CLIENT_TREATMENT_PERSISTENCE_UNAVAILABLE",
      httpStatus: 503,
    });
  });

  it("exposes the standardized no-store error response and the type guard", () => {
    expect(isClientTreatmentPersistenceError(new ClientTreatmentPersistenceError())).toBe(true);
    expect(isClientTreatmentPersistenceError(new Error("other"))).toBe(false);

    const response = clientTreatmentPersistenceUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
