import type { ClientFormula as PrismaClientFormulaRow } from "@prisma/client";

import type { FormulaRecord } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const CLIENT_FORMULA_PERSISTENCE_ERROR_CODE = "CLIENT_FORMULA_PERSISTENCE_UNAVAILABLE";

export class ClientFormulaPersistenceError extends Error {
  readonly code = CLIENT_FORMULA_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Client formula data is temporarily unavailable.");
    this.name = "ClientFormulaPersistenceError";
  }
}

// M28: independent, repository-level ownership/dependency checks -- not
// only relying on the route's own resolveOwnedClient call -- backed
// unconditionally by the composite foreign keys even if these checks were
// ever bypassed or raced. Both codes deliberately collapse "doesn't exist"
// and "belongs to someone else" into the same outcome, matching the
// fail-closed, no-existence-leak convention already used throughout this
// codebase (e.g. AnalysisDependencyError's ANALYSIS_CLIENT_NOT_FOUND).
export class ClientFormulaDependencyError extends Error {
  constructor(
    readonly code: "CLIENT_FORMULA_CLIENT_NOT_FOUND" | "CLIENT_FORMULA_SOURCE_ANALYSIS_NOT_FOUND",
    readonly httpStatus: 404,
    message: string,
  ) {
    super(message);
    this.name = "ClientFormulaDependencyError";
  }
}

export interface ClientFormulaCreateInput {
  clientId: string;
  ownerUserId: string;
  formulaName: string;
  formulaDetails: string;
  // M28: pure traceability foundation toward the Analysis (M8/M27) whose
  // ColorPlan/TreatmentPlan may have informed this real service. Never
  // populated automatically in M28 -- no caller sets this yet.
  sourceAnalysisId?: string;
}

export async function createClientFormulaForOwner(input: ClientFormulaCreateInput): Promise<FormulaRecord> {
  return runClientFormulaQuery(() => prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, ownerUserId: input.ownerUserId, deletedAt: null },
      select: { id: true },
    });
    if (!client) {
      throw new ClientFormulaDependencyError("CLIENT_FORMULA_CLIENT_NOT_FOUND", 404, "Client not found.");
    }

    if (input.sourceAnalysisId) {
      const analysis = await tx.analysis.findFirst({
        where: { id: input.sourceAnalysisId, ownerUserId: input.ownerUserId, clientId: input.clientId },
        select: { id: true },
      });
      if (!analysis) {
        throw new ClientFormulaDependencyError(
          "CLIENT_FORMULA_SOURCE_ANALYSIS_NOT_FOUND",
          404,
          "Source analysis not found.",
        );
      }
    }

    return toClientFormulaRecord(await tx.clientFormula.create({
      data: {
        clientId: input.clientId,
        ownerUserId: input.ownerUserId,
        formulaName: input.formulaName,
        formulaDetails: input.formulaDetails,
        sourceAnalysisId: input.sourceAnalysisId ?? null,
      },
    }));
  }));
}

// M28: same clientId + createdAt-desc/id-desc ordering as the in-memory
// getFormulasForClientByUser -- no new sort, no pagination.
export async function listClientFormulasForOwner(ownerUserId: string, clientId: string): Promise<FormulaRecord[]> {
  return runClientFormulaQuery(async () => {
    const rows = await prisma.clientFormula.findMany({
      where: { clientId, ownerUserId, client: { deletedAt: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toClientFormulaRecord);
  });
}

export function isClientFormulaPersistenceError(error: unknown): error is ClientFormulaPersistenceError {
  return error instanceof ClientFormulaPersistenceError;
}

export function clientFormulaPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: CLIENT_FORMULA_PERSISTENCE_ERROR_CODE, message: "Client formula data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

// M28: returns exactly today's FormulaRecord shape -- ownerUserId and
// sourceAnalysisId are internal persistence details, never added to the
// public contract in this package.
function toClientFormulaRecord(row: PrismaClientFormulaRow): FormulaRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    formulaName: row.formulaName,
    formulaDetails: row.formulaDetails,
    createdAt: row.createdAt.toISOString(),
  };
}

async function runClientFormulaQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ClientFormulaPersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ClientFormulaPersistenceError || error instanceof ClientFormulaDependencyError) throw error;
    throw new ClientFormulaPersistenceError();
  }
}
