import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    consultationMessage: {
      create: prismaMocks.create,
      findMany: prismaMocks.findMany,
      findFirst: prismaMocks.findFirst,
      updateMany: prismaMocks.updateMany,
    },
  },
}));

import {
  ConsultationMessagePersistenceError,
  findConsultationMessageForOwner,
  isConsultationMessagePersistenceError,
  listRecentConsultationMessages,
  markConsultationMessageMemoryDecision,
  recordConsultationMessage,
} from "./consultation-message-repository";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    analysisId: null,
    role: "stylist",
    content: "Hello",
    proposedCorrection: null,
    createdAt: new Date("2026-08-14T10:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  prismaMocks.configured = true;
  prismaMocks.create.mockReset().mockResolvedValue(row());
  prismaMocks.findMany.mockReset().mockResolvedValue([]);
  prismaMocks.findFirst.mockReset();
  prismaMocks.updateMany.mockReset();
});

describe("recordConsultationMessage", () => {
  it("persists the message scoped to ownerUserId + clientId, with analysisId when provided", async () => {
    await recordConsultationMessage({
      ownerUserId: "owner-1",
      clientId: "client-1",
      analysisId: "analysis-1",
      role: "stylist",
      content: "Her density is low",
    });

    expect(prismaMocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerUserId: "owner-1",
        clientId: "client-1",
        analysisId: "analysis-1",
        role: "stylist",
        content: "Her density is low",
      }),
    });
  });

  it("fails closed when the database is unavailable", async () => {
    prismaMocks.configured = false;
    await expect(
      recordConsultationMessage({ ownerUserId: "owner-1", clientId: "client-1", role: "stylist", content: "hi" }),
    ).rejects.toBeInstanceOf(ConsultationMessagePersistenceError);
  });

  it("isConsultationMessagePersistenceError recognizes only its own error type", () => {
    expect(isConsultationMessagePersistenceError(new ConsultationMessagePersistenceError())).toBe(true);
    expect(isConsultationMessagePersistenceError(new Error("other"))).toBe(false);
  });
});

describe("listRecentConsultationMessages", () => {
  it("scopes strictly to the exact ownerUserId + clientId pair -- proves cross-client isolation at the query level", async () => {
    await listRecentConsultationMessages("owner-1", "client-1", 10);

    expect(prismaMocks.findMany).toHaveBeenCalledWith({
      where: { ownerUserId: "owner-1", clientId: "client-1" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  });

  it("returns messages in chronological (oldest-first) order even though the query fetches newest-first", async () => {
    prismaMocks.findMany.mockResolvedValue([
      row({ id: "newest", createdAt: new Date("2026-08-14T10:02:00.000Z") }),
      row({ id: "middle", createdAt: new Date("2026-08-14T10:01:00.000Z") }),
      row({ id: "oldest", createdAt: new Date("2026-08-14T10:00:00.000Z") }),
    ]);

    const result = await listRecentConsultationMessages("owner-1", "client-1");

    expect(result.map((m) => m.id)).toEqual(["oldest", "middle", "newest"]);
  });

  it("surfaces proposedMemoryDecision when present, and null when the row has never been decided", async () => {
    prismaMocks.findMany.mockResolvedValue([
      row({ id: "confirmed-one", proposedMemoryDecision: "confirmed" }),
      row({ id: "rejected-one", proposedMemoryDecision: "rejected" }),
      row({ id: "pending-one", proposedMemoryDecision: null }),
    ]);

    const result = await listRecentConsultationMessages("owner-1", "client-1");

    expect(result.find((m) => m.id === "confirmed-one")?.proposedMemoryDecision).toBe("confirmed");
    expect(result.find((m) => m.id === "rejected-one")?.proposedMemoryDecision).toBe("rejected");
    expect(result.find((m) => m.id === "pending-one")?.proposedMemoryDecision).toBeNull();
  });
});

// Regression: reopening Consult AI (or reloading the page) showed active
// Confirm/Edit/Reject buttons again on proposedMemory cards the stylist had
// already decided on -- confirmedMemoryIds/rejectedMemoryIds lived only in
// React state, reset to empty on every mount, and Reject never called any
// API at all. This is the one function that ever writes a decision.
describe("markConsultationMessageMemoryDecision", () => {
  it("marks a pending proposal as decided, scoped to the exact owner + client + message", async () => {
    prismaMocks.findFirst.mockResolvedValue({ proposedMemory: { action: "save_client_memory" }, proposedMemoryDecision: null });
    prismaMocks.updateMany.mockResolvedValue({ count: 1 });

    const result = await markConsultationMessageMemoryDecision("owner-1", "client-1", "msg-1", "rejected");

    expect(result).toBe(true);
    expect(prismaMocks.findFirst).toHaveBeenCalledWith({
      where: { id: "msg-1", ownerUserId: "owner-1", clientId: "client-1" },
      select: { proposedMemory: true, proposedMemoryDecision: true },
    });
    expect(prismaMocks.updateMany).toHaveBeenCalledWith({
      where: { id: "msg-1", ownerUserId: "owner-1", clientId: "client-1", proposedMemoryDecision: null },
      data: { proposedMemoryDecision: "rejected" },
    });
  });

  it("returns false without writing anything when the message does not exist or isn't owned by this owner/client", async () => {
    prismaMocks.findFirst.mockResolvedValue(null);

    const result = await markConsultationMessageMemoryDecision("owner-1", "client-1", "missing", "confirmed");

    expect(result).toBe(false);
    expect(prismaMocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns false without writing anything when the message carries no proposedMemory at all", async () => {
    prismaMocks.findFirst.mockResolvedValue({ proposedMemory: null, proposedMemoryDecision: null });

    const result = await markConsultationMessageMemoryDecision("owner-1", "client-1", "msg-1", "confirmed");

    expect(result).toBe(false);
    expect(prismaMocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns false without writing anything when a decision was already made -- never overwrites an existing decision", async () => {
    prismaMocks.findFirst.mockResolvedValue({ proposedMemory: { action: "save_client_memory" }, proposedMemoryDecision: "confirmed" });

    const result = await markConsultationMessageMemoryDecision("owner-1", "client-1", "msg-1", "rejected");

    expect(result).toBe(false);
    expect(prismaMocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns false if a concurrent decision wins the race between the read and the write", async () => {
    prismaMocks.findFirst.mockResolvedValue({ proposedMemory: { action: "save_client_memory" }, proposedMemoryDecision: null });
    // The WHERE clause's own proposedMemoryDecision: null re-check loses the
    // race -- another request decided first, so 0 rows match.
    prismaMocks.updateMany.mockResolvedValue({ count: 0 });

    const result = await markConsultationMessageMemoryDecision("owner-1", "client-1", "msg-1", "confirmed");

    expect(result).toBe(false);
  });

  it("fails closed when the database is unavailable", async () => {
    prismaMocks.configured = false;
    await expect(markConsultationMessageMemoryDecision("owner-1", "client-1", "msg-1", "confirmed")).rejects.toBeInstanceOf(
      ConsultationMessagePersistenceError,
    );
    expect(prismaMocks.findFirst).not.toHaveBeenCalled();
  });
});

// AI Proposed Look (Phase 2), Stage 5 -- "Use in Proposed Look" must
// independently verify a client-supplied consultationMessageId before ever
// trusting anything about it.
describe("findConsultationMessageForOwner", () => {
  it("returns the mapped row when found and owned, scoped to the exact owner + client", async () => {
    prismaMocks.findFirst.mockResolvedValue(row({ proposedMemory: { action: "mark_preference", content: "x", reason: "y" } }));

    const result = await findConsultationMessageForOwner("owner-1", "client-1", "msg-1");

    expect(result?.id).toBe("msg-1");
    expect(prismaMocks.findFirst).toHaveBeenCalledWith({
      where: { id: "msg-1", ownerUserId: "owner-1", clientId: "client-1" },
    });
  });

  it("returns null for a nonexistent id, a foreign owner, or a foreign client -- one identical result for all three", async () => {
    prismaMocks.findFirst.mockResolvedValue(null);

    const result = await findConsultationMessageForOwner("owner-1", "client-1", "missing-or-foreign");

    expect(result).toBeNull();
  });

  it("fails closed when the database is unavailable", async () => {
    prismaMocks.configured = false;
    await expect(findConsultationMessageForOwner("owner-1", "client-1", "msg-1")).rejects.toBeInstanceOf(
      ConsultationMessagePersistenceError,
    );
    expect(prismaMocks.findFirst).not.toHaveBeenCalled();
  });
});
