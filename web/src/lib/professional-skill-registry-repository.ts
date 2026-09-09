import { randomUUID } from "crypto";

import { Prisma, type ProfessionalSkillDefinition as PrismaProfessionalSkillDefinitionRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  isSkillAuthorityType,
  isSkillDefinitionStatus,
  isValidSkillDefinition,
  type SkillAuthorityType,
  type SkillDefinition,
  type SkillDefinitionStatus,
} from "@/lib/professional-skill-contracts";

// AI Hair Architect, Stage 3 -- PROFESSIONAL SKILL REGISTRY FOUNDATION,
// domain/repository layer. Persists professional-skill-contracts.ts's own
// SkillDefinition<TFact> objects (Stage 2.5.i.1, unchanged) as queryable
// rows -- this file does NOT reimplement that contract's validity rules;
// every structural check reuses isValidSkillDefinition/
// isSkillEligibleForAuthority verbatim.
//
// GLOBAL PROFESSIONAL AUTHORITY, not client-scoped -- mirrors the pure
// contract's own shape (no owner/client field anywhere in
// SkillDefinition). This is shared technique knowledge, not per-account
// client data, exactly like the cutting engine's own CUTTING_TECHNIQUES/
// STRUCTURAL_TECHNIQUES constants are global, not per-user.
//
// IMMUTABLE VERSIONS: a (skillId, version) pair is written exactly once
// -- createSkillDefinition rejects a duplicate outright (the DB's own
// @@unique([skillId, version]) is the final backstop). Only lifecycle
// metadata (status/reviewedByUserId/reviewedAt/
// supersededBySkillDefinitionId) is ever mutated in place afterward,
// NEVER `payload` -- exactly the same "frozen content, mutable lifecycle
// status" discipline every other DRAFT/CONFIRMED/SUPERSEDED model in this
// schema already follows. A caller resolving an OLD execution request
// against skillId+version always gets back the exact original content,
// even after a newer version exists.
//
// DOMAIN GENERALIZATION: `vertical` reuses the pure contract's own field
// name verbatim (never a renamed "domain" synonym for an identical
// concept). SUPPORTED_SKILL_VERTICALS below is a REGISTRY-LAYER allowlist
// (not a contract-layer restriction -- the contract's own `vertical`
// stays an open string) enforcing this stage's own explicit "hair is the
// only active scope now" instruction; adding a future vertical (nails/
// makeup/color) is a one-line addition to this array, never a schema
// redesign.
//
// EXECUTION MAPPING: toSkillDefinitionForCompiler is a direct, lossless
// unwrap -- a persisted row's own `payload` IS a valid SkillDefinition
// input (the exact same object isValidSkillDefinition already accepted
// at create time). Any future compiler consuming a hand-authored
// SkillDefinition constant today (e.g. ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL)
// can consume a persisted row's unwrapped payload identically -- no
// adapter, no translation layer, no semantic loss.
//
// WHAT THIS FILE IS NOT (Stage 3's own explicit boundary):
//   - it selects NO skill, ranks NO candidate, runs NO AI/LLM call -- Stage
//     4's own selector is not implemented here, and this file requires no
//     AI call to create/read/query anything;
//   - it builds NO haircut template/ontology -- every persisted row is one
//     reusable technique primitive, never a goal/form a plan composes
//     toward.

export const SUPPORTED_SKILL_VERTICALS = ["cutting"] as const;
export type SupportedSkillVertical = (typeof SUPPORTED_SKILL_VERTICALS)[number];

export function isSupportedSkillVertical(value: unknown): value is SupportedSkillVertical {
  return typeof value === "string" && (SUPPORTED_SKILL_VERTICALS as readonly string[]).includes(value);
}

export class ProfessionalSkillRegistryPersistenceError extends Error {
  readonly code = "PROFESSIONAL_SKILL_REGISTRY_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Professional Skill Registry data is temporarily unavailable.");
    this.name = "ProfessionalSkillRegistryPersistenceError";
  }
}

export class ProfessionalSkillRegistryValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "SKILL_DEFINITION_INVALID" | "SKILL_DEFINITION_UNSUPPORTED_VERTICAL" | "SKILL_DEFINITION_DUPLICATE_VERSION",
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalSkillRegistryValidationError";
  }
}

export class ProfessionalSkillRegistryDependencyError extends Error {
  constructor(
    readonly code: "SKILL_DEFINITION_NOT_FOUND" | "SKILL_DEFINITION_SUCCESSOR_NOT_FOUND",
    readonly httpStatus: 404,
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalSkillRegistryDependencyError";
  }
}

export class ProfessionalSkillRegistryStateError extends Error {
  readonly code = "SKILL_DEFINITION_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalSkillRegistryStateError";
  }
}

// ---------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------

export interface ProfessionalSkillDefinitionRecord {
  id: string;
  skillId: string;
  version: number;
  vertical: string;
  name: string;
  status: SkillDefinitionStatus;
  authorityType: SkillAuthorityType;
  payload: SkillDefinition;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  supersededBySkillDefinitionId: string | null;
  createdAt: string;
  updatedAt: string;
}

const alwaysValidFact = (value: unknown): value is string => typeof value === "string";

// ---------------------------------------------------------------------------
// createSkillDefinition
// ---------------------------------------------------------------------------

// Persists a caller-supplied SkillDefinition object VERBATIM as `payload`
// -- never a caller-supplied JSON blob accepted on faith: isValidSkillDefinition
// (the existing, unmodified Stage 2.5.i.1 contract) is the single gate.
// The registry has no vertical-specific fact vocabulary of its own, so
// `applicabilityCondition` is checked against a permissive "any string is
// a fact" guard here -- exactly as generic as the contract's own TFact
// design intends; a vertical-specific caller (e.g. cutting) that wants a
// closed fact guard enforces that itself before calling this function.
export async function createSkillDefinition(input: unknown): Promise<ProfessionalSkillDefinitionRecord> {
  if (!isValidSkillDefinition(input, alwaysValidFact)) {
    throw new ProfessionalSkillRegistryValidationError("SKILL_DEFINITION_INVALID", "The supplied value is not a structurally valid SkillDefinition.");
  }
  if (!isSupportedSkillVertical(input.vertical)) {
    throw new ProfessionalSkillRegistryValidationError(
      "SKILL_DEFINITION_UNSUPPORTED_VERTICAL",
      `Vertical "${input.vertical}" is not yet a supported registry vertical.`,
    );
  }

  return runRegistryQuery(async () => {
    const existing = await prisma.professionalSkillDefinition.findFirst({ where: { skillId: input.skillId, version: input.version }, select: { id: true } });
    if (existing) {
      throw new ProfessionalSkillRegistryValidationError(
        "SKILL_DEFINITION_DUPLICATE_VERSION",
        `Skill ${input.skillId} version ${input.version} already exists -- versions are immutable, never overwritten.`,
      );
    }

    const row = await prisma.professionalSkillDefinition.create({
      data: {
        id: randomUUID(),
        skillId: input.skillId,
        version: input.version,
        vertical: input.vertical,
        name: input.name,
        status: input.status,
        authorityType: input.authorityType,
        payload: input as unknown as Prisma.InputJsonValue,
        reviewedByUserId: input.reviewedByUserId ?? null,
        reviewedAt: input.reviewedAt ?? null,
        supersededBySkillDefinitionId: null,
      },
    });
    return toRecord(row);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions -- status/review/supersession columns only,
// `payload` never touched. Mirrors this schema's own established
// "mutable lifecycle status, frozen content" discipline exactly.
// ---------------------------------------------------------------------------

export async function activateSkillDefinition(skillId: string, version: number): Promise<ProfessionalSkillDefinitionRecord> {
  return runRegistryQuery(() =>
    runSerializableTransaction(async (tx) => {
      const target = await tx.professionalSkillDefinition.findFirst({ where: { skillId, version } });
      if (!target) {
        throw new ProfessionalSkillRegistryDependencyError("SKILL_DEFINITION_NOT_FOUND", 404, `Skill ${skillId} version ${version} not found.`);
      }
      if (target.status !== "DRAFT") {
        throw new ProfessionalSkillRegistryStateError(target.status, `Skill ${skillId} v${version} is ${target.status}; only a DRAFT skill can be activated.`);
      }
      if (target.authorityType === "MACHINE_DRAFTED") {
        throw new ProfessionalSkillRegistryStateError(target.status, `Skill ${skillId} v${version} is MACHINE_DRAFTED and can never become ACTIVE unreviewed.`);
      }

      const updated = await tx.professionalSkillDefinition.update({ where: { id: target.id }, data: { status: "ACTIVE" } });
      return toRecord(updated);
    }),
  );
}

export async function retireSkillDefinition(
  skillId: string,
  version: number,
  supersededBy?: { skillId: string; version: number },
): Promise<ProfessionalSkillDefinitionRecord> {
  return runRegistryQuery(() =>
    runSerializableTransaction(async (tx) => {
      const target = await tx.professionalSkillDefinition.findFirst({ where: { skillId, version } });
      if (!target) {
        throw new ProfessionalSkillRegistryDependencyError("SKILL_DEFINITION_NOT_FOUND", 404, `Skill ${skillId} version ${version} not found.`);
      }
      if (target.status !== "ACTIVE") {
        throw new ProfessionalSkillRegistryStateError(target.status, `Skill ${skillId} v${version} is ${target.status}; only an ACTIVE skill can be retired.`);
      }

      let supersededBySkillDefinitionId: string | null = null;
      if (supersededBy) {
        const successor = await tx.professionalSkillDefinition.findFirst({ where: { skillId: supersededBy.skillId, version: supersededBy.version }, select: { id: true } });
        if (!successor) {
          throw new ProfessionalSkillRegistryDependencyError(
            "SKILL_DEFINITION_SUCCESSOR_NOT_FOUND",
            404,
            `Successor skill ${supersededBy.skillId} version ${supersededBy.version} not found.`,
          );
        }
        supersededBySkillDefinitionId = successor.id;
      }

      const updated = await tx.professionalSkillDefinition.update({
        where: { id: target.id },
        data: { status: "RETIRED", supersededBySkillDefinitionId },
      });
      return toRecord(updated);
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findSkillDefinition(skillId: string, version: number): Promise<ProfessionalSkillDefinitionRecord | null> {
  return runRegistryQuery(async () => {
    const row = await prisma.professionalSkillDefinition.findFirst({ where: { skillId, version } });
    return row ? toRecord(row) : null;
  });
}

export async function findLatestSkillDefinition(skillId: string, statusFilter?: SkillDefinitionStatus): Promise<ProfessionalSkillDefinitionRecord | null> {
  return runRegistryQuery(async () => {
    const row = await prisma.professionalSkillDefinition.findFirst({
      where: { skillId, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { version: "desc" },
    });
    return row ? toRecord(row) : null;
  });
}

export interface ListSkillDefinitionsFilter {
  vertical?: string;
  status?: SkillDefinitionStatus;
  skillId?: string;
}

// Zero AI call -- a plain, indexed, deterministic query. Supports the
// Stage 4 bridge this task locks: a future STATE DELTA + Registry query
// filters candidates by vertical/status alone, no reasoning required here.
export async function listSkillDefinitions(filter: ListSkillDefinitionsFilter = {}): Promise<ProfessionalSkillDefinitionRecord[]> {
  return runRegistryQuery(async () => {
    const rows = await prisma.professionalSkillDefinition.findMany({
      where: {
        ...(filter.vertical ? { vertical: filter.vertical } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.skillId ? { skillId: filter.skillId } : {}),
      },
      orderBy: [{ skillId: "asc" }, { version: "asc" }],
    });
    return rows.map(toRecord);
  });
}

// Direct, lossless mapping into the existing SkillInstance/ExecutionUnit
// compiler path -- see file header. No transformation beyond narrowing
// `unknown` back to the exact type isValidSkillDefinition already proved
// this payload satisfies at create time.
export function toSkillDefinitionForCompiler(record: ProfessionalSkillDefinitionRecord): SkillDefinition {
  return record.payload;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type RegistryTransaction = Pick<Prisma.TransactionClient, "professionalSkillDefinition">;
const MAX_TRANSACTION_ATTEMPTS = 3;

async function runRegistryQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ProfessionalSkillRegistryPersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ProfessionalSkillRegistryPersistenceError ||
      error instanceof ProfessionalSkillRegistryValidationError ||
      error instanceof ProfessionalSkillRegistryDependencyError ||
      error instanceof ProfessionalSkillRegistryStateError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ProfessionalSkillRegistryValidationError("SKILL_DEFINITION_DUPLICATE_VERSION", "This skill version already exists.");
    }
    throw new ProfessionalSkillRegistryPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: RegistryTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
    }
  }
  throw new ProfessionalSkillRegistryPersistenceError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof ProfessionalSkillRegistryPersistenceError ||
    error instanceof ProfessionalSkillRegistryValidationError ||
    error instanceof ProfessionalSkillRegistryDependencyError ||
    error instanceof ProfessionalSkillRegistryStateError
  ) {
    return false;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function toRecord(row: PrismaProfessionalSkillDefinitionRow): ProfessionalSkillDefinitionRecord {
  const payload = row.payload;
  if (!isValidSkillDefinition(payload, alwaysValidFact)) {
    throw new ProfessionalSkillRegistryPersistenceError();
  }
  if (!isSkillDefinitionStatus(row.status) || !isSkillAuthorityType(row.authorityType)) {
    throw new ProfessionalSkillRegistryPersistenceError();
  }
  return {
    id: row.id,
    skillId: row.skillId,
    version: row.version,
    vertical: row.vertical,
    name: row.name,
    status: row.status,
    authorityType: row.authorityType,
    payload,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    supersededBySkillDefinitionId: row.supersededBySkillDefinitionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
