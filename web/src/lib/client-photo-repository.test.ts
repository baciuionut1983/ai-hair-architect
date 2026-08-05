import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  transaction: vi.fn(),
  clientFindFirst: vi.fn(),
  clientPhotoCreate: vi.fn(),
  clientPhotoFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    $transaction: prismaMocks.transaction,
    clientPhoto: { findMany: prismaMocks.clientPhotoFindMany },
  },
}));

const tx = {
  client: { findFirst: prismaMocks.clientFindFirst },
  clientPhoto: { create: prismaMocks.clientPhotoCreate },
};

import {
  ClientPhotoDependencyError,
  ClientPhotoPersistenceError,
  clientPhotoPersistenceUnavailableResponse,
  createClientPhotoForOwner,
  isClientPhotoPersistenceError,
  listClientPhotosForOwner,
} from "@/lib/client-photo-repository";

function photoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "photo-1",
    clientId: "client-1",
    ownerUserId: "owner-1",
    imageUrl: "https://example.com/a.jpg",
    caption: "Before",
    createdAt: new Date("2026-08-05T10:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  prismaMocks.configured = true;
  prismaMocks.transaction.mockReset();
  prismaMocks.clientFindFirst.mockReset();
  prismaMocks.clientPhotoCreate.mockReset();
  prismaMocks.clientPhotoFindMany.mockReset();
  prismaMocks.transaction.mockImplementation(async (operation) => operation(tx));
});

describe("client-photo-repository", () => {
  it("creates a photo after verifying owner-scoped, non-deleted client existence", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.clientPhotoCreate.mockResolvedValue(photoRow());

    const result = await createClientPhotoForOwner({
      clientId: "client-1",
      ownerUserId: "owner-1",
      imageUrl: "https://example.com/a.jpg",
      caption: "Before",
    });

    expect(prismaMocks.clientFindFirst).toHaveBeenCalledWith({
      where: { id: "client-1", ownerUserId: "owner-1", deletedAt: null },
      select: { id: true },
    });
    expect(prismaMocks.clientPhotoCreate).toHaveBeenCalledWith({
      data: { clientId: "client-1", ownerUserId: "owner-1", imageUrl: "https://example.com/a.jpg", caption: "Before" },
    });
    expect(result).toEqual({
      id: "photo-1",
      clientId: "client-1",
      imageUrl: "https://example.com/a.jpg",
      caption: "Before",
      createdAt: "2026-08-05T10:00:00.000Z",
    });
  });

  it("rejects when the client does not exist, without creating a photo", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue(null);

    await expect(
      createClientPhotoForOwner({ clientId: "missing", ownerUserId: "owner-1", imageUrl: "u", caption: "" }),
    ).rejects.toBeInstanceOf(ClientPhotoDependencyError);
    expect(prismaMocks.clientPhotoCreate).not.toHaveBeenCalled();
  });

  it("rejects when the client belongs to a different owner (query itself is owner-scoped)", async () => {
    // clientFindFirst is called with ownerUserId in its where clause, so a
    // client belonging to another owner never matches -- same code path,
    // same rejection, as a nonexistent client (no existence leak).
    prismaMocks.clientFindFirst.mockResolvedValue(null);

    await expect(
      createClientPhotoForOwner({ clientId: "someone-elses-client", ownerUserId: "owner-1", imageUrl: "u", caption: "" }),
    ).rejects.toMatchObject({ code: "CLIENT_PHOTO_CLIENT_NOT_FOUND", httpStatus: 404 });
  });

  it("maps caption '' to null on write, and back to '' on read (matches Client.email/phone/notes convention)", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.clientPhotoCreate.mockResolvedValue(photoRow({ caption: null }));

    const result = await createClientPhotoForOwner({
      clientId: "client-1",
      ownerUserId: "owner-1",
      imageUrl: "u",
      caption: "",
    });

    expect(prismaMocks.clientPhotoCreate).toHaveBeenCalledWith({
      data: { clientId: "client-1", ownerUserId: "owner-1", imageUrl: "u", caption: null },
    });
    expect(result.caption).toBe("");
  });

  it("lists photos newest-first, scoped to owner and client, excluding soft-deleted clients", async () => {
    prismaMocks.clientPhotoFindMany.mockResolvedValue([photoRow()]);

    const result = await listClientPhotosForOwner("owner-1", "client-1");

    expect(prismaMocks.clientPhotoFindMany).toHaveBeenCalledWith({
      where: { clientId: "client-1", ownerUserId: "owner-1", client: { deletedAt: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(result).toHaveLength(1);
  });

  it("isolates listing between owners: a different owner never sees another owner's photos", async () => {
    prismaMocks.clientPhotoFindMany.mockResolvedValue([]);
    await listClientPhotosForOwner("owner-2", "client-1");
    expect(prismaMocks.clientPhotoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerUserId: "owner-2" }) }),
    );
  });

  it("fails closed when the database is not configured", async () => {
    prismaMocks.configured = false;
    await expect(listClientPhotosForOwner("owner-1", "client-1")).rejects.toBeInstanceOf(ClientPhotoPersistenceError);
    expect(prismaMocks.clientPhotoFindMany).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected Prisma failures", async () => {
    prismaMocks.clientPhotoFindMany.mockRejectedValue(new Error("password=secret host=internal"));
    await expect(listClientPhotosForOwner("owner-1", "client-1")).rejects.toMatchObject({
      code: "CLIENT_PHOTO_PERSISTENCE_UNAVAILABLE",
      httpStatus: 503,
      message: "Client photo data is temporarily unavailable.",
    });
  });

  it("exposes the standardized no-store error response and the type guard", () => {
    expect(isClientPhotoPersistenceError(new ClientPhotoPersistenceError())).toBe(true);
    expect(isClientPhotoPersistenceError(new Error("other"))).toBe(false);

    const response = clientPhotoPersistenceUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
