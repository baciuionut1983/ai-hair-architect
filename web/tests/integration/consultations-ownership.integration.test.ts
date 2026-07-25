import { randomUUID } from "crypto";

import { describe, expect, it } from "vitest";

import { createClientForOwner, findClientForOwner } from "@/lib/client-repository";
import { prisma } from "@/lib/prisma";

describe("consultation ownership integration", () => {
  it("returns a durable Client only to its owner scope", async () => {
    const ownerUserId = randomUUID();
    const otherUserId = randomUUID();
    try {
      await prisma.user.createMany({
        data: [ownerUserId, otherUserId].map((id) => ({
          id,
          email: `${id}@consultation-ownership.test`,
          passwordHash: "test",
          role: "professional",
          locale: "en",
        })),
      });
      const client = await createClientForOwner(ownerUserId, {
        fullName: "Owner Client",
        email: null,
        phone: null,
        notes: null,
      });

      await expect(findClientForOwner(ownerUserId, client.id)).resolves.toMatchObject({ id: client.id });
      await expect(findClientForOwner(otherUserId, client.id)).resolves.toBeNull();
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId: { in: [ownerUserId, otherUserId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } });
    }
  });
});