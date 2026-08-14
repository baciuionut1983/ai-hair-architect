import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: true, findMany: vi.fn(), updateMany: vi.fn(), createMemory: vi.fn(), createAudit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: () => mocks.configured, prisma: {
  professionalMemory: { findMany: mocks.findMany },
  $transaction: (callback: (tx: unknown) => unknown) => callback({ professionalMemory: { create: mocks.createMemory, updateMany: mocks.updateMany }, professionalMemoryAudit: { create: mocks.createAudit } }),
}}));

import {
  createConfirmedMemory,
  isProfessionalMemoryPersistenceError,
  ProfessionalMemoryPersistenceError,
  ProfessionalMemoryValidationError,
  retrieveRelevantMemories,
  revokeMemory,
} from "./professional-memory-repository";

const row = (overrides: Record<string, unknown> = {}) => ({ id: "m1", ownerUserId: "owner-1", clientId: null,
  scope: "stylist_specific", kind: "professional_rule", status: "active", source: "typed", content: "Preserve perimeter density on fine hair",
  confidence: 1, provenance: {}, createdByUserId: "owner-1", confirmedAt: new Date(), revokedAt: null,
  createdAt: new Date("2026-08-14T10:00:00Z"), updatedAt: new Date("2026-08-14T10:00:00Z"), ...overrides });

beforeEach(() => { vi.clearAllMocks(); mocks.configured = true; mocks.findMany.mockResolvedValue([]); mocks.createMemory.mockResolvedValue(row()); mocks.createAudit.mockResolvedValue({}); mocks.updateMany.mockResolvedValue({ count: 1 }); });

describe("professional memory safety and retrieval", () => {
  it("queries only active memories for the exact owner and client, plus owner-level knowledge", async () => {
    await retrieveRelevantMemories("owner-1", "client-A", "fine hair");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      ownerUserId: "owner-1", status: "active", OR: [
        { scope: "client_specific", clientId: "client-A" },
        { scope: { in: ["stylist_specific", "shared_knowledge"] }, clientId: null },
      ],
    }}));
  });

  it("ranks an explicit stylist rule ahead of an AI observation and carries outcome feedback", async () => {
    mocks.findMany.mockResolvedValue([
      row({ id: "ai", kind: "ai_observation", scope: "client_specific", clientId: "client-A", content: "Fine hair" }),
      row({ id: "rule", content: "On fine hair preserve density" }),
      row({ id: "outcome", kind: "outcome", scope: "client_specific", clientId: "client-A", content: "Fine hair result was too warm" }),
    ]);
    const result = await retrieveRelevantMemories("owner-1", "client-A", "fine hair warm");
    expect(result[0].id).toBe("rule");
    expect(result.some((item) => item.kind === "outcome")).toBe(true);
  });

  it("creates active memory only through the explicit confirmed operation, with provenance and audit", async () => {
    await createConfirmedMemory({ ownerUserId: "owner-1", clientId: "client-A", scope: "client_specific", kind: "fact", source: "voice_transcript", content: "Uses 6%", provenance: { transcriptId: "t1" } });
    expect(mocks.createMemory).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerUserId: "owner-1", clientId: "client-A", status: "active", provenance: { transcriptId: "t1" }, confirmedAt: expect.any(Date) }) });
    expect(mocks.createAudit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "confirmed_created", actorUserId: "owner-1" }) });
  });

  it("revokes only an active memory owned by the caller and appends audit", async () => {
    expect(await revokeMemory("owner-1", "m1")).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "m1", ownerUserId: "owner-1", status: "active" }, data: { status: "revoked", revokedAt: expect.any(Date) } });
    expect(mocks.createAudit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "revoked" }) });
  });

  // 7: revoking a foreign or already-revoked memory is a real no-op, not a
  // silent success or a crash -- the DB-level status="active" guard in the
  // WHERE clause is what actually enforces this (updateMany matches 0 rows).
  it("returns false, appends no audit, when the memory does not belong to this owner or is already revoked", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    expect(await revokeMemory("owner-1", "foreign-or-already-revoked")).toBe(false);
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });

  // 7: a revoked memory can never come back through retrieval -- enforced
  // at the query level (status: "active" is unconditional in the WHERE
  // clause), not by filtering results in application code.
  it("never includes revoked memories in retrieval -- the query itself excludes them, unconditionally", async () => {
    await retrieveRelevantMemories("owner-1", "client-A", "anything");

    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("active");
  });

  it("rejects a client_specific memory with no clientId before any database call", async () => {
    await expect(
      createConfirmedMemory({ ownerUserId: "owner-1", scope: "client_specific", kind: "fact", source: "typed", content: "x", provenance: {} }),
    ).rejects.toBeInstanceOf(ProfessionalMemoryValidationError);
    expect(mocks.createMemory).not.toHaveBeenCalled();
  });

  it("rejects a non-client-specific memory that carries a clientId before any database call", async () => {
    await expect(
      createConfirmedMemory({ ownerUserId: "owner-1", clientId: "client-A", scope: "shared_knowledge", kind: "professional_rule", source: "typed", content: "x", provenance: {} }),
    ).rejects.toBeInstanceOf(ProfessionalMemoryValidationError);
    expect(mocks.createMemory).not.toHaveBeenCalled();
  });

  it("fails closed when the database is unavailable, for every operation", async () => {
    mocks.configured = false;

    await expect(retrieveRelevantMemories("owner-1", "client-A", "hi")).rejects.toBeInstanceOf(ProfessionalMemoryPersistenceError);
    await expect(revokeMemory("owner-1", "m1")).rejects.toBeInstanceOf(ProfessionalMemoryPersistenceError);
    await expect(
      createConfirmedMemory({ ownerUserId: "owner-1", clientId: "client-A", scope: "client_specific", kind: "fact", source: "typed", content: "x", provenance: {} }),
    ).rejects.toBeInstanceOf(ProfessionalMemoryPersistenceError);
  });

  it("isProfessionalMemoryPersistenceError recognizes only its own error type", () => {
    expect(isProfessionalMemoryPersistenceError(new ProfessionalMemoryPersistenceError())).toBe(true);
    expect(isProfessionalMemoryPersistenceError(new Error("other"))).toBe(false);
  });
});
