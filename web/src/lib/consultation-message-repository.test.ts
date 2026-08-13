import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  create: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    consultationMessage: {
      create: prismaMocks.create,
      findMany: prismaMocks.findMany,
    },
  },
}));

import {
  ConsultationMessagePersistenceError,
  isConsultationMessagePersistenceError,
  listRecentConsultationMessages,
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
});
