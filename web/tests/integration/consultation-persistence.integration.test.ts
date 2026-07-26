import { randomUUID } from "crypto";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  ConsultationDependencyError,
  ConsultationPersistenceError,
  ConsultationValidationError,
  consultationPersistenceUnavailableResponse,
  createConsultationForOwner,
  findConsultationForOwner,
  listConsultationsForClient,
  normalizeConsultationNextSteps,
} from "@/lib/consultation-repository";
import { prisma } from "@/lib/prisma";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("Consultation durable persistence", () => {
  afterEach(async () => {
    await prisma.consultation.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("creates, restarts, reads and deterministically lists owner-scoped records", async () => {
    const { ownerUserId, clientId, analysisId } = await createDependencies("ready");
    const first = await createConsultationForOwner(ownerUserId, {
      clientId,
      analysisId,
      summary: "  Durable summary  ".trim(),
      nextSteps: normalizeConsultationNextSteps([" first ", "", "second"]),
    });

    const freshClient = new PrismaClient();
    try {
      const persisted = await freshClient.consultation.findFirst({ where: { id: first.id, ownerUserId } });
      expect(persisted).toMatchObject({
        clientId,
        analysisId,
        summary: "Durable summary",
        nextSteps: ["first", "second"],
      });
    } finally {
      await freshClient.$disconnect();
    }

    await prisma.consultation.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        analysisId,
        summary: "Same timestamp",
        nextSteps: [],
        createdAt: new Date(first.createdAt),
      },
    });
    const listed = await listConsultationsForClient(ownerUserId, clientId);
    expect(listed).toEqual([...listed].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    ));
    await expect(findConsultationForOwner(randomUUID(), first.id)).resolves.toBeNull();
  });

  it("requires a persistent ready Analysis with matching owner and Client", async () => {
    const draft = await createDependencies("clarifying");
    await expect(createConsultationForOwner(draft.ownerUserId, {
      clientId: draft.clientId,
      analysisId: draft.analysisId,
      summary: "Draft",
      nextSteps: [],
    })).rejects.toMatchObject<Partial<ConsultationDependencyError>>({
      code: "CONSULTATION_ANALYSIS_NOT_READY",
      httpStatus: 409,
    });

    const other = await createDependencies("ready");
    await expect(createConsultationForOwner(draft.ownerUserId, {
      clientId: draft.clientId,
      analysisId: other.analysisId,
      summary: "Cross owner",
      nextSteps: [],
    })).rejects.toMatchObject({ code: "CONSULTATION_ANALYSIS_NOT_FOUND", httpStatus: 404 });
  });

  it("retains but hides Consultations when Client is soft-deleted", async () => {
    const dependencies = await createDependencies("ready");
    const consultation = await createConsultationForOwner(dependencies.ownerUserId, {
      clientId: dependencies.clientId,
      analysisId: dependencies.analysisId,
      summary: "Retained",
      nextSteps: [],
    });
    await prisma.client.update({ where: { id: dependencies.clientId }, data: { deletedAt: new Date() } });

    await expect(findConsultationForOwner(dependencies.ownerUserId, consultation.id)).resolves.toBeNull();
    await expect(listConsultationsForClient(dependencies.ownerUserId, dependencies.clientId)).resolves.toEqual([]);
    await expect(prisma.consultation.count({ where: { id: consultation.id } })).resolves.toBe(1);
  });

  it("normalizes nextSteps and rejects type, item, character and UTF-8 size violations", () => {
    expect(normalizeConsultationNextSteps(undefined)).toEqual([]);
    expect(normalizeConsultationNextSteps([" first ", " ", "second"])).toEqual(["first", "second"]);
    expect(() => normalizeConsultationNextSteps("first")).toThrow(ConsultationValidationError);
    expect(() => normalizeConsultationNextSteps(["first", 2])).toThrow("nextSteps must contain only strings.");
    expect(() => normalizeConsultationNextSteps(Array.from({ length: 51 }, (_, index) => `step-${index}`)))
      .toThrow("nextSteps must contain at most 50 non-empty items.");
    expect(() => normalizeConsultationNextSteps(["x".repeat(501)]))
      .toThrow("Each nextSteps item must not exceed 500 characters.");
    expect(() => normalizeConsultationNextSteps(Array.from({ length: 50 }, () => "😀".repeat(500))))
      .toThrow("nextSteps exceeds the 32 KiB serialized limit.");
  });

  it("returns the controlled no-store 503 persistence response", async () => {
    const error = new ConsultationPersistenceError();
    expect(error).toMatchObject({ code: "CONSULTATION_PERSISTENCE_UNAVAILABLE", httpStatus: 503 });
    const response = consultationPersistenceUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "CONSULTATION_PERSISTENCE_UNAVAILABLE",
      message: "Consultation data is temporarily unavailable.",
    });
  });
});

async function createDependencies(phase: string) {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  const analysisId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@consultation.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Client" } });
  await prisma.analysis.create({
    data: {
      id: analysisId,
      ownerUserId,
      clientId,
      goal: "refresh",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      phase,
      clarificationRound: 0,
      confidenceScore: 0.9,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: [],
      safetyNotes: [],
      clarificationAnswers: [],
    },
  });
  return { ownerUserId, clientId, analysisId };
}
