import { Prisma, type Consultation as PrismaConsultationRow } from "@prisma/client";

import type { ConsultationRecord } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const CONSULTATION_PERSISTENCE_ERROR_CODE = "CONSULTATION_PERSISTENCE_UNAVAILABLE";
export const MAX_CONSULTATION_SUMMARY_LENGTH = 4000;
export const MAX_CONSULTATION_NEXT_STEPS = 50;
export const MAX_CONSULTATION_NEXT_STEP_LENGTH = 500;
export const MAX_CONSULTATION_NEXT_STEPS_BYTES = 32 * 1024;

export class ConsultationPersistenceError extends Error {
  readonly code = CONSULTATION_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Consultation data is temporarily unavailable.");
    this.name = "ConsultationPersistenceError";
  }
}

export class ConsultationValidationError extends Error {
  readonly code = "CONSULTATION_PAYLOAD_INVALID";
  readonly httpStatus = 400;

  constructor(message: string) {
    super(message);
    this.name = "ConsultationValidationError";
  }
}

export class ConsultationDependencyError extends Error {
  constructor(
    readonly code: "CONSULTATION_CLIENT_NOT_FOUND" | "CONSULTATION_ANALYSIS_NOT_FOUND" | "CONSULTATION_ANALYSIS_NOT_READY" | "CONSULTATION_DEPENDENCY_CHANGED",
    readonly httpStatus: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ConsultationDependencyError";
  }
}

export interface ConsultationCreateInput {
  clientId: string;
  analysisId: string;
  summary: string;
  nextSteps: string[];
}

type ConsultationTransaction = Pick<Prisma.TransactionClient, "consultation" | "client" | "analysis">;

export async function createConsultationForOwner(
  ownerUserId: string,
  input: ConsultationCreateInput,
): Promise<ConsultationRecord> {
  return runConsultationQuery(async () => prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, ownerUserId, deletedAt: null },
      select: { id: true },
    });
    if (!client) {
      throw new ConsultationDependencyError("CONSULTATION_CLIENT_NOT_FOUND", 404, "Client not found.");
    }

    const analysis = await tx.analysis.findFirst({
      where: { id: input.analysisId, ownerUserId, clientId: client.id },
      select: { id: true, phase: true },
    });
    if (!analysis) {
      throw new ConsultationDependencyError("CONSULTATION_ANALYSIS_NOT_FOUND", 404, "Analysis not found.");
    }
    if (analysis.phase !== "ready") {
      throw new ConsultationDependencyError(
        "CONSULTATION_ANALYSIS_NOT_READY",
        409,
        "Analysis is not ready. Complete clarifying questions first.",
      );
    }

    return toConsultationRecord(await tx.consultation.create({
      data: {
        ownerUserId,
        clientId: client.id,
        analysisId: analysis.id,
        summary: input.summary,
        nextSteps: input.nextSteps,
      },
    }));
  }));
}

export async function findConsultationForOwner(
  ownerUserId: string,
  consultationId: string,
): Promise<ConsultationRecord | null> {
  return runConsultationQuery(async () => {
    const row = await prisma.consultation.findFirst({
      where: { id: consultationId, ownerUserId, client: { deletedAt: null } },
    });
    return row ? toConsultationRecord(row) : null;
  });
}

export async function listConsultationsForClient(
  ownerUserId: string,
  clientId: string,
): Promise<ConsultationRecord[]> {
  return runConsultationQuery(async () => {
    const rows = await prisma.consultation.findMany({
      where: { ownerUserId, clientId, client: { deletedAt: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toConsultationRecord);
  });
}

export async function consultationExistsForOwner(
  ownerUserId: string,
  consultationId: string,
  db: Pick<Prisma.TransactionClient, "consultation"> = prisma,
): Promise<boolean> {
  return runConsultationQuery(
    async () => (await db.consultation.count({ where: { id: consultationId, ownerUserId } })) === 1,
  );
}

export async function countConsultationsForOwner(ownerUserId: string): Promise<number> {
  return runConsultationQuery(() => prisma.consultation.count({
    where: { ownerUserId, client: { deletedAt: null } },
  }));
}

export async function countAllConsultations(): Promise<number> {
  return runConsultationQuery(() => prisma.consultation.count());
}

export async function deleteConsultationsForOwner(
  tx: Pick<Prisma.TransactionClient, "consultation">,
  ownerUserId: string,
): Promise<number> {
  return (await tx.consultation.deleteMany({ where: { ownerUserId } })).count;
}

export async function insertConsultationForRestore(
  tx: ConsultationTransaction,
  input: {
    id: string;
    ownerUserId: string;
    clientId: string;
    analysisId: string;
    summary: string;
    nextSteps: string[];
    createdAt: Date;
  },
): Promise<void> {
  await tx.consultation.create({ data: input });
}

export function normalizeConsultationSummary(value: unknown): string {
  if (typeof value !== "string") throw new ConsultationValidationError("summary must be a string.");
  const summary = value.trim();
  if (!summary || unicodeLength(summary) > MAX_CONSULTATION_SUMMARY_LENGTH) {
    throw new ConsultationValidationError("summary must contain 1 to 4000 characters.");
  }
  return summary;
}

export function normalizeConsultationNextSteps(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConsultationValidationError("nextSteps must be an array.");
  if (value.some((entry) => typeof entry !== "string")) {
    throw new ConsultationValidationError("nextSteps must contain only strings.");
  }

  const normalized = value.map((entry) => entry.trim()).filter(Boolean);
  if (normalized.length > MAX_CONSULTATION_NEXT_STEPS) {
    throw new ConsultationValidationError("nextSteps must contain at most 50 non-empty items.");
  }
  if (normalized.some((entry) => unicodeLength(entry) > MAX_CONSULTATION_NEXT_STEP_LENGTH)) {
    throw new ConsultationValidationError("Each nextSteps item must not exceed 500 characters.");
  }
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_CONSULTATION_NEXT_STEPS_BYTES) {
    throw new ConsultationValidationError("nextSteps exceeds the 32 KiB serialized limit.");
  }
  return normalized;
}

export function isConsultationPersistenceError(error: unknown): error is ConsultationPersistenceError {
  return error instanceof ConsultationPersistenceError;
}

export function consultationPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: CONSULTATION_PERSISTENCE_ERROR_CODE, message: "Consultation data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function toConsultationRecord(row: PrismaConsultationRow): ConsultationRecord {
  if (!Array.isArray(row.nextSteps) || row.nextSteps.some((entry) => typeof entry !== "string")) {
    throw new ConsultationPersistenceError();
  }
  const nextSteps = row.nextSteps as string[];
  return {
    id: row.id,
    clientId: row.clientId,
    analysisId: row.analysisId,
    summary: row.summary,
    nextSteps,
    createdAt: row.createdAt.toISOString(),
  };
}

async function runConsultationQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ConsultationPersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ConsultationPersistenceError || error instanceof ConsultationDependencyError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new ConsultationDependencyError("CONSULTATION_DEPENDENCY_CHANGED", 409, "Consultation dependencies changed.");
    }
    throw new ConsultationPersistenceError();
  }
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}
