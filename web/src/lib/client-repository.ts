import { Prisma, type Client as PrismaClientRow } from "@prisma/client";

import type { ClientRecord } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const CLIENT_PERSISTENCE_ERROR_CODE = "CLIENT_PERSISTENCE_UNAVAILABLE";

export class ClientPersistenceError extends Error {
  readonly code = CLIENT_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Client data is temporarily unavailable.");
    this.name = "ClientPersistenceError";
  }
}

export interface ClientCreateInput {
  fullName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export type ClientUpdateInput = Partial<ClientCreateInput>;
type ClientDb = Pick<Prisma.TransactionClient, "client">;

export async function createClientForOwner(ownerUserId: string, input: ClientCreateInput): Promise<ClientRecord> {
  return runClientQuery(async (db) => toClientRecord(await db.client.create({
    data: { ownerUserId, ...input },
  })));
}

export async function listClientsForOwner(ownerUserId: string): Promise<ClientRecord[]> {
  return runClientQuery(async (db) => {
    const rows = await db.client.findMany({
      where: { ownerUserId, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toClientRecord);
  });
}

export async function findClientForOwner(ownerUserId: string, clientId: string): Promise<ClientRecord | null> {
  return runClientQuery(async (db) => {
    const row = await db.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null } });
    return row ? toClientRecord(row) : null;
  });
}

export async function clientExistsForOwner(
  ownerUserId: string,
  clientId: string,
  db: ClientDb = prisma,
): Promise<boolean> {
  return runClientQuery(async () => (await db.client.count({
    where: { id: clientId, ownerUserId, deletedAt: null },
  })) === 1, db);
}

export async function updateClientForOwner(
  ownerUserId: string,
  clientId: string,
  input: ClientUpdateInput,
): Promise<ClientRecord | null> {
  return runClientQuery(async (db) => {
    const updated = await db.client.updateMany({
      where: { id: clientId, ownerUserId, deletedAt: null },
      data: input,
    });
    if (updated.count !== 1) return null;
    const row = await db.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null } });
    return row ? toClientRecord(row) : null;
  });
}

export async function softDeleteClientForOwner(ownerUserId: string, clientId: string): Promise<boolean> {
  return runClientQuery(async (db) => (await db.client.updateMany({
    where: { id: clientId, ownerUserId, deletedAt: null },
    data: { deletedAt: new Date() },
  })).count === 1);
}

export async function countActiveClients(ownerUserId?: string): Promise<number> {
  return runClientQuery((db) => db.client.count({
    where: { ...(ownerUserId ? { ownerUserId } : {}), deletedAt: null },
  }));
}

export function isClientPersistenceError(error: unknown): error is ClientPersistenceError {
  return error instanceof ClientPersistenceError;
}

export function clientPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: CLIENT_PERSISTENCE_ERROR_CODE, message: "Client data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function resolveOwnedClient(ownerUserId: string, clientId: string): Promise<ClientRecord | Response | null> {
  try {
    return await findClientForOwner(ownerUserId, clientId);
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    throw error;
  }
}

function toClientRecord(row: PrismaClientRow): ClientRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    fullName: row.fullName,
    email: row.email ?? "",
    phone: row.phone ?? "",
    notes: row.notes ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function runClientQuery<T>(operation: (db: ClientDb) => Promise<T>, db: ClientDb = prisma): Promise<T> {
  if (!isDatabaseConfigured()) throw new ClientPersistenceError();
  try {
    return await operation(db);
  } catch (error) {
    if (error instanceof ClientPersistenceError) throw error;
    throw new ClientPersistenceError();
  }
}

export async function listActiveClientIdsForOwner(ownerUserId: string): Promise<string[]> {
  return runClientQuery(async (db) => (await db.client.findMany({
    where: { ownerUserId, deletedAt: null },
    select: { id: true },
  })).map((row) => row.id));
}