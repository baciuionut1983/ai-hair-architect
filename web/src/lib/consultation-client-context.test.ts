import { beforeEach, describe, expect, it, vi } from "vitest";

const analysisRepoMock = vi.hoisted(() => ({ listAnalysisCorrections: vi.fn() }));
const consultationRepoMock = vi.hoisted(() => ({ listConsultationsForClient: vi.fn() }));
const formulaRepoMock = vi.hoisted(() => ({ listClientFormulasForOwner: vi.fn() }));
const treatmentRepoMock = vi.hoisted(() => ({ listClientTreatmentsForOwner: vi.fn() }));

vi.mock("@/lib/analysis-repository", () => analysisRepoMock);
vi.mock("@/lib/consultation-repository", () => consultationRepoMock);
vi.mock("@/lib/client-formula-repository", () => formulaRepoMock);
vi.mock("@/lib/client-treatment-repository", () => treatmentRepoMock);

import {
  buildClientProfessionalMemory,
  MAX_MEMORY_CONSULTATIONS,
  MAX_MEMORY_CORRECTIONS,
  MAX_MEMORY_SERVICES,
} from "./consultation-client-context";

function correction(overrides: Record<string, unknown> = {}) {
  return {
    id: "correction-1",
    analysisId: "analysis-1",
    fieldName: "hairCondition",
    previousValue: "virgin_healthy",
    newValue: "fragile_breakage",
    source: "stylist_confirmed",
    reason: "She had bleach six weeks ago.",
    createdAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  };
}

function consultation(overrides: Record<string, unknown> = {}) {
  return {
    id: "consultation-1",
    clientId: "client-1",
    analysisId: "analysis-1",
    summary: "First visit, discussed color correction.",
    nextSteps: ["Strand test before next visit."],
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    id: "service-1",
    clientId: "client-1",
    formulaName: "Root touch-up 6N",
    formulaDetails: "20vol, 30 min.",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  analysisRepoMock.listAnalysisCorrections.mockResolvedValue([]);
  consultationRepoMock.listConsultationsForClient.mockResolvedValue([]);
  formulaRepoMock.listClientFormulasForOwner.mockResolvedValue([]);
  treatmentRepoMock.listClientTreatmentsForOwner.mockResolvedValue([]);
});

describe("buildClientProfessionalMemory", () => {
  it("only fetches corrections when a latest analysis id is given -- a client with no analysis has no corrections to fetch", async () => {
    await buildClientProfessionalMemory("owner-1", "client-1", null);

    expect(analysisRepoMock.listAnalysisCorrections).not.toHaveBeenCalled();
  });

  it("fetches corrections scoped to the given analysis id, owner-scoped", async () => {
    analysisRepoMock.listAnalysisCorrections.mockResolvedValue([correction()]);

    const memory = await buildClientProfessionalMemory("owner-1", "client-1", "analysis-1");

    expect(analysisRepoMock.listAnalysisCorrections).toHaveBeenCalledWith("owner-1", "analysis-1");
    expect(memory.recentCorrections).toEqual([
      { fieldName: "hairCondition", newValue: "fragile_breakage", source: "stylist_confirmed", reason: "She had bleach six weeks ago.", createdAt: "2026-08-14T10:00:00.000Z" },
    ]);
  });

  it("scopes consultations/formulas/treatments to owner+client", async () => {
    await buildClientProfessionalMemory("owner-1", "client-1", null);

    expect(consultationRepoMock.listConsultationsForClient).toHaveBeenCalledWith("owner-1", "client-1");
    expect(formulaRepoMock.listClientFormulasForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    expect(treatmentRepoMock.listClientTreatmentsForOwner).toHaveBeenCalledWith("owner-1", "client-1");
  });

  it("maps consultations/formulas/treatments to their memory shape", async () => {
    consultationRepoMock.listConsultationsForClient.mockResolvedValue([consultation()]);
    formulaRepoMock.listClientFormulasForOwner.mockResolvedValue([service()]);
    treatmentRepoMock.listClientTreatmentsForOwner.mockResolvedValue([
      { id: "t-1", clientId: "client-1", treatmentName: "Bond repair", treatmentDetails: "Olaplex #2", createdAt: "2026-08-01T10:00:00.000Z" },
    ]);

    const memory = await buildClientProfessionalMemory("owner-1", "client-1", null);

    expect(memory.recentConsultations).toEqual([
      { summary: "First visit, discussed color correction.", nextSteps: ["Strand test before next visit."], createdAt: "2026-08-01T10:00:00.000Z" },
    ]);
    expect(memory.recentFormulas).toEqual([
      { name: "Root touch-up 6N", details: "20vol, 30 min.", createdAt: "2026-08-01T10:00:00.000Z" },
    ]);
    expect(memory.recentTreatments).toEqual([
      { name: "Bond repair", details: "Olaplex #2", createdAt: "2026-08-01T10:00:00.000Z" },
    ]);
  });

  // M: the context handed to the AI provider must stay bounded no matter
  // how much real history a client accumulates.
  it("caps every list even when the database holds far more history than the bound", async () => {
    analysisRepoMock.listAnalysisCorrections.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => correction({ id: `c-${i}`, fieldName: `field-${i}` })),
    );
    consultationRepoMock.listConsultationsForClient.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => consultation({ id: `k-${i}`, summary: `Visit ${i}` })),
    );
    formulaRepoMock.listClientFormulasForOwner.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => service({ id: `f-${i}`, formulaName: `Formula ${i}` })),
    );
    treatmentRepoMock.listClientTreatmentsForOwner.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({ id: `t-${i}`, clientId: "client-1", treatmentName: `Treatment ${i}`, treatmentDetails: "x", createdAt: "2026-08-01T10:00:00.000Z" })),
    );

    const memory = await buildClientProfessionalMemory("owner-1", "client-1", "analysis-1");

    expect(memory.recentCorrections).toHaveLength(MAX_MEMORY_CORRECTIONS);
    expect(memory.recentConsultations).toHaveLength(MAX_MEMORY_CONSULTATIONS);
    expect(memory.recentFormulas).toHaveLength(MAX_MEMORY_SERVICES);
    expect(memory.recentTreatments).toHaveLength(MAX_MEMORY_SERVICES);
  });

  it("keeps the most recent corrections (the tail of the oldest-first list), not the oldest", async () => {
    analysisRepoMock.listAnalysisCorrections.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => correction({ fieldName: `field-${i}`, createdAt: `2026-08-0${(i % 9) + 1}T10:00:00.000Z` })),
    );

    const memory = await buildClientProfessionalMemory("owner-1", "client-1", "analysis-1");

    expect(memory.recentCorrections.map((c) => c.fieldName)).toEqual(["field-2", "field-3", "field-4", "field-5", "field-6", "field-7", "field-8", "field-9"]);
  });

  it("returns all-empty lists for a client with no history at all, honestly (not fabricated)", async () => {
    const memory = await buildClientProfessionalMemory("owner-1", "client-1", null);

    expect(memory).toEqual({ recentCorrections: [], recentConsultations: [], recentFormulas: [], recentTreatments: [] });
  });
});
