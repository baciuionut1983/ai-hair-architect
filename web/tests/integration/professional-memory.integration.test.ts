import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  createConfirmedMemory,
  retrieveRelevantMemories,
  revokeMemory,
} from "@/lib/professional-memory-repository";

// Real Postgres, not mocks -- this is the strongest local proof available
// for the two guarantees the product depends on: a confirmed memory really
// is available to a later Consult AI turn, and a revoked memory really can
// never reach one again. Production verification still requires a live
// retest on aihairarchitect.com (see the final report) -- this proves the
// repository layer is correct against a real database, not that Railway's
// production database has this migration applied.
const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;
const owners = new Set<string>();

suite("professional memory integration", () => {
  afterEach(async () => {
    await prisma.professionalMemoryAudit.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.professionalMemory.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("F/K: a confirmed memory is retrievable (available to a later conversation); once revoked, it is never retrievable again", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();

    const memory = await createConfirmedMemory({
      ownerUserId,
      clientId,
      scope: "client_specific",
      kind: "fact",
      source: "typed",
      content: "Low density in the temporal areas; preserve more weight around the perimeter.",
      provenance: { channel: "chat", sourceMessageId: "message-42" },
    });

    // A brand-new call, simulating a later, separate conversation turn --
    // no state is carried over except what is actually in the database.
    const beforeRevoke = await retrieveRelevantMemories(ownerUserId, clientId, "What should I remember about her density?");
    expect(beforeRevoke.map((m) => m.id)).toContain(memory.id);
    expect(beforeRevoke.find((m) => m.id === memory.id)?.content).toBe(
      "Low density in the temporal areas; preserve more weight around the perimeter.",
    );

    const revoked = await revokeMemory(ownerUserId, memory.id);
    expect(revoked).toBe(true);

    const afterRevoke = await retrieveRelevantMemories(ownerUserId, clientId, "What should I remember about her density?");
    expect(afterRevoke.map((m) => m.id)).not.toContain(memory.id);
  });

  it("the audit trail survives revocation -- provenance and history are never deleted, only the active status changes", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const memory = await createConfirmedMemory({
      ownerUserId,
      clientId,
      scope: "client_specific",
      kind: "fact",
      source: "typed",
      content: "x",
      provenance: { channel: "chat", sourceMessageId: "message-1" },
    });

    await revokeMemory(ownerUserId, memory.id);

    const row = await prisma.professionalMemory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(row.status).toBe("revoked");
    expect(row.revokedAt).not.toBeNull();
    expect((row.provenance as Record<string, unknown>).sourceMessageId).toBe("message-1");

    const audits = await prisma.professionalMemoryAudit.findMany({ where: { memoryId: memory.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["confirmed_created", "revoked"]);
  });

  it("I: a client-specific memory for one client never reaches another client's conversation, even for the same owner", async () => {
    const { ownerUserId, clientId: clientA } = await createOwnerAndClient();
    const clientB = randomUUID();
    await prisma.client.create({ data: { id: clientB, ownerUserId, fullName: "Client B" } });

    await createConfirmedMemory({
      ownerUserId,
      clientId: clientA,
      scope: "client_specific",
      kind: "fact",
      source: "typed",
      content: "Client A's specific observation.",
      provenance: {},
    });

    const forClientB = await retrieveRelevantMemories(ownerUserId, clientB, "anything");
    expect(forClientB.some((m) => m.content === "Client A's specific observation.")).toBe(false);
  });

  it("I: a memory confirmed by one owner never reaches a different owner's conversation, even for a client with the same id shape", async () => {
    const first = await createOwnerAndClient();
    const second = await createOwnerAndClient();

    await createConfirmedMemory({
      ownerUserId: first.ownerUserId,
      clientId: first.clientId,
      scope: "client_specific",
      kind: "fact",
      source: "typed",
      content: "Owner one's private client note.",
      provenance: {},
    });

    const forSecondOwner = await retrieveRelevantMemories(second.ownerUserId, second.clientId, "anything");
    expect(forSecondOwner.some((m) => m.content === "Owner one's private client note.")).toBe(false);
  });

  it("a stylist-wide professional rule (not client-specific) is available across that owner's clients", async () => {
    const { ownerUserId, clientId: clientA } = await createOwnerAndClient();
    const clientB = randomUUID();
    await prisma.client.create({ data: { id: clientB, ownerUserId, fullName: "Client B" } });

    await createConfirmedMemory({
      ownerUserId,
      scope: "stylist_specific",
      kind: "professional_rule",
      source: "typed",
      content: "Prefer texturizing over scissor-over-comb on fine hair.",
      provenance: {},
    });

    const forClientA = await retrieveRelevantMemories(ownerUserId, clientA, "fine hair scissor over comb");
    const forClientB = await retrieveRelevantMemories(ownerUserId, clientB, "fine hair scissor over comb");
    expect(forClientA.some((m) => m.content === "Prefer texturizing over scissor-over-comb on fine hair.")).toBe(true);
    expect(forClientB.some((m) => m.content === "Prefer texturizing over scissor-over-comb on fine hair.")).toBe(true);
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@professional-memory.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Client" } });
  return { ownerUserId, clientId };
}
