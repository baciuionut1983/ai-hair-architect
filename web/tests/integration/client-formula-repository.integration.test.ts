import { randomUUID } from "crypto";

import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  ClientFormulaDependencyError,
  createClientFormulaForOwner,
  listClientFormulasForOwner,
} from "@/lib/client-formula-repository";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("client formula repository integration", () => {
  it("persists a formula and reads it back through a fresh Prisma client (real durability)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();

    const created = await createClientFormulaForOwner({
      clientId,
      ownerUserId,
      formulaName: "Gray coverage",
      formulaDetails: "6N + 20vol, 35 min",
    });

    const freshClient = new PrismaClient();
    try {
      await expect(freshClient.clientFormula.findUnique({ where: { id: created.id } })).resolves.toMatchObject({
        clientId,
        ownerUserId,
        formulaName: "Gray coverage",
        formulaDetails: "6N + 20vol, 35 min",
        sourceAnalysisId: null,
      });
    } finally {
      await freshClient.$disconnect();
    }

    await expect(listClientFormulasForOwner(ownerUserId, clientId)).resolves.toEqual([created]);
    await cleanupOwners([ownerUserId]);
  });

  it("rejects a nonexistent client and a client belonging to a different owner", async () => {
    const { ownerUserId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();

    await expect(
      createClientFormulaForOwner({
        clientId: randomUUID(),
        ownerUserId,
        formulaName: "n",
        formulaDetails: "d",
      }),
    ).rejects.toBeInstanceOf(ClientFormulaDependencyError);

    await expect(
      createClientFormulaForOwner({
        clientId: other.clientId,
        ownerUserId,
        formulaName: "n",
        formulaDetails: "d",
      }),
    ).rejects.toBeInstanceOf(ClientFormulaDependencyError);

    await cleanupOwners([ownerUserId, other.ownerUserId]);
  });

  it("accepts a valid sourceAnalysisId and persists the link", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysisForOwner(ownerUserId, clientId, readyAnalysisInput());

    const created = await createClientFormulaForOwner({
      clientId,
      ownerUserId,
      formulaName: "n",
      formulaDetails: "d",
      sourceAnalysisId: analysis.id,
    });

    await expect(prisma.clientFormula.findUnique({ where: { id: created.id } })).resolves.toMatchObject({
      sourceAnalysisId: analysis.id,
    });

    await cleanupOwners([ownerUserId]);
  });

  it("rejects a sourceAnalysisId belonging to a different owner", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const othersAnalysis = await createAnalysisForOwner(other.ownerUserId, other.clientId, readyAnalysisInput());

    await expect(
      createClientFormulaForOwner({
        clientId,
        ownerUserId,
        formulaName: "n",
        formulaDetails: "d",
        sourceAnalysisId: othersAnalysis.id,
      }),
    ).rejects.toMatchObject({ code: "CLIENT_FORMULA_SOURCE_ANALYSIS_NOT_FOUND" });

    await cleanupOwners([ownerUserId, other.ownerUserId]);
  });

  it("rejects a sourceAnalysisId belonging to a different client of the same owner", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const secondClientId = randomUUID();
    await prisma.client.create({ data: { id: secondClientId, ownerUserId, fullName: "Second Client" } });
    const secondClientsAnalysis = await createAnalysisForOwner(ownerUserId, secondClientId, readyAnalysisInput());

    await expect(
      createClientFormulaForOwner({
        clientId,
        ownerUserId,
        formulaName: "n",
        formulaDetails: "d",
        sourceAnalysisId: secondClientsAnalysis.id,
      }),
    ).rejects.toMatchObject({ code: "CLIENT_FORMULA_SOURCE_ANALYSIS_NOT_FOUND" });

    await cleanupOwners([ownerUserId]);
  });

  it("blocks deleting an Analysis referenced by a ClientFormula (RESTRICT, database-level)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysisForOwner(ownerUserId, clientId, readyAnalysisInput());
    await createClientFormulaForOwner({
      clientId,
      ownerUserId,
      formulaName: "n",
      formulaDetails: "d",
      sourceAnalysisId: analysis.id,
    });

    await expect(prisma.analysis.delete({ where: { id: analysis.id } })).rejects.toThrow();

    await cleanupOwners([ownerUserId]);
  });

  it("enforces cross-owner client isolation at the database level, not only in application code", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();

    await expect(
      prisma.clientFormula.create({
        data: {
          clientId,
          ownerUserId: other.ownerUserId,
          formulaName: "n",
          formulaDetails: "d",
        },
      }),
    ).rejects.toThrow();

    await cleanupOwners([ownerUserId, other.ownerUserId]);
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@client-formula-repository.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({
    data: { id: clientId, ownerUserId, fullName: "Client Formula Repository Client" },
  });
  return { ownerUserId, clientId };
}

function readyAnalysisInput() {
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

async function cleanupOwners(ownerUserIds: string[]) {
  await prisma.clientFormula.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
  await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
  await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
}
