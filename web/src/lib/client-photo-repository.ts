import type { ClientPhoto as PrismaClientPhotoRow } from "@prisma/client";

import type { ClientPhotoRecord } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const CLIENT_PHOTO_PERSISTENCE_ERROR_CODE = "CLIENT_PHOTO_PERSISTENCE_UNAVAILABLE";

export class ClientPhotoPersistenceError extends Error {
  readonly code = CLIENT_PHOTO_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Client photo data is temporarily unavailable.");
    this.name = "ClientPhotoPersistenceError";
  }
}

// M28: the route already verifies ownership via resolveOwnedClient before
// ever calling this repository, but ownership must be guaranteed here too,
// not only at the route -- this is the repository's own, independent check,
// backed unconditionally by the ClientPhoto->Client composite foreign key
// (clientId, ownerUserId) even if this check were ever bypassed or raced.
export class ClientPhotoDependencyError extends Error {
  readonly code = "CLIENT_PHOTO_CLIENT_NOT_FOUND";
  readonly httpStatus = 404;

  constructor() {
    super("Client not found.");
    this.name = "ClientPhotoDependencyError";
  }
}

export interface ClientPhotoCreateInput {
  clientId: string;
  ownerUserId: string;
  imageUrl: string;
  caption: string;
}

export async function createClientPhotoForOwner(input: ClientPhotoCreateInput): Promise<ClientPhotoRecord> {
  return runClientPhotoQuery(() => prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, ownerUserId: input.ownerUserId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw new ClientPhotoDependencyError();

    return toClientPhotoRecord(await tx.clientPhoto.create({
      data: {
        clientId: input.clientId,
        ownerUserId: input.ownerUserId,
        imageUrl: input.imageUrl,
        caption: input.caption || null,
      },
    }));
  }));
}

// M28: same clientId + createdAt-desc/id-desc ordering as the in-memory
// getPhotosForClientByUser -- no new sort, no pagination, no filtering
// beyond client scope. deletedAt: null mirrors the guard the route already
// applies via resolveOwnedClient before this is ever reached (defense in
// depth, not a new behavior).
export async function listClientPhotosForOwner(ownerUserId: string, clientId: string): Promise<ClientPhotoRecord[]> {
  return runClientPhotoQuery(async () => {
    const rows = await prisma.clientPhoto.findMany({
      where: { clientId, ownerUserId, client: { deletedAt: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toClientPhotoRecord);
  });
}

export function isClientPhotoPersistenceError(error: unknown): error is ClientPhotoPersistenceError {
  return error instanceof ClientPhotoPersistenceError;
}

export function clientPhotoPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: CLIENT_PHOTO_PERSISTENCE_ERROR_CODE, message: "Client photo data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function toClientPhotoRecord(row: PrismaClientPhotoRow): ClientPhotoRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    imageUrl: row.imageUrl,
    caption: row.caption ?? "",
    createdAt: row.createdAt.toISOString(),
  };
}

async function runClientPhotoQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ClientPhotoPersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ClientPhotoPersistenceError || error instanceof ClientPhotoDependencyError) throw error;
    throw new ClientPhotoPersistenceError();
  }
}
