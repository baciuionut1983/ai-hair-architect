import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  client: {
    count: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const configurationMock = vi.hoisted(() => ({ configured: true }));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => configurationMock.configured,
  prisma: prismaMock,
}));

import {
  ClientPersistenceError,
  clientExistsForOwner,
  listClientsForOwner,
  softDeleteClientForOwner,
} from "@/lib/client-repository";

describe("client repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configurationMock.configured = true;
  });

  it("fails closed when the database is not configured", async () => {
    configurationMock.configured = false;
    await expect(listClientsForOwner("owner-1")).rejects.toBeInstanceOf(ClientPersistenceError);
    expect(prismaMock.client.findMany).not.toHaveBeenCalled();
  });

  it("scopes active Client reads to the owner", async () => {
    prismaMock.client.count.mockResolvedValue(1);
    await expect(clientExistsForOwner("owner-1", "client-1")).resolves.toBe(true);
    expect(prismaMock.client.count).toHaveBeenCalledWith({
      where: { id: "client-1", ownerUserId: "owner-1", deletedAt: null },
    });
  });

  it("soft deletes only an active owner-scoped Client", async () => {
    prismaMock.client.updateMany.mockResolvedValue({ count: 1 });
    await expect(softDeleteClientForOwner("owner-1", "client-1")).resolves.toBe(true);
    expect(prismaMock.client.updateMany).toHaveBeenCalledWith({
      where: { id: "client-1", ownerUserId: "owner-1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("sanitizes unexpected Prisma failures", async () => {
    prismaMock.client.findMany.mockRejectedValue(new Error("password=secret host=internal"));
    await expect(listClientsForOwner("owner-1")).rejects.toMatchObject({
      code: "CLIENT_PERSISTENCE_UNAVAILABLE",
      httpStatus: 503,
      message: "Client data is temporarily unavailable.",
    });
  });
});