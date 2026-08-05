import { randomUUID } from "crypto";

import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  ClientPhotoDependencyError,
  createClientPhotoForOwner,
  listClientPhotosForOwner,
} from "@/lib/client-photo-repository";
import { prisma } from "@/lib/prisma";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("client photo repository integration", () => {
  it("persists a photo and reads it back through a fresh Prisma client (real durability)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();

    const created = await createClientPhotoForOwner({
      clientId,
      ownerUserId,
      imageUrl: "https://example.com/a.jpg",
      caption: "Before",
    });

    const freshClient = new PrismaClient();
    try {
      await expect(freshClient.clientPhoto.findUnique({ where: { id: created.id } })).resolves.toMatchObject({
        clientId,
        ownerUserId,
        imageUrl: "https://example.com/a.jpg",
        caption: "Before",
      });
    } finally {
      await freshClient.$disconnect();
    }

    await expect(listClientPhotosForOwner(ownerUserId, clientId)).resolves.toEqual([created]);
    await cleanupOwners([ownerUserId]);
  });

  it("lists newest-first and isolates strictly between owners", async () => {
    const first = await createOwnerAndClient();
    const second = await createOwnerAndClient();

    const older = await createClientPhotoForOwner({
      clientId: first.clientId,
      ownerUserId: first.ownerUserId,
      imageUrl: "https://example.com/older.jpg",
      caption: "",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createClientPhotoForOwner({
      clientId: first.clientId,
      ownerUserId: first.ownerUserId,
      imageUrl: "https://example.com/newer.jpg",
      caption: "",
    });
    await createClientPhotoForOwner({
      clientId: second.clientId,
      ownerUserId: second.ownerUserId,
      imageUrl: "https://example.com/second-owner.jpg",
      caption: "",
    });

    const list = await listClientPhotosForOwner(first.ownerUserId, first.clientId);
    expect(list.map((p) => p.id)).toEqual([newer.id, older.id]);

    await expect(listClientPhotosForOwner(second.ownerUserId, first.clientId)).resolves.toEqual([]);

    await cleanupOwners([first.ownerUserId, second.ownerUserId]);
  });

  it("rejects a nonexistent client and a client belonging to a different owner", async () => {
    const { ownerUserId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();

    await expect(
      createClientPhotoForOwner({ clientId: randomUUID(), ownerUserId, imageUrl: "u", caption: "" }),
    ).rejects.toBeInstanceOf(ClientPhotoDependencyError);

    await expect(
      createClientPhotoForOwner({ clientId: other.clientId, ownerUserId, imageUrl: "u", caption: "" }),
    ).rejects.toBeInstanceOf(ClientPhotoDependencyError);

    await cleanupOwners([ownerUserId, other.ownerUserId]);
  });

  it("hides photos for a soft-deleted client from listing", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    await createClientPhotoForOwner({ clientId, ownerUserId, imageUrl: "u", caption: "" });

    await prisma.client.update({ where: { id: clientId }, data: { deletedAt: new Date() } });

    await expect(listClientPhotosForOwner(ownerUserId, clientId)).resolves.toEqual([]);
    await expect(
      createClientPhotoForOwner({ clientId, ownerUserId, imageUrl: "u2", caption: "" }),
    ).rejects.toBeInstanceOf(ClientPhotoDependencyError);

    await cleanupOwners([ownerUserId]);
  });

  it("enforces cross-owner isolation at the database level, not only in application code", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();

    // Bypass the repository entirely and attempt a raw insert with a
    // mismatched (clientId, ownerUserId) pair -- must fail on the
    // composite foreign key itself, proving the guarantee is not solely
    // application-code-enforced.
    await expect(
      prisma.clientPhoto.create({
        data: { clientId, ownerUserId: other.ownerUserId, imageUrl: "u", caption: "" },
      }),
    ).rejects.toThrow();

    await cleanupOwners([ownerUserId, other.ownerUserId]);
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@client-photo-repository.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({
    data: { id: clientId, ownerUserId, fullName: "Client Photo Repository Client" },
  });
  return { ownerUserId, clientId };
}

async function cleanupOwners(ownerUserIds: string[]) {
  await prisma.clientPhoto.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
  await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
  for (const id of ownerUserIds) owners.delete(id);
}
