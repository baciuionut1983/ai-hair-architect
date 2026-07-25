import { randomUUID } from "crypto";

import { describe, expect, it } from "vitest";

import {
  createClientForOwner,
  findClientForOwner,
  listClientsForOwner,
  softDeleteClientForOwner,
  updateClientForOwner,
} from "@/lib/client-repository";
import { prisma } from "@/lib/prisma";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("client repository integration", () => {
  it("persists owner-scoped CRUD and hides soft-deleted Clients", async () => {
    const ownerUserId = randomUUID();
    const otherOwnerUserId = randomUUID();

    try {
      await prisma.user.createMany({
        data: [ownerUserId, otherOwnerUserId].map((id) => ({
          id,
          email: `${id}@client-repository.test`,
          passwordHash: "test",
          role: "professional",
          locale: "en",
        })),
      });

      const created = await createClientForOwner(ownerUserId, {
        fullName: "Durable Client",
        email: null,
        phone: null,
        notes: "Initial notes",
      });

      expect(created).toMatchObject({ email: "", phone: "", notes: "Initial notes" });
      await expect(findClientForOwner(otherOwnerUserId, created.id)).resolves.toBeNull();
      await expect(listClientsForOwner(ownerUserId)).resolves.toEqual([created]);

      const updated = await updateClientForOwner(ownerUserId, created.id, {
        fullName: "Updated Durable Client",
        email: "client@example.com",
      });
      expect(updated).toMatchObject({ fullName: "Updated Durable Client", email: "client@example.com" });

      await expect(softDeleteClientForOwner(otherOwnerUserId, created.id)).resolves.toBe(false);
      await expect(softDeleteClientForOwner(ownerUserId, created.id)).resolves.toBe(true);
      await expect(findClientForOwner(ownerUserId, created.id)).resolves.toBeNull();
      await expect(listClientsForOwner(ownerUserId)).resolves.toEqual([]);
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId: { in: [ownerUserId, otherOwnerUserId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherOwnerUserId] } } });
    }
  });
});