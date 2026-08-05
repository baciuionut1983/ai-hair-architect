import { randomUUID } from "crypto";

import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createAnalysisForOwner } from "@/lib/analysis-repository";
import {
  ClientTreatmentDependencyError,
  createClientTreatmentForOwner,
  listClientTreatmentsForOwner,
} from "@/lib/client-treatment-repository";
import { prisma } from "@/lib/prisma";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("client treatment repository integration", () => {
  it("persists a treatment and reads it back through a fresh Prisma client (real durability)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();

    const created = await createClientTreatmentForOwner({
      clientId,
      ownerUserId,
      treatmentName: "Deep hydration",
      treatmentDetails: "Bond-building mask, 20 min under heat",
    });

    const freshClient = new PrismaClient();
    try {
      await expect(freshClient.clientTreatment.findUnique({ where: { id: created.id } })).resolves.toMatchObject({
        clientId,
        ownerUserId,
        treatmentName: "Deep hydration",
        treatmentDetails: "Bond-building mask, 20 min under heat",
        sourceAnalysisId: null,
      });
    } finally {
      await freshClient.$disconnect();
    }

    await expect(listClientTreatmentsForOwner(ownerUserId, clientId)).resolves.toEqual([created]);
    await cleanupOwners([ownerUserId]);
  });

  it("rejects a nonexistent client and a client belonging to a different owner", async () => {
    const { ownerUserId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();

    await expect(
      createClientTreatmentForOwner({
        clientId: randomUUID(),
        ownerUserId,
        treatmentName: "n",
        treatmentDetails: "d",
      }),
    ).rejects.toBeInstanceOf(ClientTreatmentDependencyError);

    await expect(
      createClientTreatmentForOwner({
        clientId: other.clientId,
        ownerUserId,
        treatmentName: "n",
        treatmentDetails: "d",
      }),
    ).rejects.toBeInstanceOf(ClientTreatmentDependencyError);

    await cleanupOwners([ownerUserId, other.ownerUserId]);
  });

  it("accepts a valid sourceAnalysisId and persists the link", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysisForOwner(ownerUserId, clientId, readyAnalysisInput());

    const created = await createClientTreatmentForOwner({
      clientId,
      ownerUserId,
      treatmentName: "n",
      treatmentDetails: "d",
      sourceAnalysisId: analysis.id,
    });

    await expect(prisma.clientTreatment.findUnique({ where: { id: created.id } })).resolves.toMatchObject({
      sourceAnalysisId: analysis.id,
    });

    await cleanupOwners([ownerUserId]);
  });

  it("rejects a sourceAnalysisId belonging to a different owner", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const othersAnalysis = await createAnalysisForOwner(other.ownerUserId, other.clientId, readyAnalysisInput());

    await expect(
      createClientTreatmentForOwner({
        clientId,
        ownerUserId,
        treatmentName: "n",
        treatmentDetails: "d",
        sourceAnalysisId: othersAnalysis.id,
      }),
    ).rejects.toMatchObject({ code: "CLIENT_TREATMENT_SOURCE_ANALYSIS_NOT_FOUND" });

    await cleanupOwners([ownerUserId, other.ownerUserId]);
  });

  it("rejects a sourceAnalysisId belonging to a different client of the same owner", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const secondClientId = randomUUID();
    await prisma.client.create({ data: { id: secondClientId, ownerUserId, fullName: "Second Client" } });
    const secondClientsAnalysis = await createAnalysisForOwner(ownerUserId, secondClientId, readyAnalysisInput());

    await expect(
      createClientTreatmentForOwner({
        clientId,
        ownerUserId,
        treatmentName: "n",
        treatmentDetails: "d",
        sourceAnalysisId: secondClientsAnalysis.id,
      }),
    ).rejects.toMatchObject({ code: "CLIENT_TREATMENT_SOURCE_ANALYSIS_NOT_FOUND" });

    await cleanupOwners([ownerUserId]);
  });

  it("blocks deleting an Analysis referenced by a ClientTreatment (RESTRICT, database-level)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysisForOwner(ownerUserId, clientId, readyAnalysisInput());
    await createClientTreatmentForOwner({
      clientId,
      ownerUserId,
      treatmentName: "n",
      treatmentDetails: "d",
      sourceAnalysisId: analysis.id,
    });

    await expect(prisma.analysis.delete({ where: { id: analysis.id } })).rejects.toThrow();

    await cleanupOwners([ownerUserId]);
  });

  it("enforces cross-owner client isolation at the database level, not only in application code", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();

    await expect(
      prisma.clientTreatment.create({
        data: {
          clientId,
          ownerUserId: other.ownerUserId,
          treatmentName: "n",
          treatmentDetails: "d",
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
      email: `${ownerUserId}@client-treatment-repository.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({
    data: { id: clientId, ownerUserId, fullName: "Client Treatment Repository Client" },
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
  await prisma.clientTreatment.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
  await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
  await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
}
