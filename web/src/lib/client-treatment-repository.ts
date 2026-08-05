import type { ClientTreatment as PrismaClientTreatmentRow } from "@prisma/client";

import type { TreatmentRecord } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const CLIENT_TREATMENT_PERSISTENCE_ERROR_CODE = "CLIENT_TREATMENT_PERSISTENCE_UNAVAILABLE";

export class ClientTreatmentPersistenceError extends Error {
  readonly code = CLIENT_TREATMENT_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Client treatment data is temporarily unavailable.");
    this.name = "ClientTreatmentPersistenceError";
  }
}

// M28: see ClientFormulaDependencyError -- same independent, repository-
// level ownership/dependency checks, same fail-closed no-existence-leak
// convention.
export class ClientTreatmentDependencyError extends Error {
  constructor(
    readonly code: "CLIENT_TREATMENT_CLIENT_NOT_FOUND" | "CLIENT_TREATMENT_SOURCE_ANALYSIS_NOT_FOUND",
    readonly httpStatus: 404,
    message: string,
  ) {
    super(message);
    this.name = "ClientTreatmentDependencyError";
  }
}

export interface ClientTreatmentCreateInput {
  clientId: string;
  ownerUserId: string;
  treatmentName: string;
  treatmentDetails: string;
  // M28: pure traceability foundation toward the Analysis (M8/M27) whose
  // ColorPlan/TreatmentPlan may have informed this real service. Never
  // populated automatically in M28 -- no caller sets this yet.
  sourceAnalysisId?: string;
}

export async function createClientTreatmentForOwner(input: ClientTreatmentCreateInput): Promise<TreatmentRecord> {
  return runClientTreatmentQuery(() => prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, ownerUserId: input.ownerUserId, deletedAt: null },
      select: { id: true },
    });
    if (!client) {
      throw new ClientTreatmentDependencyError("CLIENT_TREATMENT_CLIENT_NOT_FOUND", 404, "Client not found.");
    }

    if (input.sourceAnalysisId) {
      const analysis = await tx.analysis.findFirst({
        where: { id: input.sourceAnalysisId, ownerUserId: input.ownerUserId, clientId: input.clientId },
        select: { id: true },
      });
      if (!analysis) {
        throw new ClientTreatmentDependencyError(
          "CLIENT_TREATMENT_SOURCE_ANALYSIS_NOT_FOUND",
          404,
          "Source analysis not found.",
        );
      }
    }

    return toClientTreatmentRecord(await tx.clientTreatment.create({
      data: {
        clientId: input.clientId,
        ownerUserId: input.ownerUserId,
        treatmentName: input.treatmentName,
        treatmentDetails: input.treatmentDetails,
        sourceAnalysisId: input.sourceAnalysisId ?? null,
      },
    }));
  }));
}

// M28: same clientId + createdAt-desc/id-desc ordering as the in-memory
// getTreatmentsForClientByUser -- no new sort, no pagination.
export async function listClientTreatmentsForOwner(
  ownerUserId: string,
  clientId: string,
): Promise<TreatmentRecord[]> {
  return runClientTreatmentQuery(async () => {
    const rows = await prisma.clientTreatment.findMany({
      where: { clientId, ownerUserId, client: { deletedAt: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toClientTreatmentRecord);
  });
}

export function isClientTreatmentPersistenceError(error: unknown): error is ClientTreatmentPersistenceError {
  return error instanceof ClientTreatmentPersistenceError;
}

export function clientTreatmentPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: CLIENT_TREATMENT_PERSISTENCE_ERROR_CODE, message: "Client treatment data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

// M28: returns exactly today's TreatmentRecord shape -- ownerUserId and
// sourceAnalysisId are internal persistence details, never added to the
// public contract in this package.
function toClientTreatmentRecord(row: PrismaClientTreatmentRow): TreatmentRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    treatmentName: row.treatmentName,
    treatmentDetails: row.treatmentDetails,
    createdAt: row.createdAt.toISOString(),
  };
}

async function runClientTreatmentQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ClientTreatmentPersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ClientTreatmentPersistenceError || error instanceof ClientTreatmentDependencyError) {
      throw error;
    }
    throw new ClientTreatmentPersistenceError();
  }
}
