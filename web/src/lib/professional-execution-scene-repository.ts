import { randomUUID } from "crypto";

import { Prisma, type ProfessionalExecutionScenePlan as PrismaProfessionalExecutionScenePlanRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  isProfessionalExecutionScenePlanReadiness,
  isValidProfessionalExecutionScenePlan,
  type ProfessionalExecutionScenePlan,
  type ProfessionalExecutionScenePlanReadiness,
} from "@/lib/professional-execution-scene-contracts";

// AI Hair Architect, Professional Skill Engine Stage 7 -- TECHNICAL
// DEMONSTRATION SCENE PLAN, domain/repository layer. Mirrors professional-
// execution-plan-repository.ts's own conventions exactly (Stage 6): the
// runSerializableTransaction retry helper, the runXQuery fail-closed
// wrapper, the ownership check, the typed-error taxonomy, and the CAS-
// confirm pattern.
//
// AUTHORITY BOUNDARY: every row is created DRAFT, always. Scene
// compilation NEVER auto-approves anything -- only confirmDraftScenePlan
// (a real professional action, with a real confirmedByUserId) transitions
// DRAFT -> CONFIRMED. A future technical video generation must gate on the
// CONFIRMED scene plan, never on a bare compiled one.
//
// IMMUTABILITY (Part W): confirmDraftScenePlan is the only write path that
// changes status/confirmedByUserId/confirmedAt on an existing row, and it
// never touches scenePlanPayload -- once written, a scene plan's own
// semantic content is permanently frozen. A source-plan change produces a
// NEW scene-plan row (new scenePlanFingerprint) via createDraftScenePlan;
// a render failure never touches the semantic row at all.
//
// IDEMPOTENCY (Part S/T): scenePlanFingerprint has a DB unique index. The
// same execution plan re-compiled by the same compiler resolves to the
// existing row (findScenePlanByFingerprint / the create path's
// pre-check), never a duplicate paid nothing -- Stage 7 costs nothing,
// but the shape is ready for the render layer that will.

export const PROFESSIONAL_EXECUTION_SCENE_PLAN_STATUSES = ["DRAFT", "CONFIRMED", "SUPERSEDED"] as const;
export type ProfessionalExecutionScenePlanStatus = (typeof PROFESSIONAL_EXECUTION_SCENE_PLAN_STATUSES)[number];

export function isProfessionalExecutionScenePlanStatus(value: unknown): value is ProfessionalExecutionScenePlanStatus {
  return typeof value === "string" && (PROFESSIONAL_EXECUTION_SCENE_PLAN_STATUSES as readonly string[]).includes(value);
}

export class ScenePlanPersistenceError extends Error {
  readonly code = "SCENE_PLAN_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Technical Demonstration Scene Plan data is temporarily unavailable.");
    this.name = "ScenePlanPersistenceError";
  }
}

export class ScenePlanDependencyError extends Error {
  constructor(
    readonly code: "SCENE_PLAN_CLIENT_NOT_FOUND" | "SCENE_PLAN_SOURCE_EXECUTION_PLAN_NOT_FOUND",
    readonly httpStatus: 404,
    message: string,
  ) {
    super(message);
    this.name = "ScenePlanDependencyError";
  }
}

export class ScenePlanValidationDbError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "SCENE_PLAN_INVALID_PAYLOAD" | "SCENE_PLAN_DUPLICATE_FINGERPRINT",
    message: string,
  ) {
    super(message);
    this.name = "ScenePlanValidationDbError";
  }
}

export class ScenePlanStateError extends Error {
  readonly code = "SCENE_PLAN_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    message: string,
  ) {
    super(message);
    this.name = "ScenePlanStateError";
  }
}

export class ScenePlanConcurrencyError extends Error {
  readonly code = "SCENE_PLAN_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Technical Demonstration Scene Plan could not be confirmed because of a concurrent confirmation.");
    this.name = "ScenePlanConcurrencyError";
  }
}

export class ScenePlanInvariantError extends Error {
  readonly code = "SCENE_PLAN_CONFIRMED_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "ScenePlanInvariantError";
  }
}

const MAX_TRANSACTION_ATTEMPTS = 3;

export interface ProfessionalExecutionScenePlanRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  sourceExecutionPlanId: string;
  sourceExecutionPlanFingerprint: string;
  scenePlanFingerprint: string;
  compilerVersion: string;
  schemaVersion: string;
  scenePlan: ProfessionalExecutionScenePlan;
  status: ProfessionalExecutionScenePlanStatus;
  readiness: ProfessionalExecutionScenePlanReadiness;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  supersededByScenePlanId: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type SceneTransaction = Pick<Prisma.TransactionClient, "professionalExecutionScenePlan" | "client" | "professionalExecutionPlan">;

// ---------------------------------------------------------------------------
// createDraftScenePlan -- the ONLY creation path. Always DRAFT. Idempotent
// on scenePlanFingerprint.
// ---------------------------------------------------------------------------

export interface CreateDraftScenePlanInput {
  ownerUserId: string;
  clientId: string;
  sourceExecutionPlanId: string;
  scenePlan: ProfessionalExecutionScenePlan;
}

export interface CreateDraftScenePlanOutcome {
  record: ProfessionalExecutionScenePlanRecord;
  created: boolean;
}

export async function createDraftScenePlan(input: CreateDraftScenePlanInput): Promise<CreateDraftScenePlanOutcome> {
  if (!isValidProfessionalExecutionScenePlan(input.scenePlan)) {
    throw new ScenePlanValidationDbError("SCENE_PLAN_INVALID_PAYLOAD", "scenePlan is not a structurally valid ProfessionalExecutionScenePlan.");
  }
  if (input.scenePlan.sourceExecutionPlanId !== input.sourceExecutionPlanId) {
    throw new ScenePlanValidationDbError("SCENE_PLAN_INVALID_PAYLOAD", "scenePlan.sourceExecutionPlanId does not match the given sourceExecutionPlanId.");
  }

  return runSceneQuery(() =>
    runSerializableTransaction(async (tx) => {
      const existing = await tx.professionalExecutionScenePlan.findFirst({ where: { scenePlanFingerprint: input.scenePlan.scenePlanFingerprint } });
      if (existing) return { record: toRecord(existing), created: false };

      const client = await tx.client.findFirst({ where: { id: input.clientId, ownerUserId: input.ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) throw new ScenePlanDependencyError("SCENE_PLAN_CLIENT_NOT_FOUND", 404, "Client not found.");

      const sourcePlan = await tx.professionalExecutionPlan.findFirst({
        where: { id: input.sourceExecutionPlanId, ownerUserId: input.ownerUserId, clientId: input.clientId },
        select: { id: true },
      });
      if (!sourcePlan) throw new ScenePlanDependencyError("SCENE_PLAN_SOURCE_EXECUTION_PLAN_NOT_FOUND", 404, "Source Professional Execution Plan not found.");

      const row = await tx.professionalExecutionScenePlan.create({
        data: {
          id: randomUUID(),
          ownerUserId: input.ownerUserId,
          clientId: input.clientId,
          sourceExecutionPlanId: input.sourceExecutionPlanId,
          sourceExecutionPlanFingerprint: input.scenePlan.sourceExecutionPlanFingerprint,
          scenePlanFingerprint: input.scenePlan.scenePlanFingerprint,
          compilerVersion: input.scenePlan.compilerVersion,
          schemaVersion: input.scenePlan.schemaVersion,
          scenePlanPayload: input.scenePlan as unknown as Prisma.InputJsonValue,
          status: "DRAFT",
          readiness: input.scenePlan.readiness,
        },
      });
      return { record: toRecord(row), created: true };
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findScenePlanForOwner(ownerUserId: string, scenePlanId: string): Promise<ProfessionalExecutionScenePlanRecord | null> {
  return runSceneQuery(async () => {
    const row = await prisma.professionalExecutionScenePlan.findFirst({ where: { id: scenePlanId, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

export async function findScenePlanByFingerprint(scenePlanFingerprint: string): Promise<ProfessionalExecutionScenePlanRecord | null> {
  return runSceneQuery(async () => {
    const row = await prisma.professionalExecutionScenePlan.findFirst({ where: { scenePlanFingerprint } });
    return row ? toRecord(row) : null;
  });
}

export async function listScenePlansForClient(ownerUserId: string, clientId: string): Promise<ProfessionalExecutionScenePlanRecord[]> {
  return runSceneQuery(async () => {
    const rows = await prisma.professionalExecutionScenePlan.findMany({ where: { ownerUserId, clientId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return rows.map(toRecord);
  });
}

export async function findCurrentConfirmedScenePlan(ownerUserId: string, sourceExecutionPlanId: string): Promise<ProfessionalExecutionScenePlanRecord | null> {
  return runSceneQuery(async () => {
    const rows = await prisma.professionalExecutionScenePlan.findMany({ where: { ownerUserId, sourceExecutionPlanId, status: "CONFIRMED" } });
    if (rows.length > 1) {
      throw new ScenePlanInvariantError(`Found ${rows.length} CONFIRMED scene plans for execution plan "${sourceExecutionPlanId}" -- there should never be more than one.`);
    }
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

// ---------------------------------------------------------------------------
// confirmDraftScenePlan -- the ONE real professional-approval action. CAS
// on the current confirmed scene plan for the same source execution plan.
// ---------------------------------------------------------------------------

export async function confirmDraftScenePlan(
  ownerUserId: string,
  scenePlanId: string,
  confirmedByUserId: string,
  expectedCurrentConfirmedScenePlanId: string | null,
): Promise<ProfessionalExecutionScenePlanRecord | null> {
  return runSceneQuery(() =>
    runSerializableTransaction(async (tx) => {
      const target = await tx.professionalExecutionScenePlan.findFirst({ where: { id: scenePlanId, ownerUserId } });
      if (!target) return null;
      if (target.status !== "DRAFT") {
        throw new ScenePlanStateError(target.status, `Scene plan ${scenePlanId} is ${target.status}; only a DRAFT scene plan can be confirmed.`);
      }

      const currentConfirmed = await tx.professionalExecutionScenePlan.findFirst({
        where: { ownerUserId, sourceExecutionPlanId: target.sourceExecutionPlanId, status: "CONFIRMED" },
        select: { id: true },
      });
      const actualCurrentId = currentConfirmed?.id ?? null;
      if (actualCurrentId !== expectedCurrentConfirmedScenePlanId) throw new ScenePlanConcurrencyError();

      const now = new Date();
      if (currentConfirmed) {
        await tx.professionalExecutionScenePlan.update({
          where: { id: currentConfirmed.id },
          data: { status: "SUPERSEDED", supersededAt: now, supersededByScenePlanId: target.id },
        });
      }

      const confirmed = await tx.professionalExecutionScenePlan.update({
        where: { id: target.id },
        data: { status: "CONFIRMED", confirmedByUserId, confirmedAt: now },
      });
      return toRecord(confirmed);
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runSceneQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ScenePlanPersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ScenePlanPersistenceError ||
      error instanceof ScenePlanDependencyError ||
      error instanceof ScenePlanValidationDbError ||
      error instanceof ScenePlanStateError ||
      error instanceof ScenePlanConcurrencyError ||
      error instanceof ScenePlanInvariantError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ScenePlanValidationDbError("SCENE_PLAN_DUPLICATE_FINGERPRINT", "A scene plan with this fingerprint already exists.");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new ScenePlanDependencyError("SCENE_PLAN_CLIENT_NOT_FOUND", 404, "Scene plan dependencies changed.");
    }
    throw new ScenePlanPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: SceneTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new ScenePlanConcurrencyError();
    }
  }
  throw new ScenePlanConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof ScenePlanPersistenceError ||
    error instanceof ScenePlanDependencyError ||
    error instanceof ScenePlanValidationDbError ||
    error instanceof ScenePlanStateError ||
    error instanceof ScenePlanConcurrencyError ||
    error instanceof ScenePlanInvariantError
  ) {
    return false;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2034";
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function toRecord(row: PrismaProfessionalExecutionScenePlanRow): ProfessionalExecutionScenePlanRecord {
  const scenePlan = row.scenePlanPayload;
  if (!isValidProfessionalExecutionScenePlan(scenePlan)) throw new ScenePlanPersistenceError();
  if (!isProfessionalExecutionScenePlanStatus(row.status) || !isProfessionalExecutionScenePlanReadiness(row.readiness)) throw new ScenePlanPersistenceError();
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    sourceExecutionPlanId: row.sourceExecutionPlanId,
    sourceExecutionPlanFingerprint: row.sourceExecutionPlanFingerprint,
    scenePlanFingerprint: row.scenePlanFingerprint,
    compilerVersion: row.compilerVersion,
    schemaVersion: row.schemaVersion,
    scenePlan,
    status: row.status,
    readiness: row.readiness,
    confirmedByUserId: row.confirmedByUserId,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    supersededByScenePlanId: row.supersededByScenePlanId,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
